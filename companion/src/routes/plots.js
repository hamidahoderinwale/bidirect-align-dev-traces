/**
 * Plot API routes
 * Handles plot-related endpoints for notebooks and script-generated plots
 */

const path = require('path');
const fs = require('fs');

function createPlotRoutes(deps) {
  const { app, plotService } = deps;

  if (!plotService) {
    console.warn('[PLOT] Plot service not available, plot routes disabled');
    return;
  }

  console.log('[PLOT] Registering plot routes...');

  // Get all plots with optional filters
  app.get('/api/plots', async (req, res) => {
    try {
      const filters = {
        workspacePath: req.query.workspace || req.query.workspace_path || null,
        notebookPath: req.query.notebook || req.query.notebook_path || null,
        sourceType: req.query.source_type || null,
        library: req.query.library || null,
        since: req.query.since || null,
        until: req.query.until || null,
        limit: req.query.limit ? parseInt(req.query.limit) : null,
      };

      const result = await plotService.getPlots(filters);

      res.json({
        success: result.success,
        plots: result.plots || [],
        count: result.count || 0,
        filters,
      });
    } catch (error) {
      console.error('[PLOT] Error getting plots:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get plot by ID
  app.get('/api/plots/:id', async (req, res) => {
    try {
      const plot = await plotService.getPlot(req.params.id);

      if (!plot) {
        return res.status(404).json({
          success: false,
          error: 'Plot not found',
        });
      }

      res.json({
        success: true,
        plot,
      });
    } catch (error) {
      console.error('[PLOT] Error getting plot:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get version history for a plot
  app.get('/api/plots/:id/versions', async (req, res) => {
    try {
      const versions = await plotService.getVersionHistory(req.params.id);

      res.json({
        success: true,
        versions: versions || [],
        count: versions ? versions.length : 0,
      });
    } catch (error) {
      console.error('[PLOT] Error getting version history:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Find similar plots
  app.get('/api/plots/:id/similar', async (req, res) => {
    try {
      const threshold = req.query.threshold ? parseFloat(req.query.threshold) : 0.85;
      const result = await plotService.findSimilarPlots(req.params.id, threshold);

      res.json({
        success: result.success,
        plots: result.plots || [],
        count: result.count || 0,
        threshold,
      });
    } catch (error) {
      console.error('[PLOT] Error finding similar plots:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Process notebook and extract plots
  app.post('/api/plots/process-notebook', async (req, res) => {
    try {
      const { notebookPath, workspacePath } = req.body;

      if (!notebookPath) {
        return res.status(400).json({
          success: false,
          error: 'notebookPath is required',
        });
      }

      if (!fs.existsSync(notebookPath)) {
        return res.status(404).json({
          success: false,
          error: 'Notebook file not found',
        });
      }

      const result = await plotService.processNotebook(notebookPath, {
        workspacePath,
        autoTrack: true,
      });

      res.json({
        success: result.success,
        plots: result.plots || [],
        count: result.count || 0,
        notebook: result.notebook,
      });
    } catch (error) {
      console.error('[PLOT] Error processing notebook:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Process plot files from directory
  app.post('/api/plots/process-directory', async (req, res) => {
    try {
      const { directory, workspacePath, since } = req.body;

      if (!directory) {
        return res.status(400).json({
          success: false,
          error: 'directory is required',
        });
      }

      if (!fs.existsSync(directory)) {
        return res.status(404).json({
          success: false,
          error: 'Directory not found',
        });
      }

      const result = await plotService.processPlotFiles(directory, {
        workspacePath,
        since: since ? new Date(since).getTime() : null,
        autoTrack: true,
      });

      res.json({
        success: result.success,
        plots: result.plots || [],
        count: result.count || 0,
      });
    } catch (error) {
      console.error('[PLOT] Error processing directory:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Detect plots from code
  app.post('/api/plots/detect-from-code', async (req, res) => {
    try {
      const { code, scriptPath, workspacePath } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'code is required',
        });
      }

      const result = await plotService.detectPlotsFromCode(code, scriptPath, {
        workspacePath,
      });

      res.json({
        success: result.success,
        detectedPaths: result.detectedPaths || [],
        resolvedPlots: result.resolvedPlots || [],
        libraries: result.libraries || [],
      });
    } catch (error) {
      console.error('[PLOT] Error detecting plots from code:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get plot statistics
  app.get('/api/plots/stats', async (req, res) => {
    try {
      const workspacePath = req.query.workspace || req.query.workspace_path || null;

      const filters = workspacePath ? { workspacePath } : {};
      const allPlots = await plotService.getPlots(filters);

      if (!allPlots.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to get plots',
        });
      }

      const plots = allPlots.plots || [];

      // Calculate statistics
      const stats = {
        total: plots.length,
        bySource: {},
        byLibrary: {},
        byFormat: {},
        regenerations: 0,
        uniquePlots: 0,
        withThumbnails: 0,
      };

      plots.forEach((plot) => {
        // By source
        const source = plot.source_type || 'unknown';
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;

        // By library
        const library = plot.library || 'unknown';
        stats.byLibrary[library] = (stats.byLibrary[library] || 0) + 1;

        // By format
        const format = plot.format || 'unknown';
        stats.byFormat[format] = (stats.byFormat[format] || 0) + 1;

        // Regenerations
        if (plot.is_regeneration) {
          stats.regenerations++;
        } else {
          stats.uniquePlots++;
        }

        // Thumbnails
        if (plot.thumbnail_path) {
          stats.withThumbnails++;
        }
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('[PLOT] Error getting plot statistics:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = createPlotRoutes;
