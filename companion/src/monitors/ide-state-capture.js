#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

/**
 * Comprehensive IDE State Capture Service
 * Captures detailed IDE state including editor, workspace, and debug information
 */
class IDEStateCapture {
  constructor() {
    this.cache = new Map();
    this.lastCapture = 0;
    this.captureInterval = null;

    // Circuit breaker for AppleScript failures
    this.appleScriptFailures = 0;
    this.appleScriptMaxFailures = 3; // Disable after 3 consecutive failures
    this.appleScriptDisabled = false;
    this.appleScriptDisabledAt = null;
    this.appleScriptCooldownMs = 5 * 60 * 1000; // 5 minute cooldown before retry
    this.appleScriptErrorLogged = false; // Only log the error once
  }

  /**
   * Check if AppleScript is available (circuit breaker pattern)
   */
  isAppleScriptAvailable() {
    if (!this.appleScriptDisabled) {
      return true;
    }

    // Check if cooldown period has passed
    if (
      this.appleScriptDisabledAt &&
      Date.now() - this.appleScriptDisabledAt > this.appleScriptCooldownMs
    ) {
      // Reset and allow retry
      this.appleScriptDisabled = false;
      this.appleScriptFailures = 0;
      this.appleScriptErrorLogged = false;
      console.log('[IDE-STATE] AppleScript circuit breaker reset, will retry');
      return true;
    }

    return false;
  }

  /**
   * Record AppleScript failure (circuit breaker)
   */
  recordAppleScriptFailure(error) {
    this.appleScriptFailures++;

    if (this.appleScriptFailures >= this.appleScriptMaxFailures && !this.appleScriptDisabled) {
      this.appleScriptDisabled = true;
      this.appleScriptDisabledAt = Date.now();

      if (!this.appleScriptErrorLogged) {
        this.appleScriptErrorLogged = true;
        console.warn(
          `[IDE-STATE] AppleScript disabled after ${this.appleScriptFailures} failures. ` +
            `Error: ${error.message}. Will retry in ${this.appleScriptCooldownMs / 60000} minutes. ` +
            `To fix: Grant Terminal/Node accessibility permissions in System Preferences > Privacy & Security > Accessibility`
        );
      }
    }
  }

  /**
   * Record AppleScript success (reset circuit breaker)
   */
  recordAppleScriptSuccess() {
    if (this.appleScriptFailures > 0) {
      this.appleScriptFailures = 0;
      this.appleScriptDisabled = false;
      this.appleScriptErrorLogged = false;
    }
  }

  /**
   * Start IDE state capture with specified interval
   */
  start(intervalMs = 2000) {
    if (this.captureInterval) return;

    this.captureInterval = setInterval(async () => {
      try {
        await this.captureIDEState();
      } catch (error) {
        console.error('Error capturing IDE state:', error);
      }
    }, intervalMs);

    console.log(`[TARGET] IDE state capture started with ${intervalMs}ms interval`);
  }

