/**
 * Plot File Monitor
 * Monitors common output directories for newly created plot files
 * Detects when scripts generate plot images
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

class PlotFileMonitor {
  constructor(plotService, options = {}) {
    this.plotService = plotService;
    this.watchers = [];
    this.monitoredDirs = new Set();
    this.options = {
      commonDirs: options.commonDirs || [
        'plots',
        'figures',
        'images',
        'output',
        'results',
        'visualizations',
        'charts',
        'graphs',
      ],
      plotExtensions: options.plotExtensions || ['.png', '.jpg', '.jpeg', '.svg', '.pdf', '.webp'],
      debounceMs: options.debounceMs || 1000,
    };
    this.pendingFiles = new Map();
  }

  /**
   * Start monitoring workspace for plot files
   */
  start(workspacePath) {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return;
    }

    // Monitor common output directories
    this.options.commonDirs.forEach((dirName) => {
      const dirPath = path.join(workspacePath, dirName);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        this.monitorDirectory(dirPath, workspacePath);
      }
    });

    // Also monitor workspace root for plot files
    this.monitorDirectory(workspacePath, workspacePath, { recursive: false });
  }

  /**
   * Monitor a directory for plot files
   */
  monitorDirectory(dirPath, workspacePath, options = {}) {
    if (this.monitoredDirs.has(dirPath)) {
      return;
    }

    this.monitoredDirs.add(dirPath);

    const watcher = chokidar.watch(dirPath, {
      persistent: true,
      ignoreInitial: true,
      depth: options.recursive !== false ? 2 : 0,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      ignored: [/node_modules/, /\.git/, /\.venv/, /venv/, /__pycache__/],
    });

    watcher
      .on('add', (filePath) => this.handlePlotFileAdded(filePath, workspacePath))
      .on('change', (filePath) => this.handlePlotFileChanged(filePath, workspacePath));

    this.watchers.push(watcher);

    console.log(`[PLOT] Monitoring directory for plots: ${dirPath}`);
  }

  /**
   * Handle new plot file
   */
  async handlePlotFileAdded(filePath, workspacePath) {
    if (!this.isPlotFile(filePath)) {
      return;
    }

    // Debounce to avoid processing the same file multiple times
    const fileKey = filePath;
    if (this.pendingFiles.has(fileKey)) {
      clearTimeout(this.pendingFiles.get(fileKey));
    }

    const timeoutId = setTimeout(async () => {
      this.pendingFiles.delete(fileKey);
      await this.processPlotFile(filePath, workspacePath, 'added');
    }, this.options.debounceMs);

    this.pendingFiles.set(fileKey, timeoutId);
  }

  /**
   * Handle plot file change
   */
  async handlePlotFileChanged(filePath, workspacePath) {
    if (!this.isPlotFile(filePath)) {
      return;
    }

    await this.processPlotFile(filePath, workspacePath, 'changed');
  }

  /**
   * Process a plot file
   */
  async processPlotFile(filePath, workspacePath, eventType) {
    try {
      if (!this.plotService) {
        return;
      }

      const plotFileDetector =
        this.plotService.fileDetector || require('../processors/plots/plot-file-detector');

      const plot = await plotFileDetector.createPlotFromFile(filePath, {
        workspacePath,
        scriptPath: null,
        terminalCommand: null,
        library: 'unknown',
      });

      if (plot) {
        const tracked = await this.plotService.versionTracker.trackPlot(plot, {
          similarityThreshold: 0.85,
        });

        console.log(`[PLOT] Detected plot file: ${path.basename(filePath)} (${eventType})`);
      }
    } catch (error) {
      console.warn(`[PLOT] Error processing plot file ${filePath}:`, error.message);
    }
  }

  /**
   * Check if file is a plot file
   */
  isPlotFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.options.plotExtensions.includes(ext);
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.watchers.forEach((watcher) => watcher.close());
    this.watchers = [];
    this.monitoredDirs.clear();
    this.pendingFiles.forEach((timeoutId) => clearTimeout(timeoutId));
    this.pendingFiles.clear();
    console.log('[PLOT] Plot file monitor stopped');
  }

  /**
   * Add a directory to monitor
   */
  addDirectory(dirPath, workspacePath) {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      this.monitorDirectory(dirPath, workspacePath);
    }
  }
}

module.exports = PlotFileMonitor;
