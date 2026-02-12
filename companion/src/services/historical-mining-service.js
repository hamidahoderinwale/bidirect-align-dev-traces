/**
 * Historical Mining Service
 * Mines historical data from git, shell history, cursor logs, and filesystem
 */

const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const crypto = require('crypto');

class HistoricalMiningService {
  constructor(persistentDB, options = {}) {
    this.persistentDB = persistentDB;
    this.options = {
      gitHistoryDays: options.gitHistoryDays || 365,
      includeDiffs: options.includeDiffs || false,
      maxCommits: options.maxCommits || 10000,
      maxShellCommands: options.maxShellCommands || 50000,
      verbose: options.verbose || false,
      ...options,
    };
    this.miningStatus = {
      inProgress: false,
      lastRun: null,
      lastError: null,
    };
  }

  /**
   * Run all mining operations for a workspace
   */
  async mineWorkspace(workspacePath, options = {}) {
    const startTime = Date.now();
    this.miningStatus.inProgress = true;

    const results = {
      workspace: workspacePath,
      started_at: new Date().toISOString(),
      git: null,
      shell: null,
      cursor_logs: null,
      file_timeline: null,
      errors: [],
    };

    try {
      // Mine git history
      if (options.includeGit !== false) {
        try {
          this.log('Mining git history...');
          results.git = await this.mineGitHistory(workspacePath, options);
          this.log(`Git mining complete: ${results.git.commits} commits`);
        } catch (error) {
          this.log(`Git mining failed: ${error.message}`);
          results.errors.push({ source: 'git', error: error.message });
        }
      }

      // Mine shell history (once per system, not per workspace)
      if (options.includeShell !== false && !results.shell) {
        try {
          this.log('Mining shell history...');
          results.shell = await this.mineShellHistory();
          this.log(`Shell mining complete: ${results.shell.commands} commands`);
        } catch (error) {
          this.log(`Shell mining failed: ${error.message}`);
          results.errors.push({ source: 'shell', error: error.message });
        }
      }

      // Mine Cursor logs
      if (options.includeCursorLogs !== false) {
        try {
          this.log('Mining Cursor logs...');
          results.cursor_logs = await this.mineCursorLogs();
          this.log(`Cursor logs mining complete: ${results.cursor_logs.prompts} prompts recovered`);
        } catch (error) {
          this.log(`Cursor logs mining failed: ${error.message}`);
          results.errors.push({ source: 'cursor_logs', error: error.message });
        }
      }

      // Mine file timeline
      if (options.includeFileTimeline !== false) {
        try {
          this.log('Mining file modification timeline...');
          results.file_timeline = await this.mineFileTimestamps(workspacePath);
          this.log(`File timeline complete: ${results.file_timeline.files} files`);
        } catch (error) {
          this.log(`File timeline mining failed: ${error.message}`);
          results.errors.push({ source: 'file_timeline', error: error.message });
        }
      }

      results.completed_at = new Date().toISOString();
      results.duration_ms = Date.now() - startTime;

      this.miningStatus.lastRun = results;
      this.miningStatus.inProgress = false;

      return results;
    } catch (error) {
      this.miningStatus.inProgress = false;
      this.miningStatus.lastError = error.message;
      throw error;
    }
  }

  /**
   * Mine git history for a workspace
   */
  async mineGitHistory(workspacePath, options = {}) {
    const sinceDays = options.sinceDays || this.options.gitHistoryDays;
    const includeDiffs = options.includeDiffs ?? this.options.includeDiffs;
    const maxCommits = options.maxCommits || this.options.maxCommits;

    // Check if directory is a git repository
    const gitDir = path.join(workspacePath, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      throw new Error('Not a git repository');
    }

    const results = {
      commits: 0,
      branches: 0,
      authors: new Set(),
      fileChanges: 0,
    };

    // Mine commit history with stats
    const gitLogCmd = `git log --all --since="${sinceDays} days ago" --format=fuller --numstat --date=iso-strict`;

    try {
      const { stdout } = await execAsync(gitLogCmd, {
        cwd: workspacePath,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      });

      const commits = this.parseGitLog(stdout, workspacePath);

      // Limit number of commits
      const limitedCommits = commits.slice(0, maxCommits);

      // Save commits to database
      for (const commit of limitedCommits) {
        await this.persistentDB.saveHistoricalCommit(commit);
        results.commits++;
        results.authors.add(commit.author);
        results.fileChanges += commit.files_changed;
      }

      // Mine branch information
      const branchCmd =
        'git branch -a --format="%(refname:short)|%(committerdate:iso-strict)|%(authorname)"';
      const { stdout: branchOutput } = await execAsync(branchCmd, { cwd: workspacePath });

      const branches = this.parseGitBranches(branchOutput, workspacePath);
      for (const branch of branches) {
        await this.persistentDB.saveHistoricalBranch(branch);
        results.branches++;
      }

      // Optionally mine diffs for each commit
      if (includeDiffs && limitedCommits.length > 0) {
        this.log(`Mining diffs for ${Math.min(100, limitedCommits.length)} recent commits...`);
        const recentCommits = limitedCommits.slice(0, 100); // Limit diffs to 100 most recent

        for (const commit of recentCommits) {
          try {
            const diffCmd = `git show ${commit.commit_hash} --format="" --unified=3`;
            const { stdout: diff } = await execAsync(diffCmd, {
              cwd: workspacePath,
              maxBuffer: 10 * 1024 * 1024, // 10MB per diff
            });

            await this.persistentDB.saveHistoricalDiff({
              commit_hash: commit.commit_hash,
              diff_content: diff,
              workspace_path: workspacePath,
            });
          } catch (error) {
            this.log(`Failed to get diff for ${commit.commit_hash}: ${error.message}`);
          }
        }
      }

      results.authors = results.authors.size;
      return results;
    } catch (error) {
      throw new Error(`Git history mining failed: ${error.message}`);
    }
  }