  /**
   * Stop IDE state capture
   */
  stop() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
      console.log('IDE state capture stopped');
    }
  }

  /**
   * Capture comprehensive IDE state
   */
  async captureIDEState() {
    const timestamp = Date.now();

    try {
      const ideState = {
        timestamp,
        editorState: await this.captureEditorState(),
        workspaceState: await this.captureWorkspaceState(),
        editorConfiguration: await this.captureEditorConfiguration(),
        debugState: await this.captureDebugState(),
        cursorSpecificState: await this.captureCursorSpecificState(),
        systemState: await this.captureSystemState(),
      };

      // Store in cache
      this.cache.set(timestamp, ideState);

      // Keep only last 1000 entries
      if (this.cache.size > 1000) {
        const oldestKey = Math.min(...this.cache.keys());
        this.cache.delete(oldestKey);
      }

      this.lastCapture = timestamp;
      console.log(`[DATA] Captured IDE state: ${Object.keys(ideState).length} components`);

      return ideState;
    } catch (error) {
      console.error('Error capturing IDE state:', error);
      return null;
    }
  }

  /**
   * Capture editor state (tabs, layout, panels, sidebar)
   */
  async captureEditorState() {
    try {
      // Get active tabs via AppleScript
      const activeTabs = await this.getActiveTabs();

      // Get editor layout
      const editorLayout = await this.getEditorLayout();

      // Get panel states
      const panelStates = await this.getPanelStates();

      // Get sidebar state
      const sidebarState = await this.getSidebarState();

      return {
        activeTabs,
        openFiles: activeTabs.map((tab) => tab.filePath).filter(Boolean),
        editorLayout,
        panelStates,
        sidebarState,
      };
    } catch (error) {
      console.warn('Error capturing editor state:', error.message);
      return {
        activeTabs: [],
        openFiles: [],
        editorLayout: {
          activeEditor: '',
          editorGroups: [],
          panelLayout: {},
          sidebarLayout: {},
          statusBar: {},
        },
        panelStates: [],
        sidebarState: { isVisible: false, activeView: '', expandedSections: [], width: 0 },
      };
    }
  }

  /**
   * Capture workspace state (root, git, extensions, theme)
   */
  async captureWorkspaceState() {
    try {
      const workspaceRoot = await this.getWorkspaceRoot();
      const gitBranch = await this.getGitBranch();
      const gitStatus = await this.getGitStatus();
      const activeExtensions = await this.getActiveExtensions();
      const themeSettings = await this.getThemeSettings();

      return {
        workspaceRoot,
        gitBranch,
        gitStatus,
        activeExtensions,
        themeSettings,
      };
    } catch (error) {
      console.warn('Error capturing workspace state:', error.message);
      return {
        workspaceRoot: '',
        gitBranch: '',
        gitStatus: {
          branch: '',
          isDirty: false,
          stagedFiles: [],
          unstagedFiles: [],
          untrackedFiles: [],
          lastCommit: null,
        },
        activeExtensions: [],
        themeSettings: {
          colorTheme: '',
          iconTheme: '',
          fontFamily: '',
          fontSize: 0,
          fontWeight: '',
        },
      };
    }
  }

  /**
   * Capture editor configuration (language, indentation, settings, keybindings)
   */
  async captureEditorConfiguration() {
    try {
      const languageMode = await this.getLanguageMode();
      const indentationSettings = await this.getIndentationSettings();
      const editorSettings = await this.getEditorSettings();
      const keybindings = await this.getKeybindings();

      return {
        languageMode,
        indentationSettings,
        editorSettings,
        keybindings,
      };
    } catch (error) {
      console.warn('Error capturing editor configuration:', error.message);
      return {
        languageMode: '',
        indentationSettings: { insertSpaces: true, tabSize: 2, detectIndentation: true },
        editorSettings: {
          wordWrap: 'off',
          lineNumbers: 'on',
          minimap: true,
          scrollBeyondLastLine: false,
          cursorBlinking: 'blink',
          cursorStyle: 'line',
        },
        keybindings: [],
      };
    }
  }

  /**
   * Capture debug state (breakpoints, debug session, watch expressions)
   */
  async captureDebugState() {
    try {
      const breakpoints = await this.getBreakpoints();
      const debugSession = await this.getDebugSession();
      const watchExpressions = await this.getWatchExpressions();

      return {
        breakpoints,
        debugSession,
        watchExpressions,
      };
    } catch (error) {
      console.warn('Error capturing debug state:', error.message);
      return {
        breakpoints: [],
        debugSession: {
          id: '',
          name: '',
          type: '',
          isActive: false,
          configuration: {},
          variables: [],
          callStack: [],
        },
        watchExpressions: [],
      };
    }
  }

  /**
   * Capture Cursor-specific state (AI chat, code completion, suggestions)
   */
  async captureCursorSpecificState() {
    try {
      const aiChat = await this.getAIChatState();
      const codeCompletion = await this.getCodeCompletionState();
      const suggestions = await this.getSuggestionState();
      const contextWindow = await this.getContextWindowState();

      return {
        aiChat,
        codeCompletion,
        suggestions,
        contextWindow,
      };
    } catch (error) {
      console.warn('Error capturing Cursor-specific state:', error.message);
      return {
        aiChat: {
          isOpen: false,
          messageCount: 0,
          lastMessage: '',
          conversationHistory: [],
          contextFiles: [],
        },
        codeCompletion: {
          isActive: false,
          suggestions: [],
          acceptedSuggestions: 0,
          rejectedSuggestions: 0,
          completionRate: 0,
        },
        suggestions: {
          activeSuggestions: [],
          acceptedCount: 0,
          rejectedCount: 0,
          partialAcceptance: [],
        },
        contextWindow: {
          isOpen: false,
          content: '',
          referencedFiles: [],
          selectedText: '',
          cursorPosition: { line: 0, character: 0 },
        },
      };
    }
  }

  /**
   * Capture system state (processes, resources, environment)
   */
  async captureSystemState() {
    try {
      const processes = await this.getCursorProcesses();
      const resources = await this.getSystemResources();
      const environment = await this.getEnvironmentInfo();

      return {
        processes,
        resources,
        environment,
      };
    } catch (error) {
      console.warn('Error capturing system state:', error.message);
      return {
        processes: [],
        resources: { cpuUsage: 0, memoryUsage: 0, diskUsage: 0, networkUsage: 0 },
        environment: { platform: '', arch: '', nodeVersion: '', cursorVersion: '' },
      };
    }
  }

  // AppleScript integration methods
  async getActiveTabs() {
    // Check circuit breaker before attempting AppleScript
    if (!this.isAppleScriptAvailable()) {
      return [];
    }

    try {
      // AppleScript to get open tabs/files from Cursor
      const script = `
        tell application "System Events"
          tell process "Cursor"
            try
              set windowTitle to name of front window
              return windowTitle
            on error
              return ""
            end try
          end tell
        end tell
      `;

      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

      // Record success
      this.recordAppleScriptSuccess();
      const windowTitle = stdout.trim();

      if (windowTitle && windowTitle !== '') {
        // Parse window title to extract file information
        // Cursor window titles typically show: "filename — workspace" or "filename - workspace - Cursor"
        // Remove the workspace suffix (everything after — or after second -)
        let fileName = windowTitle;

        // Try splitting by em-dash first
        if (windowTitle.includes(' — ')) {
          fileName = windowTitle.split(' — ')[0];
        } else if (windowTitle.includes(' - ')) {
          const parts = windowTitle.split(' - ');
          fileName = parts[0] || '';
        }

        // Get the working directory to construct full path
        const workspaceRoot = await this.getWorkspaceRoot();

        // Construct full path if not absolute
        const filePath = fileName.includes('/')
          ? fileName
          : fileName
            ? path.join(workspaceRoot, fileName)
            : '';

        return [
          {
            title: windowTitle,
            fileName: fileName,
            filePath: filePath,
            isActive: true,
            isDirty: windowTitle.includes('●') || windowTitle.includes('•'),
            lineNumber: 1,
            columnNumber: 1,
          },
        ];
      }

      return [];
    } catch (error) {
      // Record failure for circuit breaker
      this.recordAppleScriptFailure(error);
      return [];
    }
  }

  async getEditorLayout() {
    try {
      const activeTabs = await this.getActiveTabs();
      const activeEditor = activeTabs.length > 0 ? activeTabs[0].filePath : '';

      return {
        activeEditor,
        editorGroups:
          activeTabs.length > 0
            ? [
                {
                  viewColumn: 1,
                  editors: activeTabs,
                },
              ]
            : [],
        panelLayout: { panels: [] },
        sidebarLayout: { sections: [] },
        statusBar: { items: [] },
      };
    } catch (error) {
      console.warn('Could not get editor layout:', error.message);
      return {
        activeEditor: '',
        editorGroups: [],
        panelLayout: { panels: [] },
        sidebarLayout: { sections: [] },
        statusBar: { items: [] },
      };
    }
  }

  async getPanelStates() {
    // Silently return empty array - feature is intentionally disabled
    // No need to log warning as this is expected behavior
    return [];
  }

  async getSidebarState() {
    // Silently return default state - feature is intentionally disabled
    // No need to log warning as this is expected behavior
    return {
      isVisible: false,
      activeView: '',
      expandedSections: [],
      width: 0,
    };
  }

  async getWorkspaceRoot() {
    try {
      const { stdout } = await execAsync('pwd');
      return stdout.trim();
    } catch (error) {
      console.warn('Could not get workspace root:', error.message);
      return '';
    }
  }

  async getGitBranch() {
    try {
      const { stdout } = await execAsync('git branch --show-current');
      return stdout.trim();
    } catch (error) {
      console.warn('Could not get git branch:', error.message);
      return '';
    }
  }

  async getGitStatus() {
    try {
      const { stdout: status } = await execAsync('git status --porcelain');
      const { stdout: branch } = await execAsync('git branch --show-current');
      const { stdout: lastCommit } = await execAsync('git log -1 --oneline');

      const statusLines = status
        .trim()
        .split('\n')
        .filter((line) => line);
      const stagedFiles = statusLines
        .filter((line) => line.startsWith('M ') || line.startsWith('A '))
        .map((line) => line.substring(2));
      const unstagedFiles = statusLines
        .filter((line) => line.startsWith(' M') || line.startsWith(' A'))
        .map((line) => line.substring(2));
      const untrackedFiles = statusLines
        .filter((line) => line.startsWith('??'))
        .map((line) => line.substring(3));

      return {
        branch: branch.trim(),
        isDirty: statusLines.length > 0,
        stagedFiles,
        unstagedFiles,
        untrackedFiles,
        lastCommit: {
          hash: lastCommit.trim().split(' ')[0] || '',
          message: lastCommit.trim().substring(lastCommit.trim().indexOf(' ') + 1) || '',
          author: '',
          timestamp: Date.now(),
          files: [],
        },
      };
    } catch (error) {
      console.warn('Could not get git status:', error.message);
      return {
        branch: '',
        isDirty: false,
        stagedFiles: [],
        unstagedFiles: [],
        untrackedFiles: [],
        lastCommit: null,
      };
    }
  }

  async getActiveExtensions() {
    try {
      // Try to get extensions from Cursor's extension directory
      const extensionPaths = [
        path.join(os.homedir(), '.cursor/extensions'),
        path.join(os.homedir(), 'Library/Application Support/Cursor/User/extensions'),
      ];

      for (const extPath of extensionPaths) {
        if (fs.existsSync(extPath)) {
          const extensions = fs
            .readdirSync(extPath)
            .filter((item) => fs.statSync(path.join(extPath, item)).isDirectory())
            .map((item) => {
              const manifestPath = path.join(extPath, item, 'package.json');
              try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                return {
                  id: manifest.name || item,
                  name: manifest.displayName || manifest.name || item,
                  version: manifest.version || '1.0.0',
                  isActive: true,
                  isEnabled: true,
                  activationEvents: manifest.activationEvents || [],
                };
              } catch {
                return {
                  id: item,
                  name: item,
                  version: '1.0.0',
                  isActive: true,
                  isEnabled: true,
                  activationEvents: [],
                };
              }
            });

          return extensions;
        }
      }

      return [];
    } catch (error) {
      console.warn('Could not get active extensions:', error.message);
      return [];
    }
  }

  async getThemeSettings() {
    try {
      // Try to get theme from Cursor settings
      const settingsPath = path.join(
        os.homedir(),
        'Library/Application Support/Cursor/User/settings.json'
      );
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return {
          colorTheme: settings['workbench.colorTheme'] || 'Default Dark+',
          iconTheme: settings['workbench.iconTheme'] || 'vs-seti',
          fontFamily: settings['editor.fontFamily'] || 'Consolas, "Courier New", monospace',
          fontSize: settings['editor.fontSize'] || 14,
          fontWeight: settings['editor.fontWeight'] || 'normal',
        };
      }

      return {
        colorTheme: 'Default Dark+',
        iconTheme: 'vs-seti',
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 14,
        fontWeight: 'normal',
      };
    } catch (error) {
      console.warn('Could not get theme settings:', error.message);
      return {
        colorTheme: '',
        iconTheme: '',
        fontFamily: '',
        fontSize: 0,
        fontWeight: '',
      };
    }
  }

  async getLanguageMode() {
    try {
      const activeTabs = await this.getActiveTabs();
      if (activeTabs.length > 0 && activeTabs[0].filePath) {
        const ext = path.extname(activeTabs[0].filePath).substring(1);
        const languageMap = {
          js: 'javascript',
          ts: 'typescript',
          py: 'python',
          rb: 'ruby',
          go: 'go',
          rs: 'rust',
          java: 'java',
          cpp: 'cpp',
          c: 'c',
          html: 'html',
          css: 'css',
          json: 'json',
          md: 'markdown',
          sh: 'shell',
        };
        return languageMap[ext] || ext || '';
      }
      return '';
    } catch (error) {
      console.warn('Could not get language mode:', error.message);
      return '';
    }
  }

  async getIndentationSettings() {
    try {
      const settingsPath = path.join(
        os.homedir(),
        'Library/Application Support/Cursor/User/settings.json'
      );
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return {
          insertSpaces: settings['editor.insertSpaces'] !== false,
          tabSize: settings['editor.tabSize'] || 2,
          detectIndentation: settings['editor.detectIndentation'] !== false,
        };
      }
      return { insertSpaces: true, tabSize: 2, detectIndentation: true };
    } catch (error) {
      console.warn('Could not get indentation settings:', error.message);
      return { insertSpaces: true, tabSize: 2, detectIndentation: true };
    }
  }

  async getEditorSettings() {
    try {
      const settingsPath = path.join(
        os.homedir(),
        'Library/Application Support/Cursor/User/settings.json'
      );
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return {
          wordWrap: settings['editor.wordWrap'] || 'off',
          lineNumbers: settings['editor.lineNumbers'] || 'on',
          minimap: settings['editor.minimap.enabled'] !== false,
          scrollBeyondLastLine: settings['editor.scrollBeyondLastLine'] !== false,
          cursorBlinking: settings['editor.cursorBlinking'] || 'blink',
          cursorStyle: settings['editor.cursorStyle'] || 'line',
        };
      }
      return {
        wordWrap: 'off',
        lineNumbers: 'on',
        minimap: true,
        scrollBeyondLastLine: false,
        cursorBlinking: 'blink',
        cursorStyle: 'line',
      };
    } catch (error) {
      console.warn('Could not get editor settings:', error.message);
      return {
        wordWrap: 'off',
        lineNumbers: 'on',
        minimap: true,
        scrollBeyondLastLine: false,
        cursorBlinking: 'blink',
        cursorStyle: 'line',
      };
    }
  }

  async getKeybindings() {
    // Silently return empty array - feature is intentionally disabled
    // No need to log warning as this is expected behavior
    return [];
  }

  async getBreakpoints() {
    // Silently return empty array - feature is intentionally disabled
    // No need to log warning as this is expected behavior
    return [];
  }

  async getDebugSession() {
    // Silently return default state - feature is intentionally disabled
    // No need to log warning as this is expected behavior
    return {
      id: '',
      name: '',
      type: '',
      isActive: false,
      configuration: {},
      variables: [],
      callStack: [],
    };
  }

  async getWatchExpressions() {
    // Silently return empty array - feature is intentionally disabled
    // No need to log warning as this is expected behavior
    return [];
  }

  async getAIChatState() {
    try {
      // Try to detect AI chat state from Cursor database
      const dbPaths = [
        path.join(os.homedir(), 'Library/Application Support/Cursor/User/workspaceStorage'),
        path.join(os.homedir(), 'Library/Application Support/Cursor/User/globalStorage'),
      ];

      for (const dbPath of dbPaths) {
        if (fs.existsSync(dbPath)) {
          // Look for AI chat related files
          const files = fs.readdirSync(dbPath);
          const chatFiles = files.filter((file) => file.includes('chat') || file.includes('ai'));

          return {
            isOpen: chatFiles.length > 0,
            messageCount: chatFiles.length,
            lastMessage: '',
            conversationHistory: [],
            contextFiles: [],
          };
        }
      }

      return {
        isOpen: false,
        messageCount: 0,
        lastMessage: '',
        conversationHistory: [],
        contextFiles: [],
      };
    } catch (error) {
      console.warn('Could not get AI chat state:', error.message);
      return {
        isOpen: false,
        messageCount: 0,
        lastMessage: '',
        conversationHistory: [],
        contextFiles: [],
      };
    }
  }

  async getCodeCompletionState() {
    try {
      // This would require integration with Cursor's completion API
      // For now, return basic state
      return {
        isActive: false,
        suggestions: [],
        acceptedSuggestions: 0,
        rejectedSuggestions: 0,
        completionRate: 0,
      };
    } catch (error) {
      console.warn('Could not get code completion state:', error.message);
      return {
        isActive: false,
        suggestions: [],
        acceptedSuggestions: 0,
        rejectedSuggestions: 0,
        completionRate: 0,
      };
    }
  }

  async getSuggestionState() {
    try {
      return {
        activeSuggestions: [],
        acceptedCount: 0,
        rejectedCount: 0,
        partialAcceptance: [],
      };
    } catch (error) {
      console.warn('Could not get suggestion state:', error.message);
      return {
        activeSuggestions: [],
        acceptedCount: 0,
        rejectedCount: 0,
        partialAcceptance: [],
      };
    }
  }

  async getContextWindowState() {
    try {
      return {
        isOpen: false,
        content: '',
        referencedFiles: [],
        selectedText: '',
        cursorPosition: { line: 0, character: 0 },
      };
    } catch (error) {
      console.warn('Could not get context window state:', error.message);
      return {
        isOpen: false,
        content: '',
        referencedFiles: [],
        selectedText: '',
        cursorPosition: { line: 0, character: 0 },
      };
    }
  }

  async getCursorProcesses() {
    try {
      const { stdout } = await execAsync('ps aux | grep -i cursor | grep -v grep');
      const processes = stdout
        .trim()
        .split('\n')
        .filter((line) => line);

      return processes.map((proc, index) => {
        const parts = proc.trim().split(/\s+/);
        return {
          pid: parseInt(parts[1]) || 0,
          name: parts[10] || 'Cursor',
          cpuUsage: parseFloat(parts[2]) || 0,
          memoryUsage: parseFloat(parts[3]) || 0,
          timestamp: Date.now(),
        };
      });
    } catch (error) {
      console.warn('Could not get Cursor processes:', error.message);
      return [];
    }
  }

  async getSystemResources() {
    try {
      const memUsage = process.memoryUsage();
      return {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: memUsage.heapUsed / 1024 / 1024, // Convert to MB
        diskUsage: 0, // Would need additional implementation
        networkUsage: 0, // Would need additional implementation
      };
    } catch (error) {
      console.warn('Could not get system resources:', error.message);
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkUsage: 0,
      };
    }
  }

  async getEnvironmentInfo() {
    try {
      return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        cursorVersion: 'Unknown', // Would need to be extracted from Cursor
      };
    } catch (error) {
      console.warn('Could not get environment info:', error.message);
      return {
        platform: '',
        arch: '',
        nodeVersion: '',
        cursorVersion: '',
      };
    }
  }

  /**
   * Get cached IDE state data
   */
  getCachedData(limit = 100, since = 0) {
    const entries = Array.from(this.cache.entries())
      .filter(([timestamp]) => timestamp >= since)
      .sort(([a], [b]) => b - a)
      .slice(0, limit)
      .map(([timestamp, data]) => ({ timestamp, ...data }));

    return {
      success: true,
      data: entries,
      count: entries.length,
      total: this.cache.size,
    };
  }

  /**
   * Get latest IDE state
   */
  getLatestState() {
    if (this.cache.size === 0) return null;

    const latestTimestamp = Math.max(...this.cache.keys());
    return this.cache.get(latestTimestamp);
  }
}

module.exports = IDEStateCapture;
