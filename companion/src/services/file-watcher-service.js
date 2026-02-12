/**
 * File watching service
 * OPTIMIZED: Uses Rust native module for 5-10x faster diff calculation
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractModelInfo } = require('../utils/model-detector.js');
const diffEngine = require('../utils/diff-engine.js');

function createFileWatcherService(deps) {
  const {
    config,
    detectWorkspace,
    getWorkspaceSession,
    checkSessionTimeout,
    updateActivityTime,
    updateWorkspaceData,
    queueSystem,
    db,
    persistentDB,
    productivityTracker,
    io,
    broadcastUpdate,
    enqueue,
    getCurrentActiveTodo,
    plotService,
  } = deps;

  let watcher = null;
  const fileSnapshots = new Map();

  // Log performance info on initialization
  const perfInfo = diffEngine.getPerformanceInfo();
  console.log(`[FILE-WATCHER] Diff engine: ${perfInfo.implementation}`);

  function calculateDiff(text1, text2) {
    const diffThreshold = config.diff_threshold;

    // Use the optimized diff engine (Rust if available, JS fallback)
    const result = diffEngine.calculateDiff(text1, text2, {
      threshold: diffThreshold,
      includeUnified: false,
    });

    // Ensure backward compatibility by adding beforeContent
    return {
      ...result,
      beforeContent: text1,
    };
  }

  async function processFileChange(filePath) {
    console.log(` Processing file change: ${filePath}`);

    const workspacePath = await detectWorkspace(filePath);
    const workspaceSession = getWorkspaceSession(workspacePath);

    checkSessionTimeout();
    updateActivityTime();

    try {
      const stats = fs.statSync(filePath);
      const maxFileSizeMB = 5;
      const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

      if (stats.size > maxFileSizeBytes) {
        console.log(
          `[WARNING] Skipping large file (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${filePath}`
        );
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(workspacePath, filePath);
      const previousContent = fileSnapshots.get(filePath) || '';

      console.log(
        ` File: ${relativePath}, Workspace: ${workspacePath}, Session: ${workspaceSession}`
      );
      console.log(` Previous length: ${previousContent.length}, Current length: ${content.length}`);

      if (content !== previousContent) {
        const diff = calculateDiff(previousContent, content);
        console.log(
          ` Diff: ${diff.summary}, Significant: ${diff.isSignificant}, Threshold: ${config.diff_threshold}`
        );

        if (diff.isSignificant) {
          const modelInfo = extractModelInfo({
            file_path: relativePath,
            content: content,
            before_content: previousContent,
          });

          const entry = queueSystem.addEntry({
            session_id: workspaceSession,
            workspace_path: workspacePath,
            source: 'filewatcher',
            file_path: relativePath,
            before_code: previousContent,
            after_code: content,
            notes: `File change detected. Diff: ${diff.summary}`,
            tags: ['filewatcher-detected', 'code-change'],
            modelInfo: modelInfo,
          });

          try {
            await db.add('entries', entry);
            console.log(`Saved entry to database: ${entry.id} for workspace: ${workspacePath}`);

            const currentActiveTodo = getCurrentActiveTodo ? getCurrentActiveTodo() : null;
            if (currentActiveTodo) {
              await persistentDB.addFileToTodo(currentActiveTodo, relativePath);
              await persistentDB.linkEventToTodo('file_change', entry.id);
              console.log(
                `   [TODO] Linked file change ${entry.id} (${relativePath}) to TODO ${currentActiveTodo}`
              );
            }

            updateWorkspaceData(workspacePath, entry, null);

            const ttfeMetrics = productivityTracker.trackFileEdit(entry);

            if (entry.source === 'ai-generated' || entry.prompt_id) {
              productivityTracker.trackCodeChurn(entry);
            }

            productivityTracker.detectDebugActivity(entry);
            productivityTracker.trackActivity('file_change');

            io.emit('new-entry', entry);
            io.emit('entries-update', db.entries);
            broadcastUpdate('file-change', {
              id: entry.id,
              sessionId: entry.session_id,
              filePath: relativePath,
              changeType: 'modified',
              timestamp: new Date().toISOString(),
              beforeContent: previousContent,
              afterContent: content,
              diff: diff.summary,
            });
          } catch (error) {
            console.error('Error saving entry to database:', error);
          }

          try {
            const entryTime = new Date(entry.timestamp).getTime();
            const fiveMinutesAgo = entryTime - 5 * 60 * 1000;

            const recentPrompts = await persistentDB.getPromptsInTimeRange(
              new Date(fiveMinutesAgo).toISOString(),
              new Date(entryTime).toISOString(),
              50
            );

            const candidatePrompts = recentPrompts
              .filter((p) => {
                const status = p.status || 'captured';
                const linkedEntryId = p.linked_entry_id || p.linkedEntryId;
                return (status === 'pending' || status === 'captured') && !linkedEntryId;
              })
              .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            const lastPrompt = candidatePrompts[0];

            if (lastPrompt) {
              await persistentDB.updatePrompt(lastPrompt.id, {
                status: 'linked',
                linked_entry_id: entry.id,
              });

              await persistentDB.updateEntry(entry.id, {
                prompt_id: lastPrompt.id,
              });

              const inMemoryPrompt = db.prompts.find((p) => p.id === lastPrompt.id);
              if (inMemoryPrompt) {
                inMemoryPrompt.status = 'linked';
                inMemoryPrompt.linked_entry_id = entry.id;
              }
              entry.prompt_id = lastPrompt.id;

              const promptText = lastPrompt.text || lastPrompt.prompt || lastPrompt.content || '';
              console.log(
                `Linked prompt ${lastPrompt.id} ("${promptText.substring(0, 50)}...") to entry ${entry.id}`
              );
            }
          } catch (error) {
            console.error('Error linking prompt to entry:', error);
          }

          const event = {
            id: crypto.randomUUID(),
            session_id: workspaceSession,
            workspace_path: workspacePath,
            timestamp: entry.timestamp,
            type: 'code_change',
            details: JSON.stringify({
              file_path: relativePath,
              diff_summary: diff.summary,
              diff_size: diff.diffSize,
              lines_added: diff.linesAdded,
              lines_removed: diff.linesRemoved,
              chars_added: diff.charsAdded,
              chars_deleted: diff.charsDeleted,
              before_content:
                diff.beforeContent.length > 10000
                  ? diff.beforeContent.substring(0, 10000) + '\n... (truncated)'
                  : diff.beforeContent,
              after_content:
                diff.afterContent.length > 10000
                  ? diff.afterContent.substring(0, 10000) + '\n... (truncated)'
                  : diff.afterContent,
            }),
          };

          enqueue('entry', entry);
          enqueue('event', event);

          updateWorkspaceData(workspacePath, null, event);

          console.log(`File change detected: ${relativePath} in workspace: ${workspacePath}`);

          // Detect plots from code changes (for Python scripts)
          if (plotService && (filePath.endsWith('.py') || filePath.endsWith('.ipynb'))) {
            try {
              if (filePath.endsWith('.ipynb')) {
                // Process notebook for plots
                plotService
                  .processNotebook(filePath, {
                    workspacePath,
                    autoTrack: true,
                  })
                  .then((result) => {
                    if (result.success && result.count > 0) {
                      console.log(
                        `[PLOT] Extracted ${result.count} plots from notebook: ${relativePath}`
                      );
                    }
                  })
                  .catch((err) => {
                    console.warn(`[PLOT] Error processing notebook: ${err.message}`);
                  });
              } else if (filePath.endsWith('.py')) {
                // Detect plot patterns in Python code
                plotService
                  .detectPlotsFromCode(content, filePath, {
                    workspacePath,
                  })
                  .then((result) => {
                    if (result.success && result.detectedPaths.length > 0) {
                      console.log(
                        `[PLOT] Detected ${result.detectedPaths.length} plot patterns in: ${relativePath}`
                      );
                    }
                  })
                  .catch((err) => {
                    console.warn(`[PLOT] Error detecting plots from code: ${err.message}`);
                  });
              }
            } catch (err) {
              console.warn(`[PLOT] Error in plot detection: ${err.message}`);
            }
          }
        } else {
          console.log(`Change too small for ${relativePath}: ${diff.summary}`);
        }

        fileSnapshots.set(filePath, content);
      } else {
        console.log(`No content change for ${relativePath}`);
      }
    } catch (error) {
      console.error(` Error processing file ${filePath}:`, error.message);
    }
  }

  function start() {
    if (watcher) {
      watcher.close();
    }

    const workspacesToWatch = config.workspace_roots || config.workspaces || [config.root_dir];
    const autoDetect = config.auto_detect_workspaces !== false;

    if (autoDetect) {
      console.log(
        ` Starting automatic workspace detection from ${workspacesToWatch.length} root(s):`
      );
    } else {
      console.log(` Starting file watcher for ${workspacesToWatch.length} workspace(s):`);
    }
    workspacesToWatch.forEach((ws, i) => {
      console.log(`   ${i + 1}. ${ws}`);
    });
    console.log(` Ignoring: ${config.ignore.join(', ')}`);

    watcher = chokidar.watch(workspacesToWatch, {
      ignored: config.ignore,
      persistent: true,
      ignoreInitial: true,
      depth: autoDetect ? 99 : 10,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    watcher
      .on('add', (filePath) => {
        processFileChange(filePath);
      })
      .on('change', processFileChange)
      .on('unlink', async (filePath) => {
        const detectedWorkspace = await detectWorkspace(filePath);
        fileSnapshots.delete(filePath);
        const relativePath = path.relative(detectedWorkspace || config.root_dir, filePath);
        console.log(` File deleted: ${relativePath} from workspace: ${detectedWorkspace}`);

        // Start plot file monitoring when workspace is detected
        if (plotService && detectedWorkspace && fs.existsSync(detectedWorkspace)) {
          try {
            const PlotFileMonitor = require('../monitors/plot-file-monitor');
            if (!global.plotFileMonitors) {
              global.plotFileMonitors = new Map();
            }
            if (!global.plotFileMonitors.has(detectedWorkspace)) {
              const plotFileMonitor = new PlotFileMonitor(plotService);
              plotFileMonitor.start(detectedWorkspace);
              global.plotFileMonitors.set(detectedWorkspace, plotFileMonitor);
              console.log(
                `[PLOT] Started plot file monitoring for workspace: ${detectedWorkspace}`
              );
            }
          } catch (err) {
            console.warn(`[PLOT] Error starting plot file monitor: ${err.message}`);
          }
        }
      })
      .on('error', (error) => console.error(` Watcher error: ${error}`))
      .on('ready', () => {
        console.log(' File watcher ready');

        // Start plot file monitoring for detected workspaces
        if (plotService && typeof plotService !== 'undefined') {
          const workspacesToWatch = config.workspace_roots ||
            config.workspaces || [config.root_dir];
          workspacesToWatch.forEach((workspacePath) => {
            if (fs.existsSync(workspacePath)) {
              try {
                const PlotFileMonitor = require('../monitors/plot-file-monitor');
                const plotFileMonitor = new PlotFileMonitor(plotService);
                plotFileMonitor.start(workspacePath);
                console.log(`[PLOT] Started plot file monitoring for workspace: ${workspacePath}`);
              } catch (err) {
                console.warn(`[PLOT] Error starting plot file monitor: ${err.message}`);
              }
            }
          });
        }
      });
  }

  function stop() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  }

  return {
    start,
    stop,
    calculateDiff, // Export for use elsewhere if needed
  };
}

module.exports = createFileWatcherService;
