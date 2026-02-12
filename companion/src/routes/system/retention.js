/**
 * Data Retention API Routes
 * Manage data retention policies and cleanup operations
 */

function createRetentionRoutes(deps) {
  const { app, dataRetentionService } = deps;

  if (!dataRetentionService) {
    console.warn('[RETENTION-ROUTES] Data retention service not available');
    return;
  }

  /**
   * GET /api/retention/policies
   * Get all retention policies
   */
  app.get('/api/retention/policies', async (req, res) => {
    try {
      const policies = await dataRetentionService.getPolicies();
      res.json({
        success: true,
        policies,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to get policies:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/retention/policies/:tableName
   * Get a specific retention policy
   */
  app.get('/api/retention/policies/:tableName', async (req, res) => {
    try {
      const { tableName } = req.params;
      const policy = await dataRetentionService.getPolicy(tableName);

      if (!policy) {
        return res.status(404).json({
          success: false,
          error: 'Policy not found',
        });
      }

      res.json({
        success: true,
        policy,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to get policy:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * PUT /api/retention/policies/:tableName
   * Update a retention policy
   */
  app.put('/api/retention/policies/:tableName', async (req, res) => {
    try {
      const { tableName } = req.params;
      const { enabled, retentionDays, deleteOrArchive } = req.body;

      const policy = await dataRetentionService.updatePolicy(tableName, {
        enabled,
        retentionDays,
        deleteOrArchive,
      });

      res.json({
        success: true,
        policy,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to update policy:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/retention/cleanup
   * Run cleanup for all enabled policies
   */
  app.post('/api/retention/cleanup', async (req, res) => {
    try {
      const { dryRun = false } = req.body;

      const result = await dataRetentionService.runFullCleanup(dryRun);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to run cleanup:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/retention/cleanup/:tableName
   * Run cleanup for a specific table
   */
  app.post('/api/retention/cleanup/:tableName', async (req, res) => {
    try {
      const { tableName } = req.params;
      const { dryRun = false } = req.body;

      const result = await dataRetentionService.cleanupTable(tableName, dryRun);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to cleanup table:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/retention/logs
   * Get cleanup history logs
   */
  app.get('/api/retention/logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const logs = await dataRetentionService.getCleanupLogs(limit);

      res.json({
        success: true,
        logs,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to get logs:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/retention/stats
   * Get database size statistics
   */
  app.get('/api/retention/stats', async (req, res) => {
    try {
      const stats = await dataRetentionService.getDatabaseStats();

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to get stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/retention/scheduler/start
   * Start the automatic cleanup scheduler
   */
  app.post('/api/retention/scheduler/start', async (req, res) => {
    try {
      const { intervalHours = 24 } = req.body;
      dataRetentionService.startScheduler(intervalHours);

      res.json({
        success: true,
        message: `Scheduler started with ${intervalHours} hour interval`,
        isRunning: dataRetentionService.isRunning,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to start scheduler:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/retention/scheduler/stop
   * Stop the automatic cleanup scheduler
   */
  app.post('/api/retention/scheduler/stop', async (req, res) => {
    try {
      dataRetentionService.stopScheduler();

      res.json({
        success: true,
        message: 'Scheduler stopped',
        isRunning: dataRetentionService.isRunning,
      });
    } catch (error) {
      console.error('[RETENTION-API] Failed to stop scheduler:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/retention/scheduler/status
   * Get scheduler status
   */
  app.get('/api/retention/scheduler/status', async (req, res) => {
    try {
      res.json({
        success: true,
        isRunning: dataRetentionService.isRunning,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[RETENTION-ROUTES] Data retention routes registered');
}

module.exports = { createRetentionRoutes };
