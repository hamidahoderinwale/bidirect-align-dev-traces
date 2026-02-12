/**
 * Module Graph Data Extractor
 * Extracts file-level interaction data from Cursor DB
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // Keep sync for existsSync checks that are fast
const os = require('os');
const { getConfig } = require('./config');

const execAsync = promisify(exec);

class ModuleGraphExtractor {
  constructor(cursorDbParser = null) {
    this.cursorDbParser = cursorDbParser;
    this.dbPaths = this.findCursorDatabases();
  }

  findCursorDatabases() {
    const basePath = path.join(os.homedir(), 'Library/Application Support/Cursor');
    return {
      global: path.join(basePath, 'User/globalStorage/state.vscdb'),
      workspaces: path.join(basePath, 'User/workspaceStorage'),
    };
  }

  /**
   * Extract all file paths from inlineDiffs
   */
  async extractFilePaths(workspacePath = null) {
    const filePaths = new Set();
    const fileMetadata = new Map();

    try {
      // Extract from global database (async)
      const { global } = this.dbPaths;
      if (fsSync.existsSync(global)) {
        await this.extractFilePathsFromDB(global, filePaths, fileMetadata, workspacePath);
      }

      // Extract from workspace databases (async)
      const { workspaces } = this.dbPaths;
      if (fsSync.existsSync(workspaces)) {
        const workspaceDirs = await fs.readdir(workspaces);

        if (workspacePath) {
          // Find workspace-specific database
          for (const wsDir of workspaceDirs) {
            const wsDbPath = path.join(workspaces, wsDir, 'state.vscdb');
            if (fsSync.existsSync(wsDbPath)) {
              // Check if this workspace matches
              const wsJsonPath = path.join(workspaces, wsDir, 'workspace.json');
              try {
                if (fsSync.existsSync(wsJsonPath)) {
                  const wsJsonContent = await fs.readFile(wsJsonPath, 'utf8');
                  const wsJson = JSON.parse(wsJsonContent);
                  const wsFolder = wsJson.folder?.replace(/^file:\/\//, '');
                  if (wsFolder === workspacePath) {
                    await this.extractFilePathsFromDB(
                      wsDbPath,
                      filePaths,
                      fileMetadata,
                      workspacePath
                    );
                    break;
                  }
                }
              } catch (e) {
                // Continue to next workspace
              }
            }
          }
        } else {
          // Extract from all workspace databases (parallel)
          const dbPromises = workspaceDirs.map(async (wsDir) => {
            const wsDbPath = path.join(workspaces, wsDir, 'state.vscdb');
            if (fsSync.existsSync(wsDbPath)) {
              await this.extractFilePathsFromDB(wsDbPath, filePaths, fileMetadata, null);
            }
          });
          await Promise.all(dbPromises);
        }
      }
    } catch (error) {
      console.warn('[MODULE-GRAPH] Error extracting file paths:', error.message);
    }

    return {
      filePaths: Array.from(filePaths),
      fileMetadata: Object.fromEntries(fileMetadata),
    };
  }

  async extractFilePathsFromDB(dbPath, filePaths, fileMetadata, workspacePath) {
    try {
      // Extract inlineDiffs keys
      const query = `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'inlineDiffs-%'`;
      const { stdout } = await execAsync(`sqlite3 "${dbPath}" "${query}"`);

      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) continue;

        const key = line.substring(0, tabIndex);
        const value = line.substring(tabIndex + 1);

        try {
          const diffs = JSON.parse(value);
          if (Array.isArray(diffs)) {
            for (const diff of diffs) {
              if (diff.uri) {
                const filePath =
                  diff.uri.fsPath || diff.uri.path || diff.uri.external?.replace(/^file:\/\//, '');
                if (filePath) {
                  // Filter by workspace if specified
                  if (!workspacePath || filePath.startsWith(workspacePath)) {
                    filePaths.add(filePath);

                    // Store metadata
                    if (!fileMetadata.has(filePath)) {
                      fileMetadata.set(filePath, {
                        path: filePath,
                        diffs: [],
                        editCount: 0,
                        originalLines: diff.originalTextLines || [],
                        modifiedLines: diff.modifiedTextLines || [],
                        lastModified: null,
                        firstSeen: null,
                      });
                    }

                    const meta = fileMetadata.get(filePath);
                    meta.diffs.push({
                      diffId: diff.diffId,
                      timestamp: diff.timestamp || Date.now(),
                      originalTextLines: diff.originalTextLines || [],
                      modifiedTextLines: diff.modifiedTextLines || [],
                      promptId: diff.promptId || null,
                    });
                    meta.editCount++;

                    if (
                      diff.originalTextLines &&
                      diff.originalTextLines.length > meta.originalLines.length
                    ) {
                      meta.originalLines = diff.originalTextLines;
                    }
                    if (
                      diff.modifiedTextLines &&
                      diff.modifiedTextLines.length > meta.modifiedLines.length
                    ) {
                      meta.modifiedLines = diff.modifiedTextLines;
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    } catch (error) {
      console.warn(`[MODULE-GRAPH] Error extracting from ${dbPath}:`, error.message);
    }
  }

  /**
   * Extract model context files from messageRequestContext
   */
  async extractModelContextFiles(workspacePath = null) {
    const contextMap = new Map(); // file -> [context files]

    try {
      const { global } = this.dbPaths;
      if (fsSync.existsSync(global)) {
        await this.extractModelContextFromDB(global, contextMap, workspacePath);
      }

      // Also check workspace databases (parallel)
      const { workspaces } = this.dbPaths;
      if (fsSync.existsSync(workspaces)) {
        const workspaceDirs = await fs.readdir(workspaces);
        const dbPromises = workspaceDirs.map(async (wsDir) => {
          const wsDbPath = path.join(workspaces, wsDir, 'state.vscdb');
          if (fsSync.existsSync(wsDbPath)) {
            await this.extractModelContextFromDB(wsDbPath, contextMap, workspacePath);
          }
        });
        await Promise.all(dbPromises);
      }
    } catch (error) {
      console.warn('[MODULE-GRAPH] Error extracting model context:', error.message);
    }

    return Object.fromEntries(contextMap);
  }

  async extractModelContextFromDB(dbPath, contextMap, workspacePath) {
    try {
      const query = `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%' LIMIT 1000`;
      const { stdout } = await execAsync(`sqlite3 "${dbPath}" "${query}"`);

      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) continue;

        const key = line.substring(0, tabIndex);
        const value = line.substring(tabIndex + 1);

        try {
          const context = JSON.parse(value);

          // Extract context files from various possible fields
          const contextFiles =
            context.context_files ||
            context.contextFiles ||
            context.files ||
            context.request?.context_files ||
            context.request?.files ||
            [];

          if (Array.isArray(contextFiles) && contextFiles.length > 0) {
            // Extract the file being edited (from key or context)
            const keyParts = key.split(':');
            const conversationId = keyParts[1];

            // Try to find the target file from context
            const targetFile = context.target_file || context.file || context.request?.file || null;

            if (targetFile) {
              const targetPath =
                typeof targetFile === 'string' ? targetFile : targetFile.path || targetFile.fsPath;
              if (targetPath && (!workspacePath || targetPath.startsWith(workspacePath))) {
                if (!contextMap.has(targetPath)) {
                  contextMap.set(targetPath, []);
                }

                // Add context files
                contextFiles.forEach((ctxFile) => {
                  const ctxPath =
                    typeof ctxFile === 'string' ? ctxFile : ctxFile.path || ctxFile.fsPath;
                  if (
                    ctxPath &&
                    ctxPath !== targetPath &&
                    (!workspacePath || ctxPath.startsWith(workspacePath))
                  ) {
                    if (!contextMap.get(targetPath).includes(ctxPath)) {
                      contextMap.get(targetPath).push(ctxPath);
                    }
                  }
                });
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    } catch (error) {
      console.warn(`[MODULE-GRAPH] Error extracting model context from ${dbPath}:`, error.message);
    }
  }

  /**
   * Extract tool interactions
   */
  async extractToolInteractions(workspacePath = null) {
    const toolInteractions = [];

    try {
      const { global } = this.dbPaths;
      if (fs.existsSync(global)) {
        // Extract terminal history
        const terminalQuery = `SELECT value FROM ItemTable WHERE key = 'terminal.history.entries.commands'`;
        try {
          const { stdout: terminalData } = await execAsync(
            `sqlite3 "${global}" "${terminalQuery}"`
          );
          if (terminalData.trim()) {
            const commands = JSON.parse(terminalData.trim());
            if (Array.isArray(commands)) {
              commands.forEach((cmd) => {
                if (cmd.command && cmd.workspace) {
                  const cmdWorkspace = cmd.workspace.replace(/^file:\/\//, '');
                  if (!workspacePath || cmdWorkspace.startsWith(workspacePath)) {
                    toolInteractions.push({
                      type: 'terminal',
                      command: cmd.command,
                      workspace: cmdWorkspace,
                      timestamp: cmd.timestamp || Date.now(),
                      tool: 'terminal',
                    });
                  }
                }
              });
            }
          }
        } catch (e) {
          // Terminal history might not exist
        }

        // Extract Jupyter interactions
        const jupyterQuery = `SELECT value FROM ItemTable WHERE key = 'ms-toolsai.jupyter'`;
        try {
          const { stdout: jupyterData } = await execAsync(`sqlite3 "${global}" "${jupyterQuery}"`);
          if (jupyterData.trim()) {
            const jupyterData = JSON.parse(jupyterData.trim());
            // Process Jupyter data if available
            // Structure depends on Jupyter extension format
          }
        } catch (e) {
          // Jupyter data might not exist
        }
      }
    } catch (error) {
      console.warn('[MODULE-GRAPH] Error extracting tool interactions:', error.message);
    }

    return toolInteractions;
  }

  /**
   * Extract all module graph data
   */
  async extractAll(workspacePath = null) {
    console.log('[MODULE-GRAPH] Extracting file-level data...');

    try {
      const timeout = getConfig('extraction.timeout', 20000);
      const progressCallback = getConfig('extraction.progressCallback', null);

      // Add timeout to prevent hanging on large extractions
      const extractionPromise = Promise.all([
        this.extractFilePaths(workspacePath).catch((err) => {
          console.warn('[MODULE-GRAPH] Error extracting file paths:', err.message);
          return { filePaths: [], fileMetadata: {} };
        }),
        this.extractModelContextFiles(workspacePath).catch((err) => {
          console.warn('[MODULE-GRAPH] Error extracting model context:', err.message);
          return {};
        }),
        this.extractToolInteractions(workspacePath).catch((err) => {
          console.warn('[MODULE-GRAPH] Error extracting tool interactions:', err.message);
          return [];
        }),
      ]);

      // Configurable timeout for extraction
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(`Extraction timeout - database queries taking too long (${timeout}ms)`)
            ),
          timeout
        );
      });

      if (progressCallback) {
        progressCallback({ stage: 'extracting', progress: 0 });
      }

      const [fileData, modelContext, toolInteractions] = await Promise.race([
        extractionPromise,
        timeoutPromise,
      ]);

      if (progressCallback) {
        progressCallback({ stage: 'extracted', progress: 100 });
      }

      return {
        filePaths: fileData.filePaths,
        fileMetadata: fileData.fileMetadata,
        modelContext,
        toolInteractions,
        extractedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[MODULE-GRAPH] Extraction failed:', error.message);
      // Return empty structure on error to prevent complete failure
      return {
        filePaths: [],
        fileMetadata: {},
        modelContext: {},
        toolInteractions: [],
        extractedAt: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}

module.exports = ModuleGraphExtractor;
