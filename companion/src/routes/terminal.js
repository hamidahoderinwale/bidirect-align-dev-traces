/**
 * Terminal monitoring API routes
 */

function createTerminalRoutes(deps) {
  const { app, persistentDB, terminalMonitor } = deps;

  app.get('/api/terminal/history', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const source = req.query.source;
      const since = req.query.since ? parseInt(req.query.since) : null;
      const workspace = req.query.workspace;
      const exitCode = req.query.exitCode ? parseInt(req.query.exitCode) : undefined;

      const history = await persistentDB.getTerminalCommands({
        limit,
        source,
        since,
        workspace,
        exitCode,
      });

      res.json({
        success: true,
        data: history,
        count: history.length,
      });
    } catch (error) {
      console.error('Error getting terminal history:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/terminal/stats', async (req, res) => {
    try {
      const memoryStats = terminalMonitor.getStats();
      const allCommands = await persistentDB.getAllTerminalCommands();

      const now = Date.now();
      const last24h = now - 24 * 60 * 60 * 1000;
      const recentCommands = allCommands.filter((cmd) => cmd.timestamp > last24h);
      const errorCommands = allCommands.filter((cmd) => cmd.exit_code && cmd.exit_code !== 0);

      const bySource = {};
      allCommands.forEach((cmd) => {
        bySource[cmd.source] = (bySource[cmd.source] || 0) + 1;
      });

      const commandCounts = {};
      allCommands.forEach((cmd) => {
        const shortCmd = cmd.command.split(' ')[0];
        commandCounts[shortCmd] = (commandCounts[shortCmd] || 0) + 1;
      });
      const topCommands = Object.entries(commandCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([cmd, count]) => ({ command: cmd, count }));

      res.json({
        success: true,
        data: {
          total: allCommands.length,
          last24h: recentCommands.length,
          errorCount: errorCommands.length,
          errorRate:
            allCommands.length > 0
              ? ((errorCommands.length / allCommands.length) * 100).toFixed(2)
              : 0,
          bySource: bySource,
          topCommands: topCommands,
          memory: memoryStats,
        },
      });
    } catch (error) {
      console.error('Error getting terminal stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/terminal/enable', (req, res) => {
    try {
      terminalMonitor.start();
      res.json({
        success: true,
        message: 'Terminal monitoring enabled',
      });
    } catch (error) {
      console.error('Error enabling terminal monitoring:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/terminal/disable', (req, res) => {
    try {
      terminalMonitor.stop();
      res.json({
        success: true,
        message: 'Terminal monitoring disabled',
      });
    } catch (error) {
      console.error('Error disabling terminal monitoring:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createTerminalRoutes;