  /**
   * Parse git log output
   */
  parseGitLog(logOutput, workspacePath) {
    const commits = [];
    const lines = logOutput.split('\n');
    let currentCommit = null;
    let inStats = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // New commit starts with "commit "
      if (line.startsWith('commit ')) {
        if (currentCommit) {
          commits.push(currentCommit);
        }

        const hash = line.substring(7).trim();
        currentCommit = {
          commit_hash: hash,
          workspace_path: workspacePath,
          author: null,
          author_email: null,
          date: null,
          message: '',
          files_changed: 0,
          insertions: 0,
          deletions: 0,
          file_changes: [],
          mined_at: Date.now(),
        };
        inStats = false;
      } else if (currentCommit) {
        if (line.startsWith('Author:')) {
          const match = line.match(/Author:\s+(.+?)\s+<(.+?)>/);
          if (match) {
            currentCommit.author = match[1].trim();
            currentCommit.author_email = match[2].trim();
          }
        } else if (line.startsWith('Date:') || line.startsWith('CommitDate:')) {
          const dateStr = line.substring(line.indexOf(':') + 1).trim();
          currentCommit.date = new Date(dateStr).getTime();
        } else if (line.startsWith('    ')) {
          // Commit message (indented by 4 spaces)
          currentCommit.message += line.trim() + '\n';
        } else if (line.match(/^\d+\s+\d+\s+.+/)) {
          // File stats: "insertions deletions filename"
          inStats = true;
          const parts = line.split(/\s+/);
          const insertions = parseInt(parts[0]) || 0;
          const deletions = parseInt(parts[1]) || 0;
          const filename = parts.slice(2).join(' ');

          currentCommit.insertions += insertions;
          currentCommit.deletions += deletions;
          currentCommit.files_changed++;
          currentCommit.file_changes.push({
            file: filename,
            insertions,
            deletions,
          });
        }
      }
    }

    if (currentCommit) {
      commits.push(currentCommit);
    }

