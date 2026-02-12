/**
 * Export History API Routes
 * Track and retrieve export history records
 */

function createExportHistoryRoutes(deps) {
  const { app, exportHistoryService } = deps;

  if (!exportHistoryService) {
    console.warn('[EXPORT-HISTORY-ROUTES] Export history service not available');
    return;
  }

  /**
   * GET /api/export-history
   * Get export history with pagination and filters
   */
  app.get('/api/export-history', async (req, res) => {
    try {
      const {
        limit = 50,
        offset = 0,
        exportType,
        format,
        status,
        startDate,
        endDate,
        sortBy,
        sortOrder,
      } = req.query;

      const result = await exportHistoryService.getHistory({
        limit: parseInt(limit),
        offset: parseInt(offset),
        exportType,
        format,
        status,
        startDate,
        endDate,
        sortBy,
        sortOrder,
      });

      res.json(result);
    } catch (error) {
      console.error('[EXPORT-HISTORY-API] Failed to get history:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/export-history/:id
   * Get a specific export record
   */
  app.get('/api/export-history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const record = await exportHistoryService.getById(parseInt(id));

      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Export record not found',
        });
      }

      res.json({
        success: true,
        record,
      });
    } catch (error) {
      console.error('[EXPORT-HISTORY-API] Failed to get record:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/export-history/stats
   * Get export statistics
   */
  app.get('/api/export-history/stats', async (req, res) => {
    try {
      const stats = await exportHistoryService.getStats();

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('[EXPORT-HISTORY-API] Failed to get stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/export-history/by-type
   * Get exports grouped by type
   */
  app.get('/api/export-history/by-type', async (req, res) => {
    try {
      const byType = await exportHistoryService.getByType();

      res.json({
        success: true,
        byType,
      });
    } catch (error) {
      console.error('[EXPORT-HISTORY-API] Failed to get by type:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/export-history/cleanup
   * Clean up old export history records
   */
  app.post('/api/export-history/cleanup', async (req, res) => {
    try {
      const { olderThanDays = 90 } = req.body;
      const result = await exportHistoryService.cleanup(olderThanDays);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[EXPORT-HISTORY-API] Failed to cleanup:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[EXPORT-HISTORY-ROUTES] Export history routes registered');
}

module.exports = { createExportHistoryRoutes };
