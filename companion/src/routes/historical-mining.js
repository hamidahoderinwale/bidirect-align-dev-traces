/**
 * Historical Mining API Routes
 * Endpoints for triggering and retrieving historical data mining
 */

function createHistoricalMiningRoutes(deps) {
  const { app, historicalMiningService, persistentDB } = deps;

  /**
   * Trigger full workspace mining
   * POST /api/mining/workspace
   */
  app.post('/api/mining/workspace', async (req, res) => {
    try {
      const {
        workspace,
        includeGit = true,
        includeShell = true,
        includeCursorLogs = true,
        includeFileTimeline = true,
        sinceDays,
        includeDiffs = false,
      } = req.body;

      if (!workspace) {
        return res.status(400).json({
          success: false,
          error: 'Workspace path is required',
        });
      }

      // Check if mining is already in progress
      const status = historicalMiningService.getStatus();
      if (status.inProgress) {
        return res.status(409).json({
          success: false,
          error: 'Mining operation already in progress',
        });
      }

      // Start mining (runs asynchronously)
      const miningPromise = historicalMiningService.mineWorkspace(workspace, {
        includeGit,
        includeShell,
        includeCursorLogs,
        includeFileTimeline,
        sinceDays,
        includeDiffs,
      });

      // Save mining run record
      const runRecord = {
        workspace_path: workspace,
        started_at: Date.now(),
        status: 'in_progress',
      };
      const runId = await persistentDB.saveMiningRun(runRecord);

      // Update record when mining completes
      miningPromise
        .then(async (results) => {
          await persistentDB.saveMiningRun({
            workspace_path: workspace,
            started_at: results.started_at,
            completed_at: Date.now(),
            duration_ms: results.duration_ms,
            git_commits: results.git?.commits || 0,
            shell_commands: results.shell?.commands || 0,
            cursor_prompts: results.cursor_logs?.prompts || 0,
            file_timestamps: results.file_timeline?.files || 0,
            errors: results.errors,
            status: 'completed',
          });
        })
        .catch(async (error) => {
          await persistentDB.saveMiningRun({
            workspace_path: workspace,
            started_at: runRecord.started_at,
            completed_at: Date.now(),
            errors: [{ message: error.message }],
            status: 'failed',
          });
        });

      res.json({
        success: true,
        message: 'Mining started',
        runId,
      });
    } catch (error) {
      console.error('[MINING-API] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Trigger git history mining
   * POST /api/mining/git-history
   */
  app.post('/api/mining/git-history', async (req, res) => {
    try {
      const { workspace, sinceDays, includeDiffs } = req.body;

      if (!workspace) {
        return res.status(400).json({
          success: false,
          error: 'Workspace path is required',
        });
      }

      const results = await historicalMiningService.mineGitHistory(workspace, {
        sinceDays,
        includeDiffs,
      });

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error('[MINING-API] Git mining error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Trigger shell history mining
   * POST /api/mining/shell-history
   */
  app.post('/api/mining/shell-history', async (req, res) => {
    try {
      const results = await historicalMiningService.mineShellHistory();

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error('[MINING-API] Shell mining error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Trigger Cursor logs mining
   * POST /api/mining/cursor-logs
   */
  app.post('/api/mining/cursor-logs', async (req, res) => {
    try {
      const results = await historicalMiningService.mineCursorLogs();

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error('[MINING-API] Cursor logs mining error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Trigger file timeline mining
   * POST /api/mining/file-timeline
   */
  app.post('/api/mining/file-timeline', async (req, res) => {
    try {
      const { workspace } = req.body;

      if (!workspace) {
        return res.status(400).json({
          success: false,
          error: 'Workspace path is required',
        });
      }

      const results = await historicalMiningService.mineFileTimestamps(workspace);

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error('[MINING-API] File timeline mining error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get mining status
   * GET /api/mining/status
   */
  app.get('/api/mining/status', (req, res) => {
    try {
      const status = historicalMiningService.getStatus();

      res.json({
        success: true,
        status,
      });
    } catch (error) {
      console.error('[MINING-API] Status error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get historical commits
   * GET /api/historical/commits
   */
  app.get('/api/historical/commits', async (req, res) => {
    try {
      const { workspace, since, until, author, limit = 100 } = req.query;

      const commits = await persistentDB.getHistoricalCommits({
        workspace,
        since,
        until,
        author,
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        commits,
        count: commits.length,
      });
    } catch (error) {
      console.error('[MINING-API] Get commits error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get historical commands
   * GET /api/historical/commands
   */
  app.get('/api/historical/commands', async (req, res) => {
    try {
      const { since, until, shell, limit = 100 } = req.query;

      const commands = await persistentDB.getHistoricalCommands({
        since,
        until,
        shell,
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        commands,
        count: commands.length,
      });
    } catch (error) {
      console.error('[MINING-API] Get commands error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get historical prompts
   * GET /api/historical/prompts
   */
  app.get('/api/historical/prompts', async (req, res) => {
    try {
      const { since, until, minConfidence = 0.5, limit = 100 } = req.query;

      const prompts = await persistentDB.getHistoricalPrompts({
        since,
        until,
        minConfidence: parseFloat(minConfidence),
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        prompts,
        count: prompts.length,
      });
    } catch (error) {
      console.error('[MINING-API] Get prompts error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get mining runs history
   * GET /api/historical/mining-runs
   */
  app.get('/api/historical/mining-runs', async (req, res) => {
    try {
      const { workspace, limit = 10 } = req.query;

      const runs = await persistentDB.getMiningRuns({
        workspace,
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        runs,
        count: runs.length,
      });
    } catch (error) {
      console.error('[MINING-API] Get mining runs error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get mining statistics
   * GET /api/historical/stats
   */
  app.get('/api/historical/stats', async (req, res) => {
    try {
      await persistentDB.init();

      const stats = await new Promise((resolve, reject) => {
        persistentDB.db.all(
          `
          SELECT 
            (SELECT COUNT(*) FROM historical_commits) as total_commits,
            (SELECT COUNT(*) FROM historical_commands) as total_commands,
            (SELECT COUNT(*) FROM historical_prompts) as total_prompts,
            (SELECT COUNT(*) FROM file_timestamps) as total_files,
            (SELECT COUNT(*) FROM mining_runs) as total_runs,
            (SELECT MIN(date) FROM historical_commits) as earliest_commit,
            (SELECT MAX(date) FROM historical_commits) as latest_commit
          `,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows[0]);
          }
        );
      });

      res.json({
        success: true,
        stats: {
          ...stats,
          earliest_commit: stats.earliest_commit
            ? new Date(stats.earliest_commit).toISOString()
            : null,
          latest_commit: stats.latest_commit ? new Date(stats.latest_commit).toISOString() : null,
        },
      });
    } catch (error) {
      console.error('[MINING-API] Get stats error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[API] Historical mining routes registered');
}

module.exports = createHistoricalMiningRoutes;
