/**
 * User Preferences API Routes
 * Manage user preferences with sync support
 */

function createPreferencesRoutes(deps) {
  const { app, userPreferencesService } = deps;

  if (!userPreferencesService) {
    console.warn('[PREFERENCES-ROUTES] User preferences service not available');
    return;
  }

  /**
   * GET /api/preferences
   * Get all preferences for the current user
   */
  app.get('/api/preferences', async (req, res) => {
    try {
      const userId = req.query.userId || 'default';
      const preferences = await userPreferencesService.getAll(userId);

      res.json({
        success: true,
        preferences,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to get preferences:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/preferences/:category
   * Get preferences for a specific category
   */
  app.get('/api/preferences/:category', async (req, res) => {
    try {
      const { category } = req.params;
      const userId = req.query.userId || 'default';
      const preferences = await userPreferencesService.getCategory(category, userId);

      res.json({
        success: true,
        category,
        preferences,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to get category:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/preferences/:category/:key
   * Get a specific preference
   */
  app.get('/api/preferences/:category/:key', async (req, res) => {
    try {
      const { category, key } = req.params;
      const userId = req.query.userId || 'default';
      const value = await userPreferencesService.get(category, key, userId);

      res.json({
        success: true,
        category,
        key,
        value,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to get preference:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * PUT /api/preferences/:category/:key
   * Set a specific preference
   */
  app.put('/api/preferences/:category/:key', async (req, res) => {
    try {
      const { category, key } = req.params;
      const { value, userId = 'default' } = req.body;

      const result = await userPreferencesService.set(category, key, value, userId, 'api');

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to set preference:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/preferences/sync
   * Bulk sync preferences from frontend
   */
  app.post('/api/preferences/sync', async (req, res) => {
    try {
      const { preferences, userId = 'default' } = req.body;

      if (!preferences || typeof preferences !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Invalid preferences object',
        });
      }

      const result = await userPreferencesService.bulkSet(preferences, userId, 'frontend-sync');

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to sync preferences:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * DELETE /api/preferences/:category/:key
   * Delete a preference (reset to default)
   */
  app.delete('/api/preferences/:category/:key', async (req, res) => {
    try {
      const { category, key } = req.params;
      const userId = req.query.userId || 'default';

      const result = await userPreferencesService.delete(category, key, userId);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to delete preference:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/preferences/reset
   * Reset all preferences to defaults
   */
  app.post('/api/preferences/reset', async (req, res) => {
    try {
      const { userId = 'default' } = req.body;
      const result = await userPreferencesService.resetAll(userId);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to reset preferences:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/preferences/defaults
   * Get default preferences schema
   */
  app.get('/api/preferences/defaults', async (req, res) => {
    try {
      const defaults = userPreferencesService.getDefaults();

      res.json({
        success: true,
        defaults,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/preferences/export
   * Export preferences as JSON backup
   */
  app.get('/api/preferences/export', async (req, res) => {
    try {
      const userId = req.query.userId || 'default';
      const exportData = await userPreferencesService.export(userId);

      res.json({
        success: true,
        ...exportData,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to export preferences:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/preferences/import
   * Import preferences from JSON backup
   */
  app.post('/api/preferences/import', async (req, res) => {
    try {
      const { data, userId = 'default', overwrite = false } = req.body;

      if (!data) {
        return res.status(400).json({
          success: false,
          error: 'No import data provided',
        });
      }

      const result = await userPreferencesService.import(data, userId, overwrite);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to import preferences:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/preferences/sync-log
   * Get preference sync log for debugging
   */
  app.get('/api/preferences/sync-log', async (req, res) => {
    try {
      const userId = req.query.userId || 'default';
      const limit = parseInt(req.query.limit) || 50;
      const logs = await userPreferencesService.getSyncLog(userId, limit);

      res.json({
        success: true,
        logs,
      });
    } catch (error) {
      console.error('[PREFERENCES-API] Failed to get sync log:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[PREFERENCES-ROUTES] User preferences routes registered');
}

module.exports = { createPreferencesRoutes };
