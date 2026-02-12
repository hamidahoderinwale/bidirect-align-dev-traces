/**
 * Raw data API routes
 */

function createRawDataRoutes(deps) {
  const { app, rawData, robustDataCapture } = deps;

  app.get('/raw-data/system-resources', async (req, res) => {
    try {
      const { limit = 10000, since } = req.query;
      
      // Try to get from database first (if robust capture is available)
      if (robustDataCapture) {
        try {
          const data = await robustDataCapture.getSystemResources(
            parseInt(limit),
            since ? parseInt(since) : null
          );
          
          // Get total count from database
          const stats = await robustDataCapture.schema.getTableStats();
          const total = stats.system_resources || 0;
          
          return res.json({
            success: true,
            data: data,
            count: data.length,
            total: total,
            source: 'database',
          });
        } catch (dbError) {
          console.warn('[RAW-DATA] Database query failed, falling back to in-memory:', dbError.message);
          // Fall through to in-memory fallback
        }
      }
      
      // Fallback to in-memory data
      let data = rawData.systemResources || [];
      if (since) {
        const sinceTime = parseInt(since);
        data = data.filter((item) => item.timestamp >= sinceTime);
      }
      data = data.slice(-parseInt(limit));

      res.json({
        success: true,
        data: data,
        count: data.length,
        total: rawData.systemResources.length,
        source: 'memory',
      });
    } catch (error) {
      console.error('[RAW-DATA] Error fetching system resources:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get('/raw-data/git', async (req, res) => {
    try {
      const { limit = 50, since } = req.query;
      
      if (robustDataCapture) {
        try {
          const data = await robustDataCapture.getGitData(
            parseInt(limit),
            since ? parseInt(since) : null
          );
          const stats = await robustDataCapture.schema.getTableStats();
          const total = stats.git_data || 0;
          
          return res.json({
            success: true,
            data: data,
            count: data.length,
            total: total,
            source: 'database',
          });
        } catch (dbError) {
          // Fall through to in-memory
        }
      }
      
      let data = rawData.gitData?.status || [];
      if (since) {
        const sinceTime = parseInt(since);
        data = data.filter((item) => item.timestamp >= sinceTime);
      }
      data = data.slice(-parseInt(limit));

      res.json({
        success: true,
        data: data,
        count: data.length,
        total: rawData.gitData?.status?.length || 0,
        source: 'memory',
      });
    } catch (error) {
      console.error('[RAW-DATA] Error fetching git data:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/raw-data/cursor-database', async (req, res) => {
    try {
      const { limit = 20, since } = req.query;
      
      if (robustDataCapture) {
        try {
          const data = await robustDataCapture.getCursorDbConversations(
            parseInt(limit),
            since ? parseInt(since) : null
          );
          const stats = await robustDataCapture.schema.getTableStats();
          const total = stats.cursor_db_conversations || 0;
          
          return res.json({
            success: true,
            data: data,
            count: data.length,
            total: total,
            source: 'database',
          });
        } catch (dbError) {
          // Fall through to in-memory
        }
      }
      
      let data = rawData.cursorDatabase?.conversations || [];
      if (since) {
        const sinceTime = parseInt(since);
        data = data.filter((item) => item.timestamp >= sinceTime);
      }
      data = data.slice(-parseInt(limit));

      res.json({
        success: true,
        data: data,
        count: data.length,
        total: rawData.cursorDatabase?.conversations?.length || 0,
        source: 'memory',
      });
    } catch (error) {
      console.error('[RAW-DATA] Error fetching Cursor DB conversations:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/raw-data/apple-script', async (req, res) => {
    try {
      const { limit = 10000, since } = req.query;
      
      if (robustDataCapture) {
        try {
          const data = await robustDataCapture.getAppleScriptState(
            parseInt(limit),
            since ? parseInt(since) : null
          );
          const stats = await robustDataCapture.schema.getTableStats();
          const total = stats.apple_script_state || 0;
          
          return res.json({
            success: true,
            data: data,
            count: data.length,
            total: total,
            source: 'database',
          });
        } catch (dbError) {
          // Fall through to in-memory
        }
      }
      
      let data = rawData.appleScript?.appState || [];
      if (since) {
        const sinceTime = parseInt(since);
        data = data.filter((item) => item.timestamp >= sinceTime);
      }
      data = data.slice(-parseInt(limit));

      res.json({
        success: true,
        data: data,
        count: data.length,
        total: rawData.appleScript?.appState?.length || 0,
        source: 'memory',
      });
    } catch (error) {
      console.error('[RAW-DATA] Error fetching AppleScript state:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/raw-data/logs', async (req, res) => {
    try {
      const { limit = 50, since } = req.query;
      
      if (robustDataCapture) {
        try {
          const data = await robustDataCapture.getLogs(
            parseInt(limit),
            since ? parseInt(since) : null
          );
          const stats = await robustDataCapture.schema.getTableStats();
          const total = stats.cursor_logs || 0;
          
          return res.json({
            success: true,
            data: data,
            count: data.length,
            total: total,
            source: 'database',
          });
        } catch (dbError) {
          // Fall through to in-memory
        }
      }
      
      let data = rawData.logs?.cursor || [];
      if (since) {
        const sinceTime = parseInt(since);
        data = data.filter((item) => item.timestamp >= sinceTime);
      }
      data = data.slice(-parseInt(limit));

      res.json({
        success: true,
        data: data,
        count: data.length,
        total: rawData.logs?.cursor?.length || 0,
        source: 'memory',
      });
    } catch (error) {
      console.error('[RAW-DATA] Error fetching logs:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/raw-data/all', (req, res) => {
    const { limit = 50, since } = req.query;

    const allData = {
      systemResources: rawData.systemResources.slice(-parseInt(limit)),
      gitData: rawData.gitData.status.slice(-parseInt(limit)),
      cursorDatabase: rawData.cursorDatabase.conversations.slice(-parseInt(limit)),
      appleScript: rawData.appleScript.appState.slice(-parseInt(limit)),
      logs: rawData.logs.cursor.slice(-parseInt(limit)),
    };

    res.json({
      success: true,
      data: allData,
      counts: {
        systemResources: rawData.systemResources.length,
        gitData: rawData.gitData.status.length,
        cursorDatabase: rawData.cursorDatabase.conversations.length,
        appleScript: rawData.appleScript.appState.length,
        logs: rawData.logs.cursor.length,
      },
    });
  });
}

module.exports = createRawDataRoutes;
