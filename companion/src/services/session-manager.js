/**
 * Session and workspace management service
 */

const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(cursorDbParser = null) {
    this.activeSession = 'session-' + Date.now();
    this.lastActivityTime = Date.now();
    this.SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
    this.currentWorkspace = process.cwd(); // Default workspace
    this.workspaceSessions = new Map(); // Map of workspace paths to active sessions
    this.workspaceData = new Map(); // Map of workspace paths to their data
    this.knownWorkspaces = new Set(); // Track all discovered workspaces
    this.cursorDbParser = cursorDbParser; // Store reference to Cursor DB parser
    this.workspaceCache = null; // Cache for workspace paths from Cursor DB
    this.workspaceCacheTime = 0;
    this.WORKSPACE_CACHE_TTL = 5 * 60 * 1000; // Cache for 5 minutes
  }

  createNewSession() {
    this.activeSession = 'session-' + Date.now();
    this.lastActivityTime = Date.now();
    console.log(`[SYNC] Created new session: ${this.activeSession}`);
    return this.activeSession;
  }

  checkSessionTimeout() {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTime;

    if (timeSinceLastActivity > this.SESSION_TIMEOUT) {
      console.log(
        `[TIME] Session timeout reached (${Math.round(timeSinceLastActivity / 60000)} minutes), creating new session`
      );
      this.createNewSession();
    }
  }

  updateActivityTime() {
    this.lastActivityTime = Date.now();
  }

  /**
   * Get workspace paths from Cursor database (UI state)
   * Uses caching to avoid frequent database queries
   */
  async getCursorWorkspaces() {
    const now = Date.now();

    // Return cached workspaces if still valid
    if (this.workspaceCache && now - this.workspaceCacheTime < this.WORKSPACE_CACHE_TTL) {
      return this.workspaceCache;
    }

    // If no cursorDbParser available, return empty array
    if (!this.cursorDbParser) {
      return [];
    }

    try {
      const workspaces = await this.cursorDbParser.getAllWorkspaces();
      // Extract just the paths and normalize them
      const workspacePaths = workspaces
        .map((ws) => ws.path)
        .filter(Boolean) // Filter out null/undefined paths
        .map((wsPath) => {
          // Normalize path separators
          return wsPath.replace(/\\/g, '/');
        });

      this.workspaceCache = workspacePaths;
      this.workspaceCacheTime = now;

      // Also add to knownWorkspaces
      workspacePaths.forEach((wsPath) => this.knownWorkspaces.add(wsPath));

      return workspacePaths;
    } catch (error) {
      console.warn('[SESSION-MANAGER] Error getting workspaces from Cursor DB:', error.message);
      return [];
    }
  }

  /**
   * Check if a file path belongs to any known Cursor workspace
   */
  async findWorkspaceFromCursorDb(filePath) {
    if (!filePath || !this.cursorDbParser) {
      return null;
    }

    const cursorWorkspaces = await this.getCursorWorkspaces();
    if (cursorWorkspaces.length === 0) {
      return null;
    }

    // Normalize the file path
    const normalizedFilePath = path.isAbsolute(filePath)
      ? filePath.replace(/\\/g, '/')
      : path.resolve(filePath).replace(/\\/g, '/');

    // Check if file path is within any known workspace
    for (const workspacePath of cursorWorkspaces) {
      const normalizedWorkspace = workspacePath.replace(/\\/g, '/');

      // Check if file is within this workspace
      if (
        normalizedFilePath.startsWith(normalizedWorkspace + '/') ||
        normalizedFilePath === normalizedWorkspace
      ) {
        return normalizedWorkspace;
      }
    }

    return null;
  }

  async detectWorkspace(filePath) {
    if (!filePath) return this.currentWorkspace;

    // FIRST: Try to find workspace from Cursor database (UI state)
    // This is the most reliable source as it uses actual workspace information
    try {
      const cursorWorkspace = await this.findWorkspaceFromCursorDb(filePath);
      if (cursorWorkspace) {
        this.knownWorkspaces.add(cursorWorkspace);
        return cursorWorkspace;
      }
    } catch (error) {
      console.warn('[SESSION-MANAGER] Error checking Cursor DB for workspace:', error.message);
      // Fall through to directory-based detection
    }

    // FALLBACK: Use directory-based detection (existing logic)
    // This is only used if Cursor DB doesn't have the workspace
    let searchPath = path.isAbsolute(filePath) ? path.dirname(filePath) : path.resolve(filePath);

    // First pass: look for .git directory (highest priority - marks the true project root)
    let currentSearch = searchPath;
    let gitRoot = null;
    const maxDepth = 15;
    let depth = 0;

    while (currentSearch !== path.dirname(currentSearch) && depth < maxDepth) {
      const gitPath = path.join(currentSearch, '.git');
      if (fs.existsSync(gitPath)) {
        gitRoot = currentSearch;
        break; // Return the nearest .git (correct for monorepos/nested repos)
      }
      currentSearch = path.dirname(currentSearch);
      depth++;
    }

    // If we found a git root, that's the workspace
    if (gitRoot) {
      this.knownWorkspaces.add(gitRoot);
      return gitRoot;
    }

    // Second pass: if no .git found, look for other strong workspace indicators
    // but only at reasonably high levels (not deep nested directories)
    currentSearch = searchPath;
    depth = 0;
    const strongIndicators = ['.cursor', 'Cargo.toml', 'go.mod', 'requirements.txt', 'pom.xml'];

    while (currentSearch !== path.dirname(currentSearch) && depth < maxDepth) {
      // Check for strong indicators
      for (const indicator of strongIndicators) {
        const indicatorPath = path.join(currentSearch, indicator);
        if (fs.existsSync(indicatorPath)) {
          // Only accept if it's at a reasonable level (not too deep)
          const parts = currentSearch.split(path.sep);
          if (parts.length <= 7) {
            // Adjust based on typical depth
            this.knownWorkspaces.add(currentSearch);
            return currentSearch;
          }
        }
      }
      currentSearch = path.dirname(currentSearch);
      depth++;
    }

    // Third pass: look for well-known parent directories
    const parts = searchPath.split(path.sep);
    for (let i = parts.length - 1; i >= 3; i--) {
      const dirName = parts[i];
      if (
        ['Desktop', 'Documents', 'Projects', 'Code', 'dev', 'workspace', 'repos'].includes(dirName)
      ) {
        // Take the directory right under this
        if (i + 1 < parts.length) {
          const workspacePath = parts.slice(0, i + 2).join(path.sep);
          this.knownWorkspaces.add(workspacePath);
          return workspacePath;
        }
      }
    }

    // Last resort: use a reasonable parent (3-4 levels deep from root)
    if (parts.length > 4) {
      const workspacePath = parts.slice(0, 5).join(path.sep);
      this.knownWorkspaces.add(workspacePath);
      return workspacePath;
    }

    this.knownWorkspaces.add(searchPath);
    return searchPath;
  }

  getWorkspaceSession(workspacePath) {
    if (!this.workspaceSessions.has(workspacePath)) {
      this.workspaceSessions.set(workspacePath, 'session-' + Date.now());
    }
    return this.workspaceSessions.get(workspacePath);
  }

  updateWorkspaceData(workspacePath, entry, event) {
    if (!this.workspaceData.has(workspacePath)) {
      this.workspaceData.set(workspacePath, {
        entries: [],
        events: [],
        lastActivity: Date.now(),
      });
    }

    const data = this.workspaceData.get(workspacePath);
    if (entry) data.entries.push(entry);
    if (event) data.events.push(event);
    data.lastActivity = Date.now();
  }

  getWorkspaceData(workspacePath) {
    return this.workspaceData.get(workspacePath);
  }

  getAllWorkspaces() {
    return Array.from(this.knownWorkspaces);
  }
}

module.exports = SessionManager;
