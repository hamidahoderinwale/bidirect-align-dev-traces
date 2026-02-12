/**
 * Startup service - handles application initialization
 */

const cron = require('node-cron');
const path = require('path');
const StatsTable = require('../database/stats-table.js');
const DBSizeGuard = require('../utils/db-size-guard.js');

function createStartupService(deps) {
  const {
    persistentDB,
    schemaMigrations,
    db,
    dbRepairService,
    server,
    PORT,
    HOST,
    config,
    startFileWatcher,
    clipboardMonitor,
    terminalMonitor,
    errorTracker,
    startRawDataCapture,
    buildLunrIndex,
    checkSessionTimeout,
    cursorDbParser,
    dbRef,
    contextAnalyzer,
    contextChangeTracker,
    productivityTracker,
    todosRoutes,
    activeSession,
    proceduralKnowledgeBuilder,
    historicalMiningService,
    automaticMiningScheduler,
    automaticHfSyncService,
  } = deps;

  // Initialize DB size guard (may be used by other services later)
  const dbPath = path.join(__dirname, '../data/companion.db');
  const dbGuard = new DBSizeGuard(dbPath);

  // Minimal, fast DB init: avoid heavy work on startup so the HTTP server
  // can come up quickly even when the underlying DB is large.
  async function loadPersistedData() {
    try {
      await persistentDB.init();

      // Do NOT run migrations, stats, or historical initialization here.
      // Those can be triggered lazily or via dedicated maintenance endpoints.

      // Ensure in‑memory structures are sane without scanning the DB.
      db.nextId = db.nextId || 1;
      db._entries = db._entries || [];
      db._prompts = db._prompts || [];

      console.log('[MEMORY] In-memory cache disabled - using on-demand queries');
      console.log('[STARTUP] Database init complete, proceeding to start HTTP server...');
    } catch (error) {
      console.error('Error loading persisted data:', error.message);
      console.error('Error stack:', error.stack);
      console.log('   Starting with empty database');
      throw error; // Re-throw so server can still start in error handler
    }
  }

  function startServer() {
    return new Promise((resolve, reject) => {
      console.log('[STARTUP] Starting server initialization...');

      // Handle port conflicts - set up error handler BEFORE calling listen()
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error('\n[ERROR] Port conflict detected!');
          console.error(`Port ${PORT} is already in use.`);
          console.error('\nTo fix this, run one of these commands:');
          console.error(`  1. Kill existing process: lsof -ti:${PORT} | xargs kill -9`);
          console.error(`  2. Find process: lsof -i:${PORT}`);
          console.error(`  3. Kill all companion processes: pkill -f 'node src/index.js'`);
          console.error(`  4. Use different port: PORT=43918 node src/index.js\n`);
          reject(err);
        } else {
          console.error('[ERROR] Server error:', err);
          reject(err);
        }
      });

      loadPersistedData()
        .then(() => {
          console.log('[STARTUP] Database init promise resolved, calling server.listen()...');
          // Start server FIRST, then do database repair in background
          server.listen(PORT, HOST, () => {
            console.log(`[LAUNCH] Companion service running on http://${HOST}:${PORT}`);
            console.log(`[DATA] Health endpoint: http://${HOST}:${PORT}/health`);
            console.log(`[UP] Activity endpoint: http://${HOST}:${PORT}/api/activity`);
            console.log(`[SEARCH] Queue endpoint: http://${HOST}:${PORT}/queue`);
            console.log(` WebSocket server running on ws://${HOST}:${PORT}`);

            const workspacesToWatch = config.workspace_roots ||
              config.workspaces || [config.root_dir];
            const autoDetect = config.auto_detect_workspaces !== false;
            if (autoDetect) {
              console.log(
                ` Auto-detecting workspaces from ${workspacesToWatch.length} root location(s):`
              );
            } else {
              console.log(` Watching ${workspacesToWatch.length} configured workspace(s):`);
            }
            workspacesToWatch.forEach((ws, i) => {
              console.log(`   ${i + 1}. ${ws}`);
            });
            console.log(` Ignoring: ${config.ignore.length} patterns`);

            startFileWatcher();

            if (config.enable_clipboard === true) {
              clipboardMonitor.start();
              console.log(' Clipboard monitor started for prompt capture');
            } else {
              console.log(' Clipboard monitor disabled in config');
            }

            console.log(
              '[SYNC] Automatic prompt sync DISABLED (use /api/cursor-database for fresh data)'
            );

            if (config.enable_terminal_monitoring !== false) {
              terminalMonitor.start();

              terminalMonitor.on('command', async (commandRecord) => {
                try {
                  await persistentDB.saveTerminalCommand(commandRecord);
                } catch (error) {
                  console.error('Error persisting terminal command:', error);
                }

                if (commandRecord.exitCode && commandRecord.exitCode !== 0) {
                  errorTracker.trackTerminalError(
                    commandRecord.command,
                    commandRecord.output || '',
                    commandRecord.exitCode
                  );
                }

                if (global.io) {
                  global.io.emit('terminal-command', commandRecord);
                }
              });

              console.log('[SYSTEM]  Terminal monitor started for command tracking');
            } else {
              console.log(' Terminal monitor disabled in config');
            }

            startRawDataCapture();
            buildLunrIndex();

            // Start procedural knowledge builder if available
            if (typeof proceduralKnowledgeBuilder !== 'undefined' && proceduralKnowledgeBuilder) {
              proceduralKnowledgeBuilder.start();
              console.log('[PROCEDURAL-KNOWLEDGE] Automatic procedural knowledge building started');
            }

            // Initialize automatic mining scheduler if available
            if (automaticMiningScheduler) {
              automaticMiningScheduler.initialize().catch((err) => {
                console.error('[MINING] Failed to initialize automatic mining:', err.message);
              });
            }

            // Initialize automatic Hugging Face sync service if available
            if (automaticHfSyncService) {
              automaticHfSyncService.initialize().catch((err) => {
                console.error('[HF-SYNC] Failed to initialize automatic HF sync:', err.message);
              });
            }

            setInterval(
              () => {
                checkSessionTimeout();
              },
              5 * 60 * 1000
            );

            console.log('[TIME] Session timeout check started (every 5 minutes)');

            console.log('[SEARCH] Starting Cursor database monitoring...');
            cursorDbParser.startMonitoring(async (data) => {
              if (data.prompts && data.prompts.length > 0) {
                console.log(`[CHAT] Found ${data.prompts.length} prompts in Cursor database`);

                // Check if dbRef is available and has prompts array
                if (!dbRef || !dbRef.prompts) {
                  console.warn('[CHAT] dbRef not available, skipping prompt processing');
                  return;
                }

                for (const prompt of data.prompts) {
                  const exists = dbRef.prompts.find((p) => p.text === prompt.text);
                  if (!exists) {
                    const enhancedPrompt = {
                      ...prompt,
                      id: dbRef.nextId++,
                      added_from_database: true,
                    };

                    dbRef.prompts.push(enhancedPrompt);

                    try {
                      await persistentDB.savePrompt(enhancedPrompt);
                      console.log(`   Saved prompt to SQLite: ${enhancedPrompt.id}`);

                      const currentActiveTodo = todosRoutes.getCurrentActiveTodo();
                      if (currentActiveTodo) {
                        await persistentDB.addPromptToTodo(currentActiveTodo, enhancedPrompt.id);
                        await persistentDB.linkEventToTodo('prompt', enhancedPrompt.id);
                        console.log(
                          `   [TODO] Linked prompt ${enhancedPrompt.id} to TODO ${currentActiveTodo}`
                        );
                      }
                    } catch (saveError) {
                      console.warn('Error saving prompt to database:', saveError.message);
                    }

                    try {
                      // Use enhancedPrompt (with integer ID) instead of prompt (with UUID composerId)
                      // This ensures context snapshots are linked to the correct prompt ID in the database
                      const contextAnalysis = await contextAnalyzer.analyzePromptContext(enhancedPrompt);
                      if (contextAnalysis) {
                        enhancedPrompt.contextAnalysis = contextAnalysis;

                        const contextChange = await contextChangeTracker.trackContextChange(
                          contextAnalysis,
                          {
                            promptId: enhancedPrompt.id,
                            timestamp: Date.now(),
                            sessionId: activeSession(),
                          }
                        );
                        if (contextChange) {
                          enhancedPrompt.contextChange = contextChange;
                        }
                      }

                      productivityTracker.trackPromptCreated(enhancedPrompt);
                      productivityTracker.detectPromptIteration(enhancedPrompt, dbRef.prompts);

                      if (enhancedPrompt.linkedEntryId) {
                        const linkedEntry = dbRef.entries.find(
                          (e) => e.id === enhancedPrompt.linkedEntryId
                        );
                        if (linkedEntry) {
                          productivityTracker.markAIGeneratedCode(linkedEntry);
                        }
                      }
                    } catch (trackingError) {
                      console.warn('Error tracking prompt analytics:', trackingError.message);
                    }
                  }
                }
              }
            });

            // Initialize stats table and schedule periodic updates
            const statsTable = new StatsTable(persistentDB);
            statsTable
              .init()
              .then(() => {
                // Update stats immediately on startup
                statsTable.updateDailyStats().catch((err) => {
                  console.warn('[STATS] Initial stats update failed:', err.message);
                });

                // Schedule stats updates every 5 minutes
                cron.schedule('*/5 * * * *', async () => {
                  try {
                    await statsTable.updateDailyStats();
                    console.log('[STATS] Stats updated successfully');
                  } catch (error) {
                    console.warn('[STATS] Scheduled stats update failed:', error.message);
                  }
                });

              })
              .catch((err) => {
                console.warn('[STATS] Stats table initialization failed:', err.message);
              });

            // Run database repair in background after server starts (non-blocking)
            // Skip for very large databases to avoid OOM
            if (!dbGuard.shouldSkipOperation('repairDatabaseLinks')) {
              setTimeout(() => {
                dbRepairService
                  .repairDatabaseLinks()
                  .then((result) => {
                    if (result.repaired > 0) {
                      console.log(
                        `[REPAIR] Repaired ${result.repaired} database links in background`
                      );
                    }
                  })
                  .catch((err) => {
                    console.warn(
                      '[REPAIR] Background link repair failed (non-critical):',
                      err.message
                    );
                  });
              }, 5000); // Wait 5 seconds after server starts
            }

            resolve();
          });
        })
        .catch((error) => {
          console.error('Failed to load persisted data:', error);
          // Error handler already set up above, just try to start server
          server.listen(PORT, HOST, () => {
            console.log(
              `[LAUNCH] Companion service running on http://${HOST}:${PORT} (without persisted data)`
            );
            resolve();
          });
        });
    });
  }

  return {
    loadPersistedData,
    startServer,
  };
}

module.exports = createStartupService;
