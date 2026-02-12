/**
 * Combined Timeline Routes
 * API endpoints for accessing unified timeline combining real-time and historical data
 */

function createCombinedTimelineRoutes(deps) {
  const { app, combinedTimelineService } = deps;

  /**
   * GET /api/timeline/combined
   * Get unified timeline combining real-time monitoring and historical mining data
   *
   * Query parameters:
   * - workspace: Filter by workspace path
   * - since: Start timestamp (milliseconds or ISO string)
   * - until: End timestamp (milliseconds or ISO string)
   * - limit: Maximum number of items (default: 1000)
   * - types: Comma-separated list of event types to include
   */
  app.get('/api/timeline/combined', async (req, res) => {
    try {
      const { workspace, since, until, limit, types } = req.query;

      // Parse timestamps
      const sinceTs = since ? (isNaN(since) ? new Date(since).getTime() : parseInt(since)) : null;
      const untilTs = until ? (isNaN(until) ? new Date(until).getTime() : parseInt(until)) : null;

      // Parse types
      const typesList = types ? types.split(',').map((t) => t.trim()) : null;

      const timeline = await combinedTimelineService.getCombinedTimeline({
        workspace,
        since: sinceTs,
        until: untilTs,
        limit: limit ? parseInt(limit) : 1000,
        types: typesList,
      });

      res.json({
        success: true,
        timeline,
        count: timeline.length,
      });
    } catch (error) {
      console.error('[API] Error fetching combined timeline:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/timeline/stats
   * Get statistics about combined timeline data
   *
   * Query parameters:
   * - workspace: Filter by workspace path
   * - since: Start timestamp (milliseconds or ISO string)
   * - until: End timestamp (milliseconds or ISO string)
   */
  app.get('/api/timeline/stats', async (req, res) => {
    try {
      const { workspace, since, until } = req.query;

      // Parse timestamps
      const sinceTs = since ? (isNaN(since) ? new Date(since).getTime() : parseInt(since)) : null;
      const untilTs = until ? (isNaN(until) ? new Date(until).getTime() : parseInt(until)) : null;

      const stats = await combinedTimelineService.getTimelineStats({
        workspace,
        since: sinceTs,
        until: untilTs,
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('[API] Error fetching timeline stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/timeline/types
   * Get list of available timeline event types
   */
  app.get('/api/timeline/types', (req, res) => {
    const types = {
      real_time: ['file_change', 'prompt', 'terminal_command', 'ide_state', 'system_metric'],
      historical: ['git_commit', 'historical_command', 'historical_prompt'],
      all: [
        'file_change',
        'prompt',
        'terminal_command',
        'ide_state',
        'system_metric',
        'git_commit',
        'historical_command',
        'historical_prompt',
      ],
    };

    res.json({
      success: true,
      types,
    });
  });

  console.log('[TIMELINE] Combined timeline routes registered');
}

module.exports = createCombinedTimelineRoutes;
