/**
 * Workspace Discovery Service
 * Automatically discovers workspaces from Cursor's storage and registered paths
 * Enables the companion service to run globally without workspace-specific configuration
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class WorkspaceDiscoveryService {
  constructor(config = {}) {
    this.config = config;
    this.discoveredWorkspaces = new Map();
    this.registeredWorkspaces = new Set();
    this.watchedPaths = new Set();
    this.lastDiscovery = null;
    this.discoveryInterval = null;

    // Cursor storage locations by platform
    this.cursorStoragePaths = this.getCursorStoragePaths();
  }

  /**
   * Get Cursor storage paths for the current platform
   */
  getCursorStoragePaths() {
    const home = os.homedir();
    const platform = os.platform();

    if (platform === 'darwin') {
      return {
        storage: path.join(
          home,
          'Library',
          'Application Support',
          'Cursor',
          'User',
          'workspaceStorage'
        ),
        globalStorage: path.join(
          home,
          'Library',
          'Application Support',
          'Cursor',
          'User',
          'globalStorage'
        ),
        recentWorkspaces: path.join(
          home,
          'Library',
          'Application Support',
          'Cursor',
          'User',
          'globalStorage',
          'state.vscdb'
        ),
        cursorState: path.join(home, 'Library', 'Application Support', 'Cursor', 'storage.json'),
      };
    } else if (platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return {
        storage: path.join(appData, 'Cursor', 'User', 'workspaceStorage'),
        globalStorage: path.join(appData, 'Cursor', 'User', 'globalStorage'),
        recentWorkspaces: path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        cursorState: path.join(appData, 'Cursor', 'storage.json'),
      };
    } else {
      // Linux
      return {
        storage: path.join(home, '.config', 'Cursor', 'User', 'workspaceStorage'),
        globalStorage: path.join(home, '.config', 'Cursor', 'User', 'globalStorage'),
        recentWorkspaces: path.join(
          home,
          '.config',
          'Cursor',
          'User',
          'globalStorage',
          'state.vscdb'
        ),
        cursorState: path.join(home, '.config', 'Cursor', 'storage.json'),
      };
    }
  }

  /**
   * Initialize the discovery service
   */
  async initialize() {
    console.log('[WORKSPACE-DISCOVERY] Initializing workspace discovery service...');

    // Load any manually registered workspaces
    await this.loadRegisteredWorkspaces();

    // Perform initial discovery
    await this.discoverWorkspaces();

    // Start periodic discovery (every 5 minutes)
    this.discoveryInterval = setInterval(
      () => {
        this.discoverWorkspaces().catch((err) => {
          console.error('[WORKSPACE-DISCOVERY] Periodic discovery failed:', err.message);
        });
      },
      5 * 60 * 1000
    );

    console.log(`[WORKSPACE-DISCOVERY] Found ${this.discoveredWorkspaces.size} workspaces`);
    return this.getWatchPaths();
  }

  /**
   * Discover workspaces from Cursor's storage
   */
  async discoverWorkspaces() {
    const workspaces = new Map();

    // 1. Discover from Cursor workspace storage
    try {
      const storagePath = this.cursorStoragePaths.storage;
      if (fs.existsSync(storagePath)) {
        const entries = fs.readdirSync(storagePath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const workspaceJsonPath = path.join(storagePath, entry.name, 'workspace.json');
            if (fs.existsSync(workspaceJsonPath)) {
              try {
                const workspaceData = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
                const folderUri = workspaceData.folder;

                if (folderUri && folderUri.startsWith('file://')) {
                  const folderPath = decodeURIComponent(folderUri.replace('file://', ''));
                  if (fs.existsSync(folderPath)) {
                    workspaces.set(folderPath, {
                      path: folderPath,
                      name: path.basename(folderPath),
                      source: 'cursor-storage',
                      lastOpened: this.getLastModified(workspaceJsonPath),
                      storageId: entry.name,
                    });
                  }
                }
              } catch (e) {
                // Skip invalid workspace.json files
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[WORKSPACE-DISCOVERY] Error reading Cursor storage:', err.message);
    }

    // 2. Add manually registered workspaces
    for (const wsPath of this.registeredWorkspaces) {
      if (fs.existsSync(wsPath) && !workspaces.has(wsPath)) {
        workspaces.set(wsPath, {
          path: wsPath,
          name: path.basename(wsPath),
          source: 'registered',
          lastOpened: null,
        });
      }
    }

    // 3. Add workspaces from config
    const configRoots = this.config.workspace_roots || [];
    for (const root of configRoots) {
      const expandedPath = root.replace(/^~/, os.homedir());
      if (fs.existsSync(expandedPath) && !workspaces.has(expandedPath)) {
        workspaces.set(expandedPath, {
          path: expandedPath,
          name: path.basename(expandedPath),
          source: 'config',
          lastOpened: null,
        });
      }
    }

    // 4. Add additional watch paths from config
    const additionalPaths = this.config.additional_watch_paths || [];
    for (const watchPath of additionalPaths) {
      const expandedPath = watchPath.replace(/^~/, os.homedir());
      if (fs.existsSync(expandedPath) && !workspaces.has(expandedPath)) {
        workspaces.set(expandedPath, {
          path: expandedPath,
          name: path.basename(expandedPath),
          source: 'additional',
          lastOpened: null,
        });
      }
    }

    this.discoveredWorkspaces = workspaces;
    this.lastDiscovery = new Date();

    return workspaces;
  }

  /**
   * Get last modified time of a file
   */
  getLastModified(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.mtime;
    } catch {
      return null;
    }
  }

  /**
   * Register a workspace manually
   */
  registerWorkspace(workspacePath) {
    const normalizedPath = path.resolve(workspacePath);

    if (!fs.existsSync(normalizedPath)) {
      return { success: false, error: 'Path does not exist' };
    }

    this.registeredWorkspaces.add(normalizedPath);
    this.saveRegisteredWorkspaces();

    // Add to discovered workspaces immediately
    if (!this.discoveredWorkspaces.has(normalizedPath)) {
      this.discoveredWorkspaces.set(normalizedPath, {
        path: normalizedPath,
        name: path.basename(normalizedPath),
        source: 'registered',
        lastOpened: new Date(),
      });
    }

    return { success: true, path: normalizedPath };
  }

  /**
   * Unregister a workspace
   */
  unregisterWorkspace(workspacePath) {
    const normalizedPath = path.resolve(workspacePath);
    this.registeredWorkspaces.delete(normalizedPath);
    this.saveRegisteredWorkspaces();

    // Only remove if it was a registered workspace (not from Cursor storage)
    const ws = this.discoveredWorkspaces.get(normalizedPath);
    if (ws && ws.source === 'registered') {
      this.discoveredWorkspaces.delete(normalizedPath);
    }

    return { success: true };
  }

  /**
   * Load registered workspaces from persistent storage
   */
  async loadRegisteredWorkspaces() {
    const dataDir = this.getDataDirectory();
    const registeredFile = path.join(dataDir, 'registered-workspaces.json');

    try {
      if (fs.existsSync(registeredFile)) {
        const data = JSON.parse(fs.readFileSync(registeredFile, 'utf8'));
        this.registeredWorkspaces = new Set(data.workspaces || []);
      }
    } catch (err) {
      console.warn('[WORKSPACE-DISCOVERY] Error loading registered workspaces:', err.message);
    }
  }

  /**
   * Save registered workspaces to persistent storage
   */
  saveRegisteredWorkspaces() {
    const dataDir = this.getDataDirectory();
    const registeredFile = path.join(dataDir, 'registered-workspaces.json');

    try {
      // Ensure data directory exists
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(
        registeredFile,
        JSON.stringify(
          {
            workspaces: Array.from(this.registeredWorkspaces),
            lastUpdated: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error('[WORKSPACE-DISCOVERY] Error saving registered workspaces:', err.message);
    }
  }

  /**
   * Get data directory path
   */
  getDataDirectory() {
    const configDataDir = this.config.data_directory;
    if (configDataDir) {
      return configDataDir.replace(/^~/, os.homedir());
    }
    return path.join(os.homedir(), '.cursor-telemetry');
  }

  /**
   * Get all paths that should be watched
   */
  getWatchPaths() {
    return Array.from(this.discoveredWorkspaces.keys());
  }

  /**
   * Get workspace info by path
   */
  getWorkspace(workspacePath) {
    return this.discoveredWorkspaces.get(path.resolve(workspacePath));
  }

  /**
   * Get all discovered workspaces
   */
  getAllWorkspaces() {
    return Array.from(this.discoveredWorkspaces.values());
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      mode: this.config.service_mode || 'global',
      workspaceCount: this.discoveredWorkspaces.size,
      registeredCount: this.registeredWorkspaces.size,
      lastDiscovery: this.lastDiscovery,
      cursorStoragePath: this.cursorStoragePaths.storage,
      workspaces: this.getAllWorkspaces().map((ws) => ({
        path: ws.path,
        name: ws.name,
        source: ws.source,
      })),
    };
  }

  /**
   * Stop the discovery service
   */
  stop() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }
}

module.exports = WorkspaceDiscoveryService;
