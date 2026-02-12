/**
 * Analytics API routes - context, errors, productivity, file-usage
 */

function createAnalyticsRoutes(deps) {
  const {
    app,
    persistentDB,
    contextAnalyzer,
    contextChangeTracker,
    errorTracker,
    productivityTracker,
    queryCache,
  } = deps;

  // Cache helper function
  async function withCache(key, ttl, asyncFn) {
    const cached = queryCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await asyncFn();
    queryCache.set(key, result, ttl || 30);
    return result;
  }

  // Cache for file relationship graph
  const fileGraphCache = new Map();
  const GRAPH_CACHE_TTL = 30000; // 30 seconds

  // Context Analytics Endpoints
  app.get('/api/analytics/context', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=30');
      const analytics = await withCache('context_analytics', 30, async () => {
        return await persistentDB.getContextAnalytics();
      });
      res.json({ success: true, data: analytics });
    } catch (error) {
      console.error('Error getting context analytics:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/context/snapshots', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const since = parseInt(req.query.since) || 0;
      const source = req.query.source || 'memory';

      let snapshots;
      if (source === 'database') {
        snapshots = await persistentDB.getContextSnapshots({ limit, since });
      } else {
        snapshots = contextAnalyzer.getRecentSnapshots(limit);
      }

      res.json({
        success: true,
        data: snapshots,
        count: snapshots.length,
        source,
      });
    } catch (error) {
      console.error('Error getting context snapshots:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/context/historical', async (req, res) => {
    try {
      const analytics = await persistentDB.getContextAnalytics();
      res.json({
        success: true,
        data: analytics,
        source: 'database',
      });
    } catch (error) {
      console.error('Error getting historical context analytics:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/context/timeline', (req, res) => {
    try {
      const timeline = contextAnalyzer.getContextTimeline();
      res.json({ success: true, data: timeline });
    } catch (error) {
      console.error('Error getting context timeline:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/context/file-relationships', (req, res) => {
    try {
      // Default to minCount=1 for faster response (includes more files)
      const minCount = parseInt(req.query.minCount) || 1;
      const cacheKey = `graph:${minCount}`;

      const cached = fileGraphCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL) {
        res.set('X-Cache', 'HIT');
        return res.json({
          success: true,
          data: cached.data,
          cached: true,
        });
      }

      // Get graph data (this is fast - uses pre-computed co-occurrence data)
      const graph = contextAnalyzer.getFileRelationshipGraph(minCount);

      // Cache the result
      fileGraphCache.set(cacheKey, {
        data: graph,
        timestamp: Date.now(),
      });

      // Limit cache size
      if (fileGraphCache.size > 10) {
        const oldestKey = Array.from(fileGraphCache.keys())[0];
        fileGraphCache.delete(oldestKey);
      }

      res.set('X-Cache', 'MISS');
      res.json({ success: true, data: graph });
    } catch (error) {
      console.error('Error getting file relationships:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/context/changes', async (req, res) => {
    try {
      const {
        promptId = null,
        eventId = null,
        taskId = null,
        sessionId = null,
        startTime = null,
        endTime = null,
        limit = parseInt(req.query.limit) || 100,
      } = req.query;

      const options = {
        promptId: promptId || null,
        eventId: eventId || null,
        taskId: taskId || null,
        sessionId: sessionId || null,
        startTime: startTime ? parseInt(startTime) : null,
        endTime: endTime ? parseInt(endTime) : null,
        limit: parseInt(limit),
      };

      const changes = await persistentDB.getContextChanges(options);

      res.json({
        success: true,
        data: changes,
        count: changes.length,
        filters: options,
      });
    } catch (error) {
      console.error('Error getting context changes:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/prompts/:id/context-changes', async (req, res) => {
    try {
      const promptId = req.params.id;
      const changes = await contextChangeTracker.getContextChangesForPrompt(promptId);

      res.json({
        success: true,
        data: changes,
        count: changes.length,
        promptId,
      });
    } catch (error) {
      console.error('Error getting context changes for prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/events/:id/context-changes', async (req, res) => {
    try {
      const eventId = req.params.id;
      const changes = await contextChangeTracker.getContextChangesForEvent(eventId);

      res.json({
        success: true,
        data: changes,
        count: changes.length,
        eventId,
      });
    } catch (error) {
      console.error('Error getting context changes for event:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/context/changes/summary', (req, res) => {
    try {
      const stats = contextChangeTracker.getSummaryStats();
      res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting context changes summary:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Error Tracking Endpoints
  app.get('/api/analytics/errors', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=30');
      const stats = await withCache('error_stats', 30, async () => {
        return errorTracker.getErrorStats();
      });
      res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting error stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/analytics/errors/recent', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const errors = errorTracker.getRecentErrors(limit);
      res.json({
        success: true,
        data: errors,
        count: errors.length,
      });
    } catch (error) {
      console.error('Error getting recent errors:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Productivity Metrics Endpoints
  app.get('/api/analytics/productivity', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=30');
      const stats = await withCache('productivity_stats', 30, async () => {
        return await productivityTracker.getProductivityStats(persistentDB);
      });
      res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting productivity stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // File Usage Analytics
  app.get('/api/analytics/file-usage', async (req, res) => {
    try {
      const prompts = await persistentDB.getAllPrompts();

      const fileUsage = new Map();
      let totalFileCount = 0;
      let totalPrompts = 0;
      let explicitCount = 0;
      let autoCount = 0;

      prompts.forEach((prompt) => {
        if (prompt.context_file_count > 0) {
          totalFileCount += prompt.context_file_count;
          totalPrompts++;
          explicitCount += prompt.context_file_count_explicit || 0;
          autoCount += prompt.context_file_count_auto || 0;

          if (prompt.context_files_json) {
            try {
              const files = JSON.parse(prompt.context_files_json);
              files.forEach((file) => {
                const filePath = file.path || file;
                const existing = fileUsage.get(filePath) || {
                  count: 0,
                  sources: new Set(),
                  name: file.name || filePath,
                };
                existing.count++;
                existing.sources.add(file.source || 'unknown');
                fileUsage.set(filePath, existing);
              });
            } catch (e) {
              // Skip parsing errors
            }
          }
        }
      });

      const sortedFiles = Array.from(fileUsage.entries())
        .map(([path, data]) => ({
          path,
          name: data.name,
          count: data.count,
          sources: Array.from(data.sources),
        }))
        .sort((a, b) => b.count - a.count);

      // Calculate context file counts, using context_files_json if context_file_count is missing
      const contextFileCounts = [];
      prompts.forEach((p) => {
        let count = p.context_file_count || 0;

        // If context_file_count is 0/null/undefined but we have context_files_json, calculate from it
        if (count === 0 && p.context_files_json) {
          try {
            const files = JSON.parse(p.context_files_json);
            count = Array.isArray(files) ? files.length : 0;
          } catch (e) {
            // If parsing fails, keep count as 0
            count = 0;
          }
        }

        contextFileCounts.push(count);
      });

      // Calculate statistics
      const validCounts = contextFileCounts.filter((c) => c > 0);
      const avgFilesPerPrompt =
        contextFileCounts.length > 0
          ? (contextFileCounts.reduce((a, b) => a + b, 0) / contextFileCounts.length).toFixed(2)
          : '0.00';

      const medianFilesPerPrompt =
        validCounts.length > 0
          ? (() => {
              const sorted = [...validCounts].sort((a, b) => a - b);
              const mid = Math.floor(sorted.length / 2);
              return sorted.length % 2 === 0
                ? ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1)
                : sorted[mid].toFixed(1);
            })()
          : '0';

      const promptsWithContext = validCounts.length;
      const promptsWithoutContext = contextFileCounts.length - promptsWithContext;

      res.json({
        success: true,
        data: {
          mostUsedFiles: sortedFiles.slice(0, 20),
          avgFilesPerPrompt: avgFilesPerPrompt,
          medianFilesPerPrompt: medianFilesPerPrompt,
          promptsWithContext: promptsWithContext,
          promptsWithoutContext: promptsWithoutContext,
          totalPrompts: contextFileCounts.length,
          totalUniqueFiles: fileUsage.size,
          explicitVsAuto: {
            explicit: explicitCount,
            auto: autoCount,
            ratio: autoCount > 0 ? (explicitCount / autoCount).toFixed(2) : 0,
          },
        },
      });
    } catch (error) {
      console.error('Error getting file usage stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createAnalyticsRoutes;
