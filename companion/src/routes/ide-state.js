/**
 * IDE state API routes
 */

function createIDEStateRoutes(deps) {
  const { app, ideStateCapture } = deps;

  app.get('/ide-state', (req, res) => {
    try {
      if (!ideStateCapture) {
        return res.status(503).json({
          success: false,
          error: 'IDE state capture not initialized',
        });
      }

      const latestState = ideStateCapture.getLatestState();

      res.json({
        success: true,
        data: latestState,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error getting IDE state:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/ide-state/history', (req, res) => {
    try {
      if (!ideStateCapture) {
        return res.status(503).json({
          success: false,
          error: 'IDE state capture not initialized',
        });
      }

      const { limit = 10000, since = 0 } = req.query;
      const data = ideStateCapture.getCachedData(parseInt(limit), parseInt(since));

      res.json(data);
    } catch (error) {
      console.error('Error getting IDE state history:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/ide-state/editor', (req, res) => {
    try {
      if (!ideStateCapture) {
        return res.status(503).json({
          success: false,
          error: 'IDE state capture not initialized',
        });
      }

      const latestState = ideStateCapture.getLatestState();
      const editorState = latestState?.editorState || null;

      res.json({
        success: true,
        data: editorState,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error getting editor state:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/ide-state/workspace', (req, res) => {
    try {
      if (!ideStateCapture) {
        return res.status(503).json({
          success: false,
          error: 'IDE state capture not initialized',
        });
      }

      const latestState = ideStateCapture.getLatestState();
      const workspaceState = latestState?.workspaceState || null;

      res.json({
        success: true,
        data: workspaceState,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error getting workspace state:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/ide-state/debug', (req, res) => {
    try {
      if (!ideStateCapture) {
        return res.status(503).json({
          success: false,
          error: 'IDE state capture not initialized',
        });
      }

      const latestState = ideStateCapture.getLatestState();
      const debugState = latestState?.debugState || null;

      res.json({
        success: true,
        data: debugState,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error getting debug state:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/ide-state/cursor', (req, res) => {
    try {
      if (!ideStateCapture) {
        return res.status(503).json({
          success: false,
          error: 'IDE state capture not initialized',
        });
      }

      const latestState = ideStateCapture.getLatestState();
      const cursorState = latestState?.cursorState || null;

      res.json({
        success: true,
        data: cursorState,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error getting cursor state:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createIDEStateRoutes;