    return commits;
  }

  /**
   * Parse git branches
   */
  parseGitBranches(branchOutput, workspacePath) {
    const branches = [];
    const lines = branchOutput.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 2) {
        branches.push({
          workspace_path: workspacePath,
          branch_name: parts[0].trim(),
          last_commit_date: new Date(parts[1].trim()).getTime(),
          last_author: parts[2]?.trim() || null,
          mined_at: Date.now(),
        });
      }
    }

    return branches;
  }

  /**
   * Mine shell history files
   */
  async mineShellHistory() {
    const homeDir = os.homedir();
    const historyFiles = [
      { path: path.join(homeDir, '.bash_history'), shell: 'bash' },
      { path: path.join(homeDir, '.zsh_history'), shell: 'zsh' },
      { path: path.join(homeDir, '.history'), shell: 'sh' },
    ];

    const results = {
      commands: 0,
      filesProcessed: 0,
    };

    for (const { path: histFile, shell } of historyFiles) {
      try {
        const exists = await fs
          .access(histFile)
          .then(() => true)
          .catch(() => false);
        if (!exists) continue;

        const content = await fs.readFile(histFile, 'utf8');
        const commands = this.parseShellHistory(content, shell, histFile);

        for (const cmd of commands) {
          await this.persistentDB.saveHistoricalCommand(cmd);
          results.commands++;
        }

        results.filesProcessed++;
        this.log(`Processed ${histFile}: ${commands.length} commands`);
      } catch (error) {
        this.log(`Failed to process ${histFile}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Parse shell history content
   */
  parseShellHistory(content, shell, sourceFile) {
    const commands = [];
    const lines = content.split('\n');
    let timestamp = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Zsh extended history format: : timestamp:duration;command
      if (shell === 'zsh' && line.startsWith(':')) {
        const match = line.match(/^: (\d+):\d+;(.+)$/);
        if (match) {
          timestamp = parseInt(match[1]) * 1000; // Convert to ms
          const command = match[2];
          commands.push({
            command,
            timestamp,
            source_file: sourceFile,
            shell,
            line_number: i + 1,
            mined_at: Date.now(),
          });
          timestamp = null;
        }
      } else if (line.startsWith('#')) {
        // Bash timestamp format: #timestamp
        const ts = parseInt(line.substring(1));
        if (!isNaN(ts)) {
          timestamp = ts * 1000;
        }
      } else {
        // Regular command
        commands.push({
          command: line,
          timestamp: timestamp || null,
          source_file: sourceFile,
          shell,
          line_number: i + 1,
          mined_at: Date.now(),
        });
        timestamp = null;
      }
    }

    return commands;
  }

  /**
   * Mine Cursor application logs
   */
  async mineCursorLogs() {
    const results = {
      prompts: 0,
      errors: 0,
      events: 0,
    };

    // Platform-specific log locations
    const logDirs = this.getCursorLogPaths();

    for (const logDir of logDirs) {
      try {
        const exists = await fs
          .access(logDir)
          .then(() => true)
          .catch(() => false);
        if (!exists) continue;

        const files = await fs.readdir(logDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const logPath = path.join(logDir, file);
            try {
              const content = await fs.readFile(logPath, 'utf8');
              const parsed = this.parseCursorLog(content, logPath);

              // Save parsed prompts
              for (const prompt of parsed.prompts) {
                await this.persistentDB.saveHistoricalPrompt(prompt);
                results.prompts++;
              }

              results.errors += parsed.errors.length;
              results.events += parsed.events.length;
            } catch (error) {
              this.log(`Failed to parse ${logPath}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        this.log(`Failed to access log directory ${logDir}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Get Cursor log paths for different platforms
   */
  getCursorLogPaths() {
    const homeDir = os.homedir();
    const platform = os.platform();

    if (platform === 'darwin') {
      return [
        path.join(homeDir, 'Library/Logs/Cursor'),
        path.join(homeDir, 'Library/Application Support/Cursor/logs'),
      ];
    } else if (platform === 'win32') {
      return [path.join(homeDir, 'AppData/Roaming/Cursor/logs')];
    } else {
      return [path.join(homeDir, '.config/Cursor/logs')];
    }
  }

  /**
   * Parse Cursor log content for prompts and events
   */
  parseCursorLog(content, logPath) {
    const prompts = [];
    const errors = [];
    const events = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for prompt-like patterns
      // Example: [timestamp] [info] Sending prompt: "..."
      const promptMatch = line.match(
        /\[(\d{4}-\d{2}-\d{2}.*?)\].*(?:prompt|query|request).*?["'](.+?)["']/i
      );
      if (promptMatch) {
        prompts.push({
          prompt_text: promptMatch[2],
          timestamp: new Date(promptMatch[1]).getTime() || null,
          source: 'log_mining',
          confidence: 0.7, // Medium confidence
          context: lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n'),
          log_file: logPath,
          line_number: i + 1,
          mined_at: Date.now(),
        });
      }

      // Look for errors
      const errorMatch = line.match(/\[(\d{4}-\d{2}-\d{2}.*?)\].*\[error\]/i);
      if (errorMatch) {
        errors.push({
          timestamp: new Date(errorMatch[1]).getTime() || null,
          message: line,
          log_file: logPath,
          line_number: i + 1,
        });
      }
    }

    return { prompts, errors, events };
  }

  /**
   * Mine file modification timeline
   */
  async mineFileTimestamps(workspacePath) {
    const results = {
      files: 0,
      directories: 0,
    };

    try {
      const files = await this.recursivelyGetFileStats(workspacePath);

      for (const file of files) {
        await this.persistentDB.saveFileTimestamp(file);
        results.files++;
      }

      return results;
    } catch (error) {
      throw new Error(`File timeline mining failed: ${error.message}`);
    }
  }

  /**
   * Recursively get file statistics
   */
  async recursivelyGetFileStats(dirPath, results = []) {
    // Ignore patterns
    const ignorePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.cache',
      'coverage',
      'tmp',
      'temp',
      'logs',
      '.DS_Store',
    ];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored patterns
        if (ignorePatterns.some((pattern) => entry.name.includes(pattern))) {
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);

          results.push({
            file_path: fullPath,
            size: stats.size,
            created_at: stats.birthtime.getTime(),
            modified_at: stats.mtime.getTime(),
            accessed_at: stats.atime.getTime(),
            is_directory: stats.isDirectory(),
            mined_at: Date.now(),
          });

          // Recurse into directories (limit depth)
          if (stats.isDirectory() && results.length < 10000) {
            await this.recursivelyGetFileStats(fullPath, results);
          }
        } catch (error) {
          // Skip files we can't access
          continue;
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }

    return results;
  }

  /**
   * Get mining status
   */
  getStatus() {
    return {
      ...this.miningStatus,
      config: {
        gitHistoryDays: this.options.gitHistoryDays,
        includeDiffs: this.options.includeDiffs,
        maxCommits: this.options.maxCommits,
        maxShellCommands: this.options.maxShellCommands,
      },
    };
  }

  /**
   * Log helper
   */
  log(message) {
    if (this.options.verbose) {
      console.log(`[MINING] ${message}`);
    }
  }
}

module.exports = HistoricalMiningService;
