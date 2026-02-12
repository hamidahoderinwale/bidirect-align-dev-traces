/**
 * Enhanced Analytics API Routes
 * Provides comprehensive analytics endpoints for visualization dashboard
 */

function createEnhancedAnalyticsRoutes(deps) {
  const { app, persistentDB } = deps;

  /**
   * Activity over time (timeline)
   * GET /api/analytics/activity-over-time
   */
  app.get('/api/analytics/activity-over-time', async (req, res) => {
    try {
      const { cutoff, workspace = 'all' } = req.query;
      const cutoffDate = cutoff || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      let sql = `
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as count
        FROM events
        WHERE timestamp >= ?
      `;
      
      const params = [cutoffDate];
      
      if (workspace !== 'all') {
        sql += ' AND workspace_path = ?';
        params.push(workspace);
      }
      
      sql += ' GROUP BY DATE(timestamp) ORDER BY date ASC';

      const timeline = await persistentDB.all(sql, params);

      res.json({
        success: true,
        timeline
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Event type distribution
   * GET /api/analytics/event-types
   */
  app.get('/api/analytics/event-types', async (req, res) => {
    try {
      const types = await persistentDB.all(`
        SELECT 
          type,
          COUNT(*) as count
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY type
        ORDER BY count DESC
        LIMIT 15
      `);

      res.json({
        success: true,
        types
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * AI model usage statistics
   * GET /api/analytics/model-usage
   */
  app.get('/api/analytics/model-usage', async (req, res) => {
    try {
      const models = await persistentDB.all(`
        SELECT 
          model,
          COUNT(*) as count
        FROM prompts
        WHERE timestamp >= datetime('now', '-30 days')
          AND model IS NOT NULL
        GROUP BY model
        ORDER BY count DESC
      `);

      const avgContext = await persistentDB.get(`
        SELECT AVG(context_usage) as avg_context
        FROM prompts
        WHERE context_usage IS NOT NULL
          AND timestamp >= datetime('now', '-30 days')
      `);

      res.json({
        success: true,
        models,
        avg_context: avgContext?.avg_context?.toFixed(0) || '0'
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Activity heatmap (by day/hour)
   * GET /api/analytics/activity-heatmap
   */
  app.get('/api/analytics/activity-heatmap', async (req, res) => {
    try {
      // By day of week
      const byDay = await persistentDB.all(`
        SELECT 
          CAST(strftime('%w', timestamp) AS INTEGER) as day_of_week,
          COUNT(*) as count
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY day_of_week
        ORDER BY day_of_week
      `);

      // By hour of day
      const byHour = await persistentDB.all(`
        SELECT 
          CAST(strftime('%H', timestamp) AS INTEGER) as hour,
          COUNT(*) as count
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY hour
        ORDER BY hour
      `);

      // Convert to arrays with all days/hours (fill missing with 0)
      const dayArray = Array(7).fill(0);
      byDay.forEach(d => {
        dayArray[d.day_of_week] = d.count;
      });

      const hourArray = Array(24).fill(0);
      byHour.forEach(h => {
        hourArray[h.hour] = h.count;
      });

      res.json({
        success: true,
        by_day: dayArray,
        by_hour: hourArray
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Top workflow patterns
   * GET /api/analytics/patterns
   */
  app.get('/api/analytics/patterns', async (req, res) => {
    try {
      const { limit = 10 } = req.query;

      // Get event sequences and identify patterns
      const sequences = await persistentDB.all(`
        SELECT 
          session_id,
          GROUP_CONCAT(type, ' → ') as sequence,
          COUNT(*) as length
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY session_id
        HAVING length >= 3
        ORDER BY length DESC
        LIMIT 100
      `);

      // Count pattern frequencies
      const patternCounts = {};
      sequences.forEach(s => {
        // Extract 3-event patterns
        const events = s.sequence.split(' → ');
        for (let i = 0; i < events.length - 2; i++) {
          const pattern = `${events[i]} → ${events[i+1]} → ${events[i+2]}`;
          patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
        }
      });

      // Convert to sorted array
      const patterns = Object.entries(patternCounts)
        .map(([pattern, count]) => ({
          pattern,
          frequency: count
        }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, parseInt(limit));

      res.json({
        success: true,
        patterns
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Productivity metrics
   * GET /api/analytics/productivity
   */
  app.get('/api/analytics/productivity', async (req, res) => {
    try {
      // Average session length
      const avgSession = await persistentDB.get(`
        SELECT AVG(
          (julianday(end_time) - julianday(start_time)) * 24 * 60
        ) as avg_minutes
        FROM sessions
        WHERE start_time >= datetime('now', '-30 days')
          AND end_time IS NOT NULL
      `);

      // Most active hour
      const peakHour = await persistentDB.get(`
        SELECT 
          CAST(strftime('%H', timestamp) AS INTEGER) as hour,
          COUNT(*) as count
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1
      `);

      // Total sessions
      const totalSessions = await persistentDB.get(`
        SELECT COUNT(*) as count
        FROM sessions
        WHERE start_time >= datetime('now', '-30 days')
      `);

      // Unique files modified
      const uniqueFiles = await persistentDB.get(`
        SELECT COUNT(DISTINCT json_extract(details, '$.file_path')) as count
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
          AND json_extract(details, '$.file_path') IS NOT NULL
      `);

      // Daily productivity (events per hour)
      const dailyProductivity = await persistentDB.all(`
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) * 1.0 / 24 as events_per_hour
        FROM events
        WHERE timestamp >= datetime('now', '-30 days')
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `);

      res.json({
        success: true,
        avg_session_minutes: avgSession?.avg_minutes ? Math.round(avgSession.avg_minutes) : 0,
        peak_hour: peakHour?.hour || 0,
        total_sessions: totalSessions?.count || 0,
        unique_files: uniqueFiles?.count || 0,
        daily_productivity: dailyProductivity.map(d => ({
          date: d.date,
          events_per_hour: parseFloat(d.events_per_hour.toFixed(2))
        }))
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * File co-editing network
   * GET /api/analytics/file-network
   */
  app.get('/api/analytics/file-network', async (req, res) => {
    try {
      const { limit = 50 } = req.query;

      // Get files and their co-occurrence
      const cooccurrence = await persistentDB.all(`
        SELECT 
          e1.session_id,
          json_extract(e1.details, '$.file_path') as file1,
          json_extract(e2.details, '$.file_path') as file2,
          COUNT(*) as weight
        FROM events e1
        JOIN events e2 ON e1.session_id = e2.session_id
        WHERE e1.timestamp >= datetime('now', '-30 days')
          AND e2.timestamp >= datetime('now', '-30 days')
          AND file1 IS NOT NULL
          AND file2 IS NOT NULL
          AND file1 < file2
        GROUP BY e1.session_id, file1, file2
        HAVING weight >= 2
        ORDER BY weight DESC
        LIMIT ?
      `, [parseInt(limit)]);

      // Build nodes and links
      const nodeMap = new Map();
      const links = [];

      cooccurrence.forEach(co => {
        // Add nodes
        if (!nodeMap.has(co.file1)) {
          const fileName = co.file1.split('/').pop();
          nodeMap.set(co.file1, {
            id: co.file1,
            label: fileName,
            size: 1
          });
        }
        if (!nodeMap.has(co.file2)) {
          const fileName = co.file2.split('/').pop();
          nodeMap.set(co.file2, {
            id: co.file2,
            label: fileName,
            size: 1
          });
        }

        // Increment node sizes
        nodeMap.get(co.file1).size += co.weight;
        nodeMap.get(co.file2).size += co.weight;

        // Add link
        links.push({
          source: co.file1,
          target: co.file2,
          weight: co.weight
        });
      });

      const nodes = Array.from(nodeMap.values());

      res.json({
        success: true,
        nodes,
        links
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Recent activity timeline
   * GET /api/analytics/recent-activity
   */
  app.get('/api/analytics/recent-activity', async (req, res) => {
    try {
      const { limit = 20 } = req.query;

      const activities = await persistentDB.all(`
        SELECT 
          timestamp,
          type,
          details,
          workspace_path
        FROM events
        ORDER BY timestamp DESC
        LIMIT ?
      `, [parseInt(limit)]);

      // Format activities with descriptions
      const formatted = activities.map(a => {
        let description = '';
        try {
          const details = JSON.parse(a.details);
          if (details.file_path) {
            description = details.file_path.split('/').pop();
          }
        } catch (e) {
          // Ignore parse errors
        }

        return {
          timestamp: a.timestamp,
          type: a.type,
          description,
          workspace: a.workspace_path
        };
      });

      res.json({
        success: true,
        activities: formatted
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Workspace list
   * GET /api/workspaces
   */
  app.get('/api/workspaces', async (req, res) => {
    try {
      const workspaces = await persistentDB.all(`
        SELECT DISTINCT 
          workspace_path as path,
          workspace_name as name
        FROM sessions
        WHERE workspace_path IS NOT NULL
        ORDER BY workspace_name
      `);

      res.json({
        success: true,
        workspaces
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Overall stats
   * GET /api/stats
   */
  app.get('/api/stats', async (req, res) => {
    try {
      const totalSessions = await persistentDB.get('SELECT COUNT(*) as count FROM sessions');
      const totalEvents = await persistentDB.get('SELECT COUNT(*) as count FROM events');
      const totalPrompts = await persistentDB.get('SELECT COUNT(*) as count FROM prompts');

      res.json({
        success: true,
        total_sessions: totalSessions?.count || 0,
        total_events: totalEvents?.count || 0,
        total_prompts: totalPrompts?.count || 0
      });
    } catch (error) {
      console.error('[Analytics] Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  console.log('[Analytics] Enhanced analytics routes initialized');
}

module.exports = createEnhancedAnalyticsRoutes;



















