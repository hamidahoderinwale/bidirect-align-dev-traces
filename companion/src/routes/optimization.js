/**
 * Database Optimization API Routes
 * Provides endpoints for database performance monitoring and optimization
 */

const DatabaseSpeedOptimizations = require('../database/speed-optimizations');

function createOptimizationRoutes(deps) {
  const { app, persistentDB } = deps;

  // Initialize optimization service
  const optimizer = new DatabaseSpeedOptimizations(persistentDB);

  /**
   * Apply all speed optimizations
   * POST /api/optimize/apply
   */
  app.post('/api/optimize/apply', async (req, res) => {
    console.log('[Optimization API] Applying optimizations...');
    
    try {
      const result = await optimizer.applyAll();
      res.json({
        success: true,
        message: 'Database optimizations applied successfully',
        ...result
      });
    } catch (error) {
      console.error('[Optimization API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get optimization status
   * GET /api/optimize/status
   */
  app.get('/api/optimize/status', async (req, res) => {
    try {
      const status = await optimizer.getStatus();
      res.json({
        success: true,
        ...status
      });
    } catch (error) {
      console.error('[Optimization API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Run maintenance tasks
   * POST /api/optimize/maintenance
   */
  app.post('/api/optimize/maintenance', async (req, res) => {
    try {
      const result = await optimizer.runMaintenance();
      res.json({
        success: true,
        message: 'Maintenance tasks completed',
        ...result
      });
    } catch (error) {
      console.error('[Optimization API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Refresh materialized views
   * POST /api/optimize/refresh-views
   */
  app.post('/api/optimize/refresh-views', async (req, res) => {
    try {
      await optimizer.refreshMaterializedViews();
      res.json({
        success: true,
        message: 'Materialized views refreshed'
      });
    } catch (error) {
      console.error('[Optimization API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Explain query plan for debugging
   * POST /api/optimize/explain
   */
  app.post('/api/optimize/explain', async (req, res) => {
    try {
      const { query } = req.body;
      
      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query parameter is required'
        });
      }

      const plan = await optimizer.explainQuery(query);
      res.json({
        success: true,
        query,
        plan
      });
    } catch (error) {
      console.error('[Optimization API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get query performance metrics
   * GET /api/optimize/metrics
   */
  app.get('/api/optimize/metrics', async (req, res) => {
    try {
      // Get various performance metrics
      const metrics = {
        cache_stats: await persistentDB.get('PRAGMA cache_stats'),
        page_stats: {
          page_count: await persistentDB.get('PRAGMA page_count'),
          freelist_count: await persistentDB.get('PRAGMA freelist_count'),
        },
        wal_stats: await persistentDB.get('PRAGMA wal_checkpoint(PASSIVE)'),
      };

      // Table sizes
      const tableSizes = await persistentDB.all(`
        SELECT 
          name as table_name,
          (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name=m.name) as index_count
        FROM sqlite_master m
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `);

      res.json({
        success: true,
        metrics,
        tables: tableSizes
      });
    } catch (error) {
      console.error('[Optimization API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Schedule automatic maintenance (every hour)
  setInterval(async () => {
    console.log('[Optimization] Running scheduled maintenance...');
    try {
      await optimizer.runMaintenance();
    } catch (error) {
      console.error('[Optimization] Scheduled maintenance error:', error);
    }
  }, 60 * 60 * 1000); // 1 hour

  console.log('[Optimization] Routes initialized with automatic hourly maintenance');
}

module.exports = createOptimizationRoutes;

