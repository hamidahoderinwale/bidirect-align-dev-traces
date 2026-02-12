/**
 * Plot Service
 * Orchestrates plot capture, processing, and version tracking
 * Integrates notebook plot extraction, file detection, and version control
 */

const NotebookPlotExtractor = require('../processors/jupyter/notebook-plot-extractor');
const PlotFileDetector = require('../processors/plots/plot-file-detector');
const PlotVersionTracker = require('../processors/plots/plot-version-tracker');
const ImageProcessor = require('../processors/image-processor');

class PlotService {
  constructor(persistentDB = null, options = {}) {
    this.db = persistentDB;

    // Initialize processors
    this.imageProcessor = new ImageProcessor(options.imageProcessor || {});
    this.notebookExtractor = new NotebookPlotExtractor(this.imageProcessor);
    this.fileDetector = new PlotFileDetector(this.imageProcessor);
    this.versionTracker = new PlotVersionTracker(persistentDB);
  }

  /**
   * Process notebook and extract all plots
   */
  async processNotebook(notebookPath, options = {}) {
    try {
      const { workspacePath = null, autoTrack = true } = options;

      // Extract plots from notebook
      const result = await this.notebookExtractor.extractPlotsFromNotebook(notebookPath);

      if (!result.success || result.plots.length === 0) {
        return result;
      }

      // Process each plot
      const processedPlots = [];
      for (const plot of result.plots) {
        // Add workspace context
        if (workspacePath) {
          plot.workspacePath = workspacePath;
        }

        // Process plot with image processor
        const processed = await this.notebookExtractor.processPlot(plot);

        // Track plot version
        if (autoTrack) {
          const tracked = await this.versionTracker.trackPlot(processed, {
            similarityThreshold: 0.85,
          });
          processedPlots.push(tracked);
        } else {
          processedPlots.push(processed);
        }
      }

      return {
        success: true,
        plots: processedPlots,
        count: processedPlots.length,
        notebook: result.notebook,
      };
    } catch (error) {
      console.error('[PLOT] Error processing notebook:', error.message);
      return {
        success: false,
        error: error.message,
        plots: [],
      };
    }
  }

  /**
   * Detect and process plot files from a directory
   */
  async processPlotFiles(directory, options = {}) {
    try {
      const { workspacePath = null, since = null, autoTrack = true } = options;

      // Detect plot files
      const plotFiles = await this.fileDetector.detectNewPlotFiles(directory, since);

      if (plotFiles.length === 0) {
        return {
          success: true,
          plots: [],
          count: 0,
        };
      }

      // Process each plot file
      const processedPlots = [];
      for (const file of plotFiles) {
        const plot = await this.fileDetector.createPlotFromFile(file.path, {
          workspacePath,
          scriptPath: null,
          terminalCommand: null,
          library: 'unknown',
        });

        if (plot) {
          // Track plot version
          if (autoTrack) {
            const tracked = await this.versionTracker.trackPlot(plot, {
              similarityThreshold: 0.85,
            });
            processedPlots.push(tracked);
          } else {
            processedPlots.push(plot);
          }
        }
      }

      return {
        success: true,
        plots: processedPlots,
        count: processedPlots.length,
      };
    } catch (error) {
      console.error('[PLOT] Error processing plot files:', error.message);
      return {
        success: false,
        error: error.message,
        plots: [],
      };
    }
  }

