/**
 * Data capture service - handles system resources, git, cursor database, and log monitoring
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class DataCaptureService {
  constructor(
    rawData,
    persistentDB,
    cursorDbParser,
    ideStateCapture,
    promptCaptureSystem,
    statusMessageTracker
  ) {
    this.rawData = rawData;
    this.persistentDB = persistentDB;
    this.cursorDbParser = cursorDbParser;
    this.ideStateCapture = ideStateCapture;
    this.promptCaptureSystem = promptCaptureSystem;
    this.statusMessageTracker = statusMessageTracker;
    this.captureIntervals = {};
    this.syncedPromptIds = new Set();
    this.syncInProgress = false;
    this.initialSyncComplete = false;
  }

  async captureSystemResources() {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const loadAvg = os.loadavg();
      const cpuCores = os.cpus().length;

      const resourceData = {
        timestamp: Date.now(),
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external,
          arrayBuffers: memUsage.arrayBuffers,
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
        },
        system: {
          loadAverage: loadAvg,
          cpuCores: cpuCores,
          freeMemory: os.freemem(),
          totalMemory: os.totalmem(),
          uptime: os.uptime(),
          platform: os.platform(),
          arch: os.arch(),
        },
      };

      this.rawData.systemResources.push(resourceData);

      // Keep only last 1000 entries
      if (this.rawData.systemResources.length > 1000) {
        this.rawData.systemResources = this.rawData.systemResources.slice(-1000);
      }

      console.log(
        `[DATA] Captured system resources: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB memory`
      );
    } catch (error) {
      console.error('Error capturing system resources:', error);
    }
  }

  async captureGitData() {
    try {
      // Get git status
      const { stdout: gitStatus } = await execAsync('git status --porcelain');
      const { stdout: gitBranch } = await execAsync('git branch --show-current');
      const { stdout: gitLog } = await execAsync('git log --oneline -10');

      const gitData = {
        timestamp: Date.now(),
        branch: gitBranch.trim(),
        status: gitStatus
          .trim()
          .split('\n')
          .filter((line) => line),
        recentCommits: gitLog
          .trim()
          .split('\n')
          .filter((line) => line),
      };

      this.rawData.gitData.status.push(gitData);

      // Keep only last 100 entries
      if (this.rawData.gitData.status.length > 100) {
        this.rawData.gitData.status = this.rawData.gitData.status.slice(-100);
      }

      console.log(`[NOTE] Captured git data: branch ${gitBranch.trim()}`);
    } catch (error) {
      console.warn('Git data capture failed (not a git repository?):', error.message);
    }
  }

  async captureCursorAppState() {
    try {
      const script = `
        tell application "System Events"
          set cursorProcess to first process whose name is "Cursor"
          if exists cursorProcess then
            set isActive to frontmost of cursorProcess
            set windowCount to count of windows of cursorProcess
            return {isActive, windowCount}
          else
            return {false, 0}
          end if
        end tell
      `;

      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [isActive, windowCount] = stdout
        .trim()
        .split(',')
        .map((v) => v.trim());

      const appState = {
        timestamp: Date.now(),
        isActive: isActive === 'true',
        windowCount: parseInt(windowCount) || 0,
        processName: 'Cursor',
      };

      this.rawData.appleScript.appState.push(appState);

      // Keep only last 500 entries
      if (this.rawData.appleScript.appState.length > 500) {
        this.rawData.appleScript.appState = this.rawData.appleScript.appState.slice(-500);
      }

      console.log(`[APPLE] Captured Cursor app state: active=${isActive}, windows=${windowCount}`);
    } catch (error) {
      console.warn('AppleScript capture failed:', error.message);
    }
  }

  async captureCursorDatabase() {
    try {
      const possiblePaths = [
        path.join(
          process.env.HOME || '',
          'Library/Application Support/Cursor/User/workspaceStorage'
        ),
        path.join(process.env.HOME || '', 'Library/Application Support/Cursor/User/globalStorage'),
        path.join(process.env.HOME || '', 'Library/Application Support/Cursor/logs'),
      ];

      for (const basePath of possiblePaths) {
        if (fs.existsSync(basePath)) {
          const dbFiles = this.findSQLiteFiles(basePath);
          if (dbFiles.length > 0) {
            const dbPath = dbFiles[0];
            console.log(`[DATA] Found Cursor database: ${dbPath}`);

            // Try to read basic database info
            try {
              const { stdout: tableInfo } = await execAsync(`sqlite3 "${dbPath}" ".tables"`);
              const tables = tableInfo
                .trim()
                .split(/\s+/)
                .filter((t) => t);

              const dbInfo = {
                timestamp: Date.now(),
                path: dbPath,
                tables: tables,
                size: fs.statSync(dbPath).size,
              };

              this.rawData.cursorDatabase.conversations.push(dbInfo);

              // Keep only last 50 entries
              if (this.rawData.cursorDatabase.conversations.length > 50) {
                this.rawData.cursorDatabase.conversations =
                  this.rawData.cursorDatabase.conversations.slice(-50);
              }

              console.log(`[DATA] Captured Cursor database info: ${tables.length} tables`);
              break;
            } catch (dbError) {
              console.warn('Could not read Cursor database:', dbError.message);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Cursor database capture failed:', error.message);
    }
  }

  async syncPromptsFromCursorDB(db) {
    // Prevent concurrent syncs
    if (this.syncInProgress) {
      console.log('[SYNC] Skipping - sync already in progress');
      return;
    }

    // After initial sync, only sync new prompts (not full rescan)
    if (this.initialSyncComplete && this.syncedPromptIds.size > 0) {
      console.log(
        '[SYNC] Initial sync complete - skipping periodic full rescan (use API for real-time data)'
      );
      return;
    }

    this.syncInProgress = true;

    try {
      console.log('[SYNC] Starting prompt sync cycle...');

      // Extract prompts directly without enrichment for faster sync
      const startTime = Date.now();

      // Direct extraction without expensive enrichment
      const aiServiceMessages = await this.cursorDbParser.extractAllAIServiceData();
      const prompts = aiServiceMessages || [];

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[SYNC] Extracted ${prompts.length} prompts from Cursor DB in ${duration}s`);

      if (prompts.length === 0) {
        console.log('[SYNC] No prompts to sync');
        return;
      }

      let newPrompts = 0;
      let skippedPrompts = 0;
      const promptsToSave = [];

      // Filter and prepare prompts (fast, in-memory only)
      for (const prompt of prompts) {
        // Create a unique ID based on content and timestamp
        const promptId =
          prompt.id ||
          `${prompt.composerId || ''}_${prompt.timestamp || Date.now()}_${prompt.messageRole || 'user'}`;

        // Skip if already synced
        if (this.syncedPromptIds.has(promptId)) {
          skippedPrompts++;
          continue;
        }

        // Prepare prompt for database storage
        const dbPrompt = {
          id: db.nextId++,
          timestamp: prompt.timestamp || Date.now(),
          text: prompt.text || '',
          status: prompt.status || 'captured',
          source: prompt.source || 'cursor-database',
          workspaceId: prompt.workspaceId,
          workspacePath: prompt.workspacePath,
          workspaceName: prompt.workspaceName,
          composerId: prompt.composerId,
          subtitle: prompt.subtitle,
          contextUsage: prompt.contextUsage || 0,
          mode: prompt.mode,
          modelType: prompt.modelType,
          modelName: prompt.modelName,
          forceMode: prompt.forceMode,
          isAuto: prompt.isAuto || false,
          type: prompt.type || 'unknown',
          confidence: prompt.confidence || 'high',
          added_from_database: true,
          // Threading fields
          conversationTitle: prompt.conversationTitle,
          messageRole: prompt.messageRole, // 'user' or 'assistant'
          parentConversationId: prompt.parentConversationId,
          // Thinking time
          thinkingTimeSeconds: prompt.thinkingTimeSeconds,
          // Context data
          contextFiles: prompt.contextFiles || prompt.context?.contextFiles,
          terminalBlocks: prompt.terminalBlocks || [],
          hasAttachments: prompt.hasAttachments || false,
          attachmentCount: prompt.attachmentCount || 0,
        };

        promptsToSave.push({ promptId, dbPrompt });
        this.syncedPromptIds.add(promptId);
      }

      // Batch save to database (if any new prompts)
      if (promptsToSave.length > 0) {
        console.log(`[SYNC] Saving ${promptsToSave.length} prompts to database...`);

        for (const { promptId, dbPrompt } of promptsToSave) {
          try {
            await this.persistentDB.savePrompt(dbPrompt);
            newPrompts++;
          } catch (saveError) {
            console.warn(`[SYNC] Error saving prompt ${promptId}:`, saveError.message);
            this.syncedPromptIds.delete(promptId); // Remove from cache if save failed
          }
        }
      }

      console.log(
        `[SYNC] Sync complete: ${newPrompts} new, ${skippedPrompts} skipped, ${this.syncedPromptIds.size} total tracked (${prompts.length} available in Cursor DB)`
      );

      // Mark initial sync as complete
      if (!this.initialSyncComplete && this.syncedPromptIds.size > 0) {
        this.initialSyncComplete = true;
        console.log(
          '[SYNC] Initial sync complete - future syncs disabled (prompts available via API)'
        );
      }
    } catch (error) {
      console.error('[SYNC] Error syncing prompts from Cursor database:', error.message);
      if (error.stack) console.error(error.stack);
    } finally {
      this.syncInProgress = false; // Release lock
    }
  }

  async captureLogData() {
    try {
      const logPaths = [
        path.join(process.env.HOME || '', 'Library/Application Support/Cursor/logs'),
        path.join(process.env.HOME || '', 'Library/Logs/Cursor'),
      ];

      for (const logPath of logPaths) {
        if (fs.existsSync(logPath)) {
          const logFiles = fs
            .readdirSync(logPath)
            .filter((file) => file.endsWith('.log'))
            .slice(-5); // Get last 5 log files

          for (const logFile of logFiles) {
            const fullPath = path.join(logPath, logFile);
            const stats = fs.statSync(fullPath);

            const logInfo = {
              timestamp: Date.now(),
              path: fullPath,
              size: stats.size,
              modified: stats.mtime,
              name: logFile,
            };

            this.rawData.logs.cursor.push(logInfo);
          }

          // Keep only last 100 entries
          if (this.rawData.logs.cursor.length > 100) {
            this.rawData.logs.cursor = this.rawData.logs.cursor.slice(-100);
          }

          console.log(`Captured log data: ${logFiles.length} files`);
          break;
        }
      }
    } catch (error) {
      console.warn('Log capture failed:', error.message);
    }
  }

  findSQLiteFiles(dir) {
    const files = [];
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...this.findSQLiteFiles(fullPath));
        } else if (item.endsWith('.db') || item.endsWith('.sqlite') || item.endsWith('.sqlite3')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors
    }
    return files;
  }

  start() {
    console.log('[LAUNCH] Starting enhanced raw data capture...');

    // Initialize IDE state capture
    if (this.ideStateCapture) {
      this.ideStateCapture.start(2000); // Capture every 2 seconds
    }

    // Initialize prompt capture system
    if (this.promptCaptureSystem) {
      // Already initialized
    }

    // Start status message tracking
    if (this.statusMessageTracker) {
      this.statusMessageTracker.start(2000); // Check every 2 seconds
    }

    // System resources every 5 seconds
    this.captureIntervals.systemResources = setInterval(() => this.captureSystemResources(), 5000);

    // Git data every 30 seconds
    this.captureIntervals.gitStatus = setInterval(() => this.captureGitData(), 30000);

    // AppleScript every 2 seconds
    this.captureIntervals.appleScript = setInterval(() => this.captureCursorAppState(), 2000);

    // Cursor database every 5 seconds
    this.captureIntervals.cursorDatabase = setInterval(() => this.captureCursorDatabase(), 5000);

    // Log data every 60 seconds
    this.captureIntervals.logs = setInterval(() => this.captureLogData(), 60000);

    // Initial captures
    this.captureSystemResources();
    this.captureGitData();
    this.captureCursorAppState();
    this.captureCursorDatabase();
    this.captureLogData();

    // Initial sync
    this.syncPromptsFromCursorDB();

    console.log('[SUCCESS] Enhanced raw data capture started');
  }

  stop() {
    Object.values(this.captureIntervals).forEach((interval) => clearInterval(interval));
    this.captureIntervals = {};
  }
}

module.exports = DataCaptureService;
