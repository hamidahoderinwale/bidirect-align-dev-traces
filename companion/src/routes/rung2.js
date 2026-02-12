/**
 * Rung 2 API Routes
 * Endpoints for statement-level (semantic edit scripts) data
 */

function createRung2Routes(deps) {
  const { app, rung2Service } = deps;

  if (!rung2Service) {
    console.warn('[RUNG2] Rung 2 service not available, routes disabled');
    return;
  }

  console.log('[RUNG2] Registering Rung 2 routes...');

  /**
   * GET /api/rung2/preview
   * Get preview samples of edit scripts
   */
  app.get('/api/rung2/preview', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const limit = parseInt(req.query.limit) || 5;

      const filters = {
        language: req.query.language || null,
        filePath: req.query.file_path || null,
      };

      const scripts = await rung2Service.getEditScripts(workspace, filters);

      // Get sample scripts (first N)
      const samples = scripts.slice(0, limit).map((script) => ({
        id: script.id,
        before: script.before_ast || script.before || null,
        after: script.after_ast || script.after || null,
        edit_script: script.edit_script || script.operations || [],
        operation: script.operation || script.type || 'UNKNOWN',
        file_path: script.file_path || script.filePath || null,
        timestamp: script.timestamp || script.created_at || Date.now(),
        metadata: {
          operation_count: script.edit_script?.length || script.operations?.length || 0,
          language: script.language || 'unknown',
        },
      }));

      res.json({
        success: true,
        samples,
        count: samples.length,
        total_available: scripts.length,
      });
    } catch (error) {
      console.error('[RUNG2] Error getting preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung2/edit-scripts', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filters = {
        language: req.query.language || null,
        filePath: req.query.file_path || null,
        since: req.query.since ? parseInt(req.query.since) : null,
        until: req.query.until ? parseInt(req.query.until) : null,
      };

      const scripts = await rung2Service.getEditScripts(workspace, filters);

      res.json({
        success: true,
        scripts,
        count: scripts.length,
      });
    } catch (error) {
      console.error('[RUNG2] Error getting edit scripts:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung2/edit-scripts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const script = await rung2Service.getEditScript(id);

      if (!script) {
        return res.status(404).json({
          success: false,
          error: 'Edit script not found',
        });
      }

      res.json({
        success: true,
        script,
      });
    } catch (error) {
      console.error('[RUNG2] Error getting edit script:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung2/operations', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const operations = await rung2Service.getOperationTypes(workspace);

      res.json({
        success: true,
        operations,
      });
    } catch (error) {
      console.error('[RUNG2] Error getting operations:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/rung2/extract
   * Trigger extraction of edit scripts from Cursor database
   */
  app.post('/api/rung2/extract', async (req, res) => {
    try {
      const workspace = req.body.workspace || req.body.workspace_path || null;
      const forceRefresh = req.body.force === true;

      console.log(`[RUNG2] Starting extraction for workspace: ${workspace || 'all'}`);

      const scripts = await rung2Service.extractEditScripts(workspace, { forceRefresh });

      res.json({
        success: true,
        message: `Extracted ${scripts.length} edit scripts`,
        count: scripts.length,
      });
    } catch (error) {
      console.error('[RUNG2] Error extracting edit scripts:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        details: error.stack,
      });
    }
  });
}

module.exports = createRung2Routes;
