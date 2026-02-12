/**
 * Rung 3 API Routes
 * Endpoints for function-level representation data
 */

function createRung3Routes(deps) {
  const { app, rung3Service } = deps;

  if (!rung3Service) {
    console.warn('[RUNG3] Rung 3 service not available, routes disabled');
    return;
  }

  console.log('[RUNG3] Registering Rung 3 routes...');

  /**
   * GET /api/rung3/preview
   * Get preview samples of function changes
   */
  app.get('/api/rung3/preview', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const limit = parseInt(req.query.limit) || 5;

      const filters = {
        language: req.query.language || null,
        filePath: req.query.file_path || null,
      };

      const changes = await rung3Service.getFunctionChanges(workspace, filters);

      // Get sample changes (first N)
      const samples = changes.slice(0, limit).map((change) => ({
        id: change.id,
        before_signature: change.before_signature || change.before || null,
        after_signature: change.after_signature || change.after || null,
        function_signature: change.function_signature || change.signature || null,
        function_name: change.function_name || change.name || null,
        file_path: change.file_path || change.filePath || null,
        timestamp: change.timestamp || change.created_at || Date.now(),
        call_count: change.call_count || 0,
        metadata: {
          change_type: change.change_type || change.type || 'unknown',
          language: change.language || 'unknown',
        },
      }));

      res.json({
        success: true,
        samples,
        count: samples.length,
        total_available: changes.length,
      });
    } catch (error) {
      console.error('[RUNG3] Error getting preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung3/changes', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filters = {
        language: req.query.language || null,
        filePath: req.query.file_path || null,
        changeType: req.query.change_type || null,
        since: req.query.since ? parseInt(req.query.since) : null,
        until: req.query.until ? parseInt(req.query.until) : null,
      };

      const changes = await rung3Service.getFunctionChanges(workspace, filters);

      res.json({
        success: true,
        changes,
        count: changes.length,
      });
    } catch (error) {
      console.error('[RUNG3] Error getting function changes:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung3/changes/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const change = await rung3Service.getFunctionChange(id);

      if (!change) {
        return res.status(404).json({
          success: false,
          error: 'Function change not found',
        });
      }

      res.json({
        success: true,
        change,
      });
    } catch (error) {
      console.error('[RUNG3] Error getting function change:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung3/functions', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filters = {
        filePath: req.query.file_path || null,
        language: req.query.language || null,
      };

      const functions = await rung3Service.getFunctions(workspace, filters);

      res.json({
        success: true,
        functions,
        count: functions.length,
      });
    } catch (error) {
      console.error('[RUNG3] Error getting functions:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung3/callgraph', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filePath = req.query.file_path || null;

      const callgraph = await rung3Service.getCallGraph(workspace, filePath);

      res.json({
        success: true,
        callgraph,
      });
    } catch (error) {
      console.error('[RUNG3] Error getting call graph:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/api/rung3/stats', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const stats = await rung3Service.getFunctionStats(workspace);

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('[RUNG3] Error getting stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/rung3/extract
   * Trigger extraction of function changes from Cursor database
   */
  app.post('/api/rung3/extract', async (req, res) => {
    try {
      const workspace = req.body.workspace || req.body.workspace_path || null;
      const forceRefresh = req.body.force === true;

      console.log(`[RUNG3] Starting extraction for workspace: ${workspace || 'all'}`);

      const data = await rung3Service.extractFunctionChanges(workspace, { forceRefresh });

      res.json({
        success: true,
        message: `Extracted ${data.changes.length} function changes and ${data.functions.length} functions`,
        changes: data.changes.length,
        functions: data.functions.length,
        callGraphNodes: data.callGraph?.nodes?.length || 0,
        callGraphEdges: data.callGraph?.edges?.length || 0,
      });
    } catch (error) {
      console.error('[RUNG3] Error extracting function changes:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        details: error.stack,
      });
    }
  });
}

module.exports = createRung3Routes;
