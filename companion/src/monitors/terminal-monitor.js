#!/usr/bin/env node

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const execAsync = promisify(exec);

/**
 * Terminal Monitor - Captures terminal commands and output
 *
 * Strategies:
 * 1. Shell history monitoring (bash/zsh)
 * 2. PTY wrapper for active sessions
 * 3. AppleScript for Cursor's integrated terminal
 * 4. Process monitoring for command execution
 */
class TerminalMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      historyInterval: options.historyInterval || 5000, // Check history every 5s
      captureOutput: options.captureOutput !== false, // Capture command output
      maxOutputSize: options.maxOutputSize || 10000, // Max 10KB per output
      shellTypes: options.shellTypes || ['bash', 'zsh', 'sh'],
      ...options,
    };

    this.isMonitoring = false;
    this.historyCache = new Map(); // shell -> last command index
    this.commandHistory = [];
    this.activeCommands = new Map(); // pid -> command info

    // Track last seen command to avoid duplicates
    this.lastSeenCommands = new Set();
    this.maxCacheSize = 1000;
  }

  /**
   * Start monitoring terminal activity
   */
  async start() {
    if (this.isMonitoring) {
      console.log('Terminal monitor already running');
      return;
    }

    console.log('[SYSTEM]  Starting terminal monitor...');
    this.isMonitoring = true;

    // Strategy 1: Monitor shell history files
    this.startHistoryMonitoring();

    // Strategy 2: Monitor Cursor terminal via AppleScript (macOS)
    if (process.platform === 'darwin') {
      this.startCursorTerminalMonitoring();
    }

    // Strategy 3: Monitor running processes
    this.startProcessMonitoring();

    console.log('[SUCCESS] Terminal monitor started');
    console.log(`   - Shell history: checking every ${this.options.historyInterval}ms`);
    console.log(`   - Process monitoring: active`);
    if (process.platform === 'darwin') {
      console.log(`   - Cursor terminal: AppleScript enabled`);
    }
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.isMonitoring = false;

    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = null;
    }

    if (this.cursorTerminalTimer) {
      clearInterval(this.cursorTerminalTimer);
      this.cursorTerminalTimer = null;
    }

    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }

    console.log('Terminal monitor stopped');
  }

  /**
   * Strategy 1: Monitor shell history files
   */
  startHistoryMonitoring() {
    this.historyTimer = setInterval(async () => {
      if (!this.isMonitoring) return;

      try {
        await this.checkShellHistory();
      } catch (error) {
        // Silently handle errors to avoid spam
        if (this.options.debug) {
          console.error('History monitoring error:', error.message);
        }
      }
    }, this.options.historyInterval);
  }

  /**
   * Check all configured shell history files
   */
  async checkShellHistory() {
    const homeDir = os.homedir();
    const historyFiles = {
      bash: path.join(homeDir, '.bash_history'),
      zsh: path.join(homeDir, '.zsh_history'),
      sh: path.join(homeDir, '.sh_history'),
    };

    for (const [shell, historyPath] of Object.entries(historyFiles)) {
      if (!this.options.shellTypes.includes(shell)) continue;

      try {
        const exists = await fs
          .access(historyPath)
          .then(() => true)
          .catch(() => false);
        if (!exists) continue;

        const content = await fs.readFile(historyPath, 'utf-8');
        const lines = content
          .trim()
          .split('\n')
          .filter((l) => l.trim());

        // Get last seen index for this shell
        const lastIndex = this.historyCache.get(shell) || 0;

        if (lines.length > lastIndex) {
          // New commands detected
          const newCommands = lines.slice(lastIndex);

          for (const line of newCommands) {
            const command = this.parseHistoryLine(line, shell);
            if (command && !this.lastSeenCommands.has(command)) {
              await this.captureCommand({
                command: command,
                shell: shell,
                source: 'history',
                timestamp: Date.now(),
                workspace: process.cwd(),
              });

              this.lastSeenCommands.add(command);

              // Keep cache size manageable
              if (this.lastSeenCommands.size > this.maxCacheSize) {
                const firstItem = this.lastSeenCommands.values().next().value;
                this.lastSeenCommands.delete(firstItem);
              }
            }
          }

          // Update cache
          this.historyCache.set(shell, lines.length);
        }
      } catch (error) {
        // File might not exist or be readable
        if (this.options.debug) {
          console.error(`Error reading ${shell} history:`, error.message);
        }
      }
    }
  }

  /**
   * Parse history line (handles different shell formats)
   */
  parseHistoryLine(line, shell) {
    if (!line || line.trim().length === 0) return null;

    // Zsh extended history format: ": timestamp:0;command"
    if (shell === 'zsh' && line.startsWith(':')) {
      const match = line.match(/^:\s*\d+:\d+;(.+)$/);
      if (match) return match[1].trim();
    }

    // Bash/sh: plain commands
    return line.trim();
  }

  /**
   * Strategy 2: Monitor Cursor's integrated terminal via AppleScript (macOS)
   */
  startCursorTerminalMonitoring() {
    if (process.platform !== 'darwin') return;

    this.cursorTerminalTimer = setInterval(async () => {
      if (!this.isMonitoring) return;

      try {
        const terminalContent = await this.getCursorTerminalContent();
        if (terminalContent) {
          await this.parseTerminalContent(terminalContent);
        }
      } catch (error) {
        if (this.options.debug) {
          console.error('Cursor terminal monitoring error:', error.message);
        }
      }
    }, 3000); // Check every 3 seconds
  }

  /**
   * Get Cursor terminal content via AppleScript
   */
  async getCursorTerminalContent() {
    const script = `
      tell application "System Events"
        tell process "Cursor"
          if exists (window 1) then
            set terminalText to value of static text of group 1 of window 1
            return terminalText as text
          end if
        end tell
      end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
      return stdout.trim();
    } catch (error) {
      // AppleScript might fail if Cursor isn't focused or accessibility not granted
      return null;
    }
  }

  /**
   * Parse terminal content to extract commands
   */
  async parseTerminalContent(content) {
    // Look for command prompts ($ or %)
    const commandPattern = /[$%]\s+(.+?)(?=\n|$)/g;
    const matches = [...content.matchAll(commandPattern)];

    for (const match of matches) {
      const command = match[1].trim();
      if (command && !this.lastSeenCommands.has(command)) {
        await this.captureCommand({
          command: command,
          source: 'cursor_terminal',
          timestamp: Date.now(),
          workspace: process.cwd(),
        });

        this.lastSeenCommands.add(command);
      }
    }
  }

  /**
   * Strategy 3: Monitor running processes
   */
  startProcessMonitoring() {
    this.processTimer = setInterval(async () => {
      if (!this.isMonitoring) return;

      try {
        await this.checkRunningProcesses();
      } catch (error) {
        if (this.options.debug) {
          console.error('Process monitoring error:', error.message);
        }
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Check for development-related processes
   */
  async checkRunningProcesses() {
    try {
      const { stdout } = await execAsync('ps aux');
      const lines = stdout.split('\n');

      // Look for common dev commands
      const devCommands = ['npm', 'node', 'python', 'pytest', 'jest', 'cargo', 'go', 'make'];

      for (const line of lines) {
        for (const cmd of devCommands) {
          if (line.includes(cmd) && !line.includes('grep')) {
            // Extract command
            const parts = line.trim().split(/\s+/);
            const command = parts.slice(10).join(' '); // Command is after the first 10 fields

            if (command && !this.lastSeenCommands.has(command)) {
              await this.captureCommand({
                command: command,
                source: 'process_monitor',
                timestamp: Date.now(),
                workspace: process.cwd(),
              });

              this.lastSeenCommands.add(command);
            }
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Capture a command and optionally its output
   */
  async captureCommand(commandInfo) {
    const record = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      command: commandInfo.command,
      shell: commandInfo.shell || 'unknown',
      source: commandInfo.source,
      timestamp: commandInfo.timestamp || Date.now(),
      workspace: commandInfo.workspace || process.cwd(),
      output: null,
      exitCode: null,
      duration: null,
      error: null,
    };

    // Try to capture output if enabled
    if (this.options.captureOutput) {
      try {
        const result = await this.executeAndCapture(commandInfo.command);
        record.output = result.output;
        record.exitCode = result.exitCode;
        record.duration = result.duration;
        record.error = result.error;
      } catch (error) {
        // Command might be interactive or long-running, skip output capture
        record.error = 'Output capture failed';
      }
    }

    // Store in history
    this.commandHistory.push(record);

    // Keep only last 500 commands
    if (this.commandHistory.length > 500) {
      this.commandHistory = this.commandHistory.slice(-500);
    }

    // Emit event for external listeners
    this.emit('command', record);

    console.log(
      `[TERMINAL] Captured: ${record.command.slice(0, 60)}${record.command.length > 60 ? '...' : ''} (${record.source})`
    );

    return record;
  }

  /**
   * Execute command and capture output (careful with this!)
   */
  async executeAndCapture(command) {
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Set timeout to avoid hanging
      const timeout = setTimeout(() => {
        resolve({
          output: '[Command timeout]',
          exitCode: null,
          duration: Date.now() - startTime,
          error: 'Timeout',
        });
      }, 5000);

      exec(
        command,
        { timeout: 5000, maxBuffer: this.options.maxOutputSize },
        (error, stdout, stderr) => {
          clearTimeout(timeout);

          const output = (stdout + stderr).slice(0, this.options.maxOutputSize);

          resolve({
            output: output,
            exitCode: error ? error.code : 0,
            duration: Date.now() - startTime,
            error: error ? error.message : null,
          });
        }
      );
    });
  }

  /**
   * Get command history
   */
  getHistory(options = {}) {
    const limit = options.limit || 100;
    const source = options.source;
    const since = options.since;

    let filtered = [...this.commandHistory];

    if (source) {
      filtered = filtered.filter((cmd) => cmd.source === source);
    }

    if (since) {
      filtered = filtered.filter((cmd) => cmd.timestamp >= since);
    }

    return filtered.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const recentCommands = this.commandHistory.filter((cmd) => cmd.timestamp > last24h);

    // Count by source
    const bySource = {};
    this.commandHistory.forEach((cmd) => {
      bySource[cmd.source] = (bySource[cmd.source] || 0) + 1;
    });

    // Count errors
    const errorCount = this.commandHistory.filter(
      (cmd) => cmd.exitCode !== null && cmd.exitCode !== 0
    ).length;

    return {
      total: this.commandHistory.length,
      last24h: recentCommands.length,
      bySource: bySource,
      errorCount: errorCount,
      errorRate:
        this.commandHistory.length > 0
          ? ((errorCount / this.commandHistory.length) * 100).toFixed(2)
          : 0,
    };
  }
}

module.exports = TerminalMonitor;