  /**
   * Detect plot generation from code and monitor for file creation
   */
  async detectPlotsFromCode(code, scriptPath, options = {}) {
    try {
      const { workspacePath = null } = options;

      // Detect plot patterns in code
      const detection = this.fileDetector.detectPlotPatterns(code);

      if (detection.paths.length === 0) {
        return {
          success: true,
          detectedPaths: [],
          libraries: detection.libraries,
        };
      }

      // Resolve plot paths and check if files exist
      const resolvedPlots = [];
      for (const detected of detection.paths) {
        const resolvedPath = this.fileDetector.resolvePlotPath(detected.path, scriptPath);

        if (resolvedPath && require('fs').existsSync(resolvedPath)) {
          const plot = await this.fileDetector.createPlotFromFile(resolvedPath, {
            workspacePath,
            scriptPath,
            library: detected.library,
          });

          if (plot) {
            const tracked = await this.versionTracker.trackPlot(plot, {
              similarityThreshold: 0.85,
            });
            resolvedPlots.push(tracked);
          }
        } else {
          // File doesn't exist yet - might be created later
          resolvedPlots.push({
            expectedPath: detected.path,
            resolvedPath: resolvedPath,
            library: detected.library,
            line: detected.line,
            exists: false,
          });
        }
      }

      return {
        success: true,
        detectedPaths: detection.paths,
        resolvedPlots,
        libraries: detection.libraries,
      };
    } catch (error) {
      console.error('[PLOT] Error detecting plots from code:', error.message);
      return {
        success: false,
        error: error.message,
        detectedPaths: [],
      };
    }
  }

  /**
   * Get plot by ID
   */
  async getPlot(plotId) {
    return await this.versionTracker.getPlot(plotId);
  }

  /**
   * Get version history for a plot
   */
  async getVersionHistory(plotId) {
    return await this.versionTracker.getVersionHistory(plotId);
  }

  /**
   * Get all plots with filters
   */
  async getPlots(filters = {}) {
    if (!this.db) {
      return { success: false, error: 'Database not available', plots: [] };
    }

    try {
      let query = 'SELECT * FROM plot_outputs WHERE 1=1';
      const params = [];

      if (filters.workspacePath) {
        query += ' AND workspace_path = ?';
        params.push(filters.workspacePath);
      }

      if (filters.notebookPath) {
        query += ' AND notebook_path = ?';
        params.push(filters.notebookPath);
      }

      if (filters.sourceType) {
        query += ' AND source_type = ?';
        params.push(filters.sourceType);
      }

      if (filters.library) {
        query += ' AND library = ?';
        params.push(filters.library);
      }

      if (filters.since) {
        query += ' AND created_at >= ?';
        params.push(filters.since);
      }

      if (filters.until) {
        query += ' AND created_at <= ?';
        params.push(filters.until);
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      // Ensure database is initialized
      await this.db.init();

      return new Promise((resolve, reject) => {
        this.db.db.all(query, params, (err, rows) => {
          if (err) {
            console.error('[PLOT] Error getting plots:', err);
            resolve({ success: false, error: err.message, plots: [] });
          } else {
            resolve({
              success: true,
              plots: rows || [],
              count: rows ? rows.length : 0,
            });
          }
        });
      });
    } catch (error) {
      console.error('[PLOT] Error getting plots:', error.message);
      return {
        success: false,
        error: error.message,
        plots: [],
      };
    }
  }

  /**
   * Find similar plots
   */
  async findSimilarPlots(plotId, threshold = 0.85) {
    const plot = await this.getPlot(plotId);
    if (!plot || !plot.perceptual_hash) {
      return { success: false, error: 'Plot not found or no hash available', plots: [] };
    }

    if (!this.db) {
      return { success: false, error: 'Database not available', plots: [] };
    }

    try {
      // Ensure database is initialized
      await this.db.init();

      return new Promise((resolve, reject) => {
        this.db.db.all(
          'SELECT * FROM plot_outputs WHERE perceptual_hash IS NOT NULL AND id != ?',
          [plotId],
          (err, rows) => {
            if (err) {
              console.error('[PLOT] Error finding similar plots:', err);
              resolve({ success: false, error: err.message, plots: [] });
              return;
            }

            const similar = [];
            for (const row of rows) {
              if (row.perceptual_hash) {
                const similarity = this.versionTracker.compareHashes(
                  plot.perceptual_hash,
                  row.perceptual_hash
                );
                if (similarity >= threshold) {
                  similar.push({ ...row, similarity });
                }
              }
            }

            similar.sort((a, b) => b.similarity - a.similarity);

            resolve({
              success: true,
              plots: similar,
              count: similar.length,
            });
          }
        );
      });
    } catch (error) {
      console.error('[PLOT] Error finding similar plots:', error.message);
      return {
        success: false,
        error: error.message,
        plots: [],
      };
    }
  }
}

module.exports = PlotService;
