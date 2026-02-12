/**
 * Activity API routes
 */

const { generateETagFromValues, checkETag } = require('../utils/etag.js');

function createActivityRoutes(deps) {
  const {
    app,
    persistentDB,
    sequence,
    queryCache,
    redisCache,
    calculateDiff,
    cursorDbParser,
    dataAccessControl,
  } = deps;

  // Use Redis cache if available, fallback to NodeCache
  const cache = redisCache || queryCache;

  async function withCache(key, ttl, asyncFn) {
    const cached = await cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await asyncFn();
    await cache.set(key, result, ttl || 30);
    return result;
  }

  // API endpoint for activity data (used by dashboard) with pagination - OPTIMIZED with caching
  app.get('/api/activity', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout - database query taking too long',
        });
      }
    }, 15000); // 15 second timeout

    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 500); // Default 50 for faster load
      const offset = parseInt(req.query.offset) || 0;
      const workspace = req.query.workspace || req.query.workspace_path || null; // Optional workspace filter

      // Enhanced cache control headers for cloud/CDN optimization
      // Use stale-while-revalidate pattern for better performance
      res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
      res.set('Vary', 'Accept-Encoding'); // Cache different versions for different encodings

      // Cache key based on params
      const cacheKey = `activity_${limit}_${offset}_${workspace || 'all'}_${sequence}`;

      // Try to get from cache first - INCREASED TTL for better performance
      const cached = await withCache(cacheKey, 120, async () => {
        // OPTIMIZATION: Parallel queries for faster loading with timeout protection
        const queryPromise = Promise.all([
          persistentDB.getTotalEntriesCount().catch((err) => {
            console.warn('[API] Error getting total count:', err.message);
            return 0;
          }),
          persistentDB.getRecentEntries(limit, null, offset, workspace).catch((err) => {
            console.warn('[API] Error getting entries:', err.message);
            return [];
          }),
          persistentDB.getRecentPrompts(limit, 0, workspace).catch((err) => {
            console.warn('[API] Error getting prompts:', err.message);
            return [];
          }),
        ]);

        // 10 second timeout for database queries
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Database query timeout')), 10000);
        });

        return Promise.race([queryPromise, timeoutPromise]);
      });

      clearTimeout(timeout);

      // Handle cached result - Promise.all returns an array [totalCount, entries, prompts]
      const [totalCount, paginatedEntries, allPrompts] = cached || [0, [], []];

      // Debug logging
      console.log(
        `[API] Activity endpoint query results: ${paginatedEntries.length} entries, ${allPrompts.length} prompts, total count: ${totalCount}`
      );
      
      if (paginatedEntries.length === 0 && totalCount > 0) {
        console.warn(
          `[API] Activity endpoint: Database has ${totalCount} entries but query returned 0. Check query filters.`
        );
      }

      // Generate ETag from actual content for better cache validation
      const etag = generateETagFromValues(
        true,
        sequence,
        limit,
        offset,
        workspace || 'all',
        totalCount
      );

      // Check If-None-Match header
      if (checkETag(req, res, etag)) {
        return; // 304 Not Modified sent
      }

      // Apply workspace and data source filtering if enabled
      let filteredEntries = paginatedEntries;
      if (dataAccessControl) {
        filteredEntries = dataAccessControl.applyFilters(paginatedEntries, { workspace });
      }

      // Convert entries to events format for dashboard compatibility
      const events = filteredEntries.map((entry) => {
        // Extract diff stats from notes field (e.g., "Diff: +172 chars")
        let diffStats = {};

        if (entry.notes) {
          const charsMatch = entry.notes.match(/Diff: \+(\d+) chars/);
          if (charsMatch) {
            const chars = parseInt(charsMatch[1]);
            diffStats = {
              chars_added: chars,
              chars_deleted: 0, // Notes format doesn't distinguish add/delete, just total change
            };
          }
        }

        // If we have full content (not loaded by default), calculate precise stats
        if (entry.before_code && entry.after_code) {
          const diff = calculateDiff(entry.before_code, entry.after_code);
          diffStats = {
            lines_added: diff.linesAdded,
            lines_removed: diff.linesRemoved,
            chars_added: diff.charsAdded,
            chars_deleted: diff.charsDeleted,
            // Truncate large content to prevent memory issues
            before_content:
              diff.beforeContent.length > 5000
                ? diff.beforeContent.substring(0, 5000) + '\n... (truncated)'
                : diff.beforeContent,
            after_content:
              diff.afterContent.length > 5000
                ? diff.afterContent.substring(0, 5000) + '\n... (truncated)'
                : diff.afterContent,
          };
        }

        return {
          id: entry.id,
          type: entry.type || 'file_change',
          timestamp: entry.timestamp,
          session_id: entry.session_id || 'default',
          workspace_path: entry.workspace_path || entry.file_path || '/unknown',
          file_path: entry.file_path,
          details: JSON.stringify({
            content: entry.content
              ? entry.content.length > 5000
                ? entry.content.substring(0, 5000) + '\n... (truncated)'
                : entry.content
              : null,
            before_content: entry.before_content || entry.before_code,
            after_content: entry.after_content || entry.after_code,
            diff: entry.diff,
            file_path: entry.file_path,
            workspace_path: entry.workspace_path,
            ...diffStats,
          }),
          title:
            entry.title ||
            `File Change: ${entry.file_path ? entry.file_path.split('/').pop() : 'Unknown'}`,
          description: entry.description || entry.notes || 'File change detected',
          // Include metadata fields for modal display
          modelInfo: entry.modelInfo, // Model information (parsed from JSON)
          tags: entry.tags || [], // Tags array
          prompt_id: entry.prompt_id, // Linked prompt ID
          notes: entry.notes, // User notes
          source: entry.source, // Source of the entry
        };
      });

      // Convert prompts to events format as well
      const promptEvents = allPrompts.map((prompt) => {
        return {
          id: `prompt-${prompt.id}`,
          type: 'prompt',
          timestamp: prompt.timestamp,
          session_id: prompt.session_id || 'default',
          workspace_path: prompt.workspace_path || '/unknown',
          text: prompt.text,
          model_name: prompt.model_name,
          model_type: prompt.model_type,
          is_auto: prompt.is_auto,
          context_usage: prompt.context_usage,
          conversation_id: prompt.conversation_id,
          composer_id: prompt.composer_id,
          message_role: prompt.message_role,
          thinking_time_seconds: prompt.thinking_time_seconds,
          prompt_tokens: prompt.prompt_tokens,
          completion_tokens: prompt.completion_tokens,
          total_tokens: prompt.total_tokens,
          context_files_json: prompt.context_files_json,
          context_file_count: prompt.context_file_count,
          source: prompt.source,
          title: `AI Interaction: ${(prompt.text || '').substring(0, 50)}...`,
          description: prompt.subtitle || `${prompt.mode || 'chat'} interaction`,
        };
      });

      // Combine entries and prompts
      const combinedEvents = [...events, ...promptEvents];

      // Update total count if filtering was applied
      const filteredTotal = dataAccessControl && workspace ? filteredEntries.length : totalCount;

      console.log(
        `[API] Returning ${events.length} entries + ${promptEvents.length} prompts = ${combinedEvents.length} total activity events (offset: ${offset}${workspace ? `, workspace: ${workspace}` : ''})`
      );
      res.json({
        data: combinedEvents,
        pagination: {
          total: filteredTotal,
          limit,
          offset,
          hasMore: offset + events.length < filteredTotal,
        },
      });
    } catch (error) {
      console.error('Error fetching activity data:', error);
      res.status(500).json({ error: 'Failed to fetch activity data' });
    }
  });

  // Streaming endpoint for large datasets - returns data progressively
  app.get('/api/activity/stream', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 1000); // Allow more for streaming
      const offset = parseInt(req.query.offset) || 0;
      const workspace = req.query.workspace || req.query.workspace_path || null;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.write('{"data":[');

      // OPTIMIZATION: Use database-level pagination
      let paginatedEntries = await persistentDB.getRecentEntries(limit, null, offset, workspace);

      // Apply workspace and data source filtering if enabled
      if (dataAccessControl) {
        paginatedEntries = dataAccessControl.applyFilters(paginatedEntries, { workspace });
      }

      let first = true;
      for (const entry of paginatedEntries) {
        if (!first) res.write(',');

        const event = {
          id: entry.id,
          type: entry.type || 'file_change',
          timestamp: entry.timestamp,
          session_id: entry.session_id || 'default',
          workspace_path: entry.workspace_path || entry.file_path || '/unknown',
          file_path: entry.file_path,
          title:
            entry.title ||
            `File Change: ${entry.file_path ? entry.file_path.split('/').pop() : 'Unknown'}`,
          description: entry.description || entry.notes || 'File change detected',
          modelInfo: entry.modelInfo,
          tags: entry.tags || [],
          prompt_id: entry.prompt_id,
          source: entry.source,
        };

        res.write(JSON.stringify(event));
        first = false;

        // Flush every 10 items for progressive loading
        if (paginatedEntries.indexOf(entry) % 10 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      // Get total count for pagination (use limit as estimate if count unknown)
      const totalCount = paginatedEntries.length;
      const hasMore = paginatedEntries.length >= limit;

      res.write('],"pagination":{');
      res.write(`"total":${totalCount},`);
      res.write(`"limit":${limit},`);
      res.write(`"offset":${offset},`);
      res.write(`"hasMore":${hasMore}`);
      res.write('}}');
      res.end();

      console.log(`[STREAM] Streamed ${paginatedEntries.length} events`);
    } catch (error) {
      console.error('Error streaming activity data:', error);
      // Only send error response if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream activity data' });
      } else {
        // If we already started streaming, end the response gracefully
        try {
          res.write('],"error":"Stream interrupted","pagination":{"total":0}}');
          res.end();
        } catch (e) {
          // Response already ended, nothing to do
        }
      }
    }
  });

  // Get entries with prompts
  app.get('/entries', async (req, res) => {
    try {
      // Use pagination - don't load everything
      const limit = Math.min(parseInt(req.query.limit) || 200, 500);
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const allPrompts = await persistentDB.getRecentPrompts(limit, 0, workspace);

      // Also get prompts from Cursor database
      try {
        const cursorData = await cursorDbParser.getAllData();
        const cursorPrompts = cursorData.prompts || [];

        // Add Cursor database prompts to response
        const combined = [
          ...allPrompts,
          ...cursorPrompts.map((p) => ({
            id: `cursor_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            timestamp: p.timestamp || new Date().toISOString(),
            text: p.text,
            status: p.status || 'captured',
            source: 'cursor-database',
            method: 'database-extraction',
            confidence: p.confidence || 'medium',
            // Include context and code change metadata
            contextUsage: p.contextUsage || 0,
            linesAdded: p.linesAdded || 0,
            linesRemoved: p.linesRemoved || 0,
            mode: p.mode,
            modelName: p.modelName,
            modelType: p.modelType,
            isAuto: p.isAuto,
            workspaceName: p.workspaceName,
            workspacePath: p.workspacePath,
            composerId: p.composerId,
            subtitle: p.subtitle,
            contextFiles: p.contextFiles,
          })),
        ];

        res.json({ entries: combined });
      } catch (dbError) {
        console.warn('Could not extract Cursor database prompts:', dbError.message);
        res.json({ entries: allPrompts });
      }
    } catch (error) {
      console.error('Error fetching entries with prompts:', error);
      res.status(500).json({ error: 'Failed to fetch entries' });
    }
  });

  // New endpoint specifically for Cursor database data
  // Supports incremental sync via ?since=timestamp query param
  app.get('/api/cursor-database', async (req, res) => {
    try {
      const since = req.query.since ? parseInt(req.query.since) : null;

      // If since is provided, try to return only new data (if parser supports it)
      // For now, we'll use the cache which is updated every 5 minutes
      // This means incremental sync will work if last sync was > 5 min ago
      const data = await cursorDbParser.getAllData();

      // Filter prompts by timestamp if since is provided (basic incremental support)
      let filteredData = data;
      if (since && data.prompts) {
        filteredData = {
          ...data,
          prompts: data.prompts.filter((p) => {
            const promptTime = p.timestamp ? new Date(p.timestamp).getTime() : 0;
            return promptTime > since;
          }),
        };

        // If no new prompts, return early with empty result
        if (filteredData.prompts.length === 0) {
          return res.json({
            success: true,
            data: {
              conversations: [],
              prompts: [],
              stats: { totalPrompts: 0, totalConversations: 0 },
            },
            timestamp: Date.now(),
            incremental: true,
            newItems: 0,
          });
        }
      }

      res.json({
        success: true,
        data: filteredData,
        timestamp: Date.now(),
        incremental: !!since,
        newItems: since ? filteredData.prompts.length : data.prompts.length,
      });
    } catch (error) {
      console.error('Error fetching Cursor database:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Force prompt sync endpoint
  app.post('/api/sync/prompts', async (req, res) => {
    try {
      const forceFullSync = req.query.force === 'true' || req.body?.force === true;

      console.log('[API] Force sync requested', { forceFullSync });

      // Extract prompts from Cursor database
      const data = await cursorDbParser.extractAllAIServiceData();
      const promptCount = data?.length || 0;

      // Note: Actual sync happens via the background interval
      // This endpoint just provides information about available prompts
      res.json({
        success: true,
        message: forceFullSync
          ? 'Full sync will be triggered on next interval'
          : 'Incremental sync runs every 30s',
        prompts_available_in_cursor_db: promptCount,
        note: 'Background sync runs every 30 seconds. Use /api/cursor-database to get fresh data immediately.',
        sync_interval: '30 seconds',
      });
    } catch (error) {
      console.error('Error checking prompt sync:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = createActivityRoutes;
