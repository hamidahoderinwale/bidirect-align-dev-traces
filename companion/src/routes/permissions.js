/**
 * Permission routes - Check and manage macOS permissions
 */

function createPermissionRoutes(deps) {
  const { app, permissionChecker } = deps;

  /**
   * GET /api/permissions/check
   * Check all permission statuses
   */
  app.get('/api/permissions/check', async (req, res) => {
    try {
      const results = await permissionChecker.checkAll();

      // Set no-cache headers since permissions can change
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');

      res.json({
        success: true,
        ...results,
      });
    } catch (error) {
      console.error('[PERMISSIONS] Error checking permissions:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/permissions/status
   * Quick status check (cached, faster)
   */
  app.get('/api/permissions/status', async (req, res) => {
    try {
      const results = await permissionChecker.checkAll();

      res.json({
        success: true,
        allGranted: results.allGranted,
        summary: {
          fullDiskAccess: results.permissions.fullDiskAccess.granted,
          accessibility: results.permissions.accessibility.granted,
          automation: results.permissions.automation.granted,
          systemResources: results.permissions.systemResources.granted,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/permissions/open/:type
   * Open System Settings to the appropriate pane
   */
  app.post('/api/permissions/open/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const result = await permissionChecker.openSettings(type);
      res.json(result);
    } catch (error) {
      console.error('[PERMISSIONS] Error opening settings:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/permissions/open/:type
   * Also support GET for convenience
   */
  app.get('/api/permissions/open/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const result = await permissionChecker.openSettings(type);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/permissions/instructions
   * Get step-by-step instructions for fixing permissions
   */
  app.get('/api/permissions/instructions', (req, res) => {
    const instructions = permissionChecker.getInstructions();
    res.json({
      success: true,
      ...instructions,
    });
  });

  /**
   * POST /api/permissions/record-failure
   * Record a runtime permission failure (called by other services)
   */
  app.post('/api/permissions/record-failure', (req, res) => {
    const { type } = req.body;
    if (type) {
      permissionChecker.recordFailure(type);
      res.json({ success: true, recorded: type });
    } else {
      res.status(400).json({ success: false, error: 'Missing type' });
    }
  });

  /**
   * POST /api/permissions/request/automation
   * Request automation permission (triggers system dialog)
   */
  app.post('/api/permissions/request/automation', async (req, res) => {
    try {
      const result = await permissionChecker.requestAutomationPermission();
      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[PERMISSIONS] Error requesting automation permission:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[ROUTES] Registered permission routes: /api/permissions/*');
}

module.exports = createPermissionRoutes;
