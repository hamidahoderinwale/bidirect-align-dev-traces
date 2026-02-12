import chokidar from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { relative, extname } from 'path';
import { diffEngine } from '../utils/diffEngine.js';
import { queue } from '../utils/queue.js';
import { config } from '../utils/config.js';

class FileWatcher {
  constructor() {
    this.watcher = null;
    this.snapshots = new Map(); // file path -> content
    this.isWatching = false;
  }

  start() {
    if (this.isWatching) {
      console.log('File watcher already running');
      return;
    }

    const cfg = config.get();
    const watchPath = cfg.root_dir;

    console.log(`Starting file watcher for: ${watchPath}`);

    this.watcher = chokidar.watch(watchPath, {
      ignored: cfg.ignore,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (filePath) => this.handleFileChange(filePath, 'add'))
      .on('change', (filePath) => this.handleFileChange(filePath, 'change'))
      .on('unlink', (filePath) => this.handleFileDelete(filePath))
      .on('error', (error) => console.error('File watcher error:', error))
      .on('ready', () => {
        this.isWatching = true;
        console.log('File watcher ready');
      });
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      console.log(' File watcher stopped');
    }
  }

  async handleFileChange(filePath, eventType) {
    try {
      // Skip non-text files
      if (!this.isTextFile(filePath)) {
        return;
      }

      const cfg = config.get();
      const relativePath = relative(cfg.root_dir, filePath);

      console.log(`File ${eventType}: ${relativePath}`);

      // Read current content
      const currentContent = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

      // Get previous snapshot
      const previousContent = this.snapshots.get(filePath) || '';

      // Update snapshot
      this.snapshots.set(filePath, currentContent);

      // Only process if there's a meaningful change
      if (eventType === 'change' && previousContent) {
        const diff = diffEngine.createDiff(previousContent, currentContent);

        if (diff && diff.length >= cfg.diff_threshold) {
          console.log(` Code change detected: ${relativePath} (${diff.length} chars)`);

          // Add to queue
          queue.addEntry({
            source: 'filewatcher',
            file_path: relativePath,
            before_code: previousContent,
            after_code: currentContent,
            notes: `File ${eventType} - ${diff.length} character change`,
          });
        }
      } else if (eventType === 'add') {
        // New file - just log the addition
        queue.addEntry({
          source: 'filewatcher',
          file_path: relativePath,
          before_code: '',
          after_code: currentContent,
          notes: `New file added`,
        });
      }
    } catch (error) {
      console.error(`Error handling file change ${filePath}:`, error);
    }
  }

  handleFileDelete(filePath) {
    try {
      const cfg = config.get();
      const relativePath = relative(cfg.root_dir, filePath);

      console.log(`File deleted: ${relativePath}`);

      // Remove from snapshots
      this.snapshots.delete(filePath);

      // Log deletion event
      queue.addEvent({
        type: 'file_deleted',
        details: { file_path: relativePath },
      });
    } catch (error) {
      console.error(`Error handling file delete ${filePath}:`, error);
    }
  }

  isTextFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    const textExtensions = [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.h',
      '.css',
      '.scss',
      '.sass',
      '.html',
      '.htm',
      '.xml',
      '.json',
      '.md',
      '.txt',
      '.yml',
      '.yaml',
      '.toml',
      '.ini',
      '.cfg',
      '.conf',
      '.vue',
      '.svelte',
      '.php',
      '.rb',
      '.go',
      '.rs',
      '.swift',
      '.kt',
    ];

    return textExtensions.includes(ext) || ext === '';
  }

  getStats() {
    return {
      is_watching: this.isWatching,
      files_tracked: this.snapshots.size,
      watched_files: Array.from(this.snapshots.keys()),
    };
  }
}

export const fileWatcher = new FileWatcher();
