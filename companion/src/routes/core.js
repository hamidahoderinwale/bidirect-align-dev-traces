/**
 * Core API routes - health, queue, debug
 */

function createCoreRoutes(deps) {
  const {
    app,
    db,
    queue,
    sequence,
    rawData,
    queueSystem,
    clipboardMonitor,
    queryCache,
    dataAccessControl,
    robustDataCapture,
  } = deps;

  // Health check
  app.get('/health', async (req, res) => {
    const queueStats = queueSystem.getStats();
    const clipboardStats = clipboardMonitor.getStats();
    const cacheStats = queryCache.getStats();

    // No caching for health check
    res.set('Cache-Control', 'no-cache');

    // Get raw data stats from database if available, otherwise use in-memory
    let rawDataStats = {
      systemResources: rawData.systemResources.length,
      gitData: rawData.gitData.status.length,
      cursorDatabase: rawData.cursorDatabase.conversations.length,
      appleScript: rawData.appleScript.appState.length,
      logs: rawData.logs.cursor.length,
      source: 'memory',
    };

    if (robustDataCapture) {
      try {
        const stats = await robustDataCapture.schema.getTableStats();
        rawDataStats = {
          systemResources: stats.system_resources || rawData.systemResources.length,
          gitData: stats.git_data || rawData.gitData.status.length,
          cursorDatabase: stats.cursor_db_conversations || rawData.cursorDatabase.conversations.length,
          appleScript: stats.apple_script_state || rawData.appleScript.appState.length,
          logs: stats.cursor_logs || rawData.logs.cursor.length,
          source: 'database',
          memory_fallback: {
            systemResources: rawData.systemResources.length,
            gitData: rawData.gitData.status.length,
            cursorDatabase: rawData.cursorDatabase.conversations.length,
            appleScript: rawData.appleScript.appState.length,
            logs: rawData.logs.cursor.length,
          },
        };
      } catch (error) {
        // Fallback to in-memory stats if database query fails
        console.warn('[HEALTH] Failed to get database stats, using in-memory:', error.message);
      }
    }

    res.json({
      status: 'running',
      timestamp: new Date().toISOString(),
      entries: db.entries.length,
      prompts: db.prompts.length,
      queue_length: queue.length,
      sequence: sequence,
      queue_stats: queueStats,
      clipboard_stats: clipboardStats,
      raw_data_stats: rawDataStats,
      cache_stats: {
        keys: queryCache.keys().length,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) || 0,
      },
      url: `http://${req.get('host')}`,
    });
  });

  // Companion service status (alias for health with more UI-friendly format)
  // Optimized: returns fast from memory, with short cache for repeated polls
  let statusCache = null;
  let statusCacheTime = 0;
  const STATUS_CACHE_TTL = 1000; // 1 second cache to prevent polling storms

  app.get('/api/companion/status', (req, res) => {
    // Return cached response if recent (prevents polling storms)
    const now = Date.now();
    if (statusCache && now - statusCacheTime < STATUS_CACHE_TTL) {
      res.set('Cache-Control', 'public, max-age=1');
      return res.json(statusCache);
    }

    // Build response from in-memory data only (no async operations)
    const queueStats = queueSystem.getStats();
    const clipboardStats = clipboardMonitor.getStats();
    const cacheStats = queryCache.getStats();

    const response = {
      success: true,
      running: true,
      status: 'running',
      timestamp: new Date().toISOString(),
      url: `http://${req.get('host')}`,
      stats: {
        entries: db.entries.length,
        prompts: db.prompts.length,
        queue_length: queue.length,
        sequence: sequence,
      },
      services: {
        queue: queueStats,
        clipboard: clipboardStats,
        cache: {
          keys: queryCache.keys().length,
          hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) || 0,
        },
      },
    };

    // Cache the response
    statusCache = response;
    statusCacheTime = now;

    res.set('Cache-Control', 'public, max-age=1');
    res.json(response);
  });

  // Start companion service
  // Note: If this endpoint is accessible, the service is already running.
  // This endpoint can help start a NEW instance or restart via system services.
  app.post('/api/companion/start', async (req, res) => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    const companionDir = path.resolve(__dirname, '../..');
    const plistPath = path.join(companionDir, 'com.cursor.companion.plist');
    const isMacOS = os.platform() === 'darwin';

    // If this endpoint is being called, the service is already running
    // But we can still try to start it via system services if needed
    try {
      // Method 1: Try launchctl on macOS if plist exists
      if (isMacOS && fs.existsSync(plistPath)) {
        try {
          // Check if service is loaded
          const { stdout: listOutput } = await execAsync(
            'launchctl list | grep com.cursor.companion'
          ).catch(() => ({ stdout: '' }));

          if (listOutput.includes('com.cursor.companion')) {
            // Service is already loaded, try to start it
            await execAsync('launchctl start com.cursor.companion').catch(() => {});
            res.json({
              success: true,
              message: 'Companion service is already running (via launchctl)',
              running: true,
              method: 'launchctl',
              url: `http://${req.get('host')}`,
            });
            return;
          } else {
            // Service not loaded, try to load it
            await execAsync(`launchctl load "${plistPath}"`);
            await execAsync('launchctl start com.cursor.companion').catch(() => {});
            res.json({
              success: true,
              message: 'Companion service started via launchctl',
              method: 'launchctl',
              note: 'Service may take a few seconds to fully start. Check status in a moment.',
            });
            return;
          }
        } catch (launchctlError) {
          console.log('[COMPANION] launchctl method failed:', launchctlError.message);
          // Fall through to next method
        }
      }

      // Method 2: Service is already running (we're responding to this request!)
      res.json({
        success: true,
        message: 'Companion service is already running',
        running: true,
        url: `http://${req.get('host')}`,
        note: 'To start a new instance, use system services (launchctl/systemd) or run manually.',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to start companion service',
        message: error.message,
        instructions: 'Please start manually: cd companion && node src/index.js',
      });
    }
  });

  // Get queue
  app.get('/queue', (req, res) => {
    const since = Number(req.query.since || 0);

    console.log(`[QUEUE] Queue request: since=${since}, queue_length=${queue.length}`);

    const newItems = queue.filter((item) => item.seq > since);
    const newEntries = newItems.filter((item) => item.kind === 'entry').map((item) => item.payload);
    const newEvents = newItems.filter((item) => item.kind === 'event').map((item) => item.payload);

    console.log(
      `[QUEUE] Queue response: ${newEntries.length} entries, ${newEvents.length} events since seq ${since}`
    );

    // Use all available data for comprehensive analysis
    const limitedEntries = newEntries; // No limit - use all entries
    const limitedEvents = newEvents; // No limit - use all events

    // Use full content for comprehensive analysis
    const cleanedEntries = limitedEntries.map((entry) => ({
      ...entry,
      content: entry.content || '', // Use full content
      before_code: entry.before_code || '',
      after_code: entry.after_code || '',
    }));

    const cleanedEvents = limitedEvents.map((event) => ({
      ...event,
      details: event.details ? JSON.stringify(JSON.parse(event.details || '{}')) : '{}',
    }));

    res.json({
      entries: cleanedEntries,
      events: cleanedEvents,
      cursor: sequence,
    });
  });

  // Debug endpoint to check companion service data
  app.get('/api/debug', (req, res) => {
    res.json({
      status: 'companion service running',
      timestamp: new Date().toISOString(),
      database: {
        entries: db.entries.length,
        prompts: db.prompts.length,
        sampleEntry: db.entries[0] || null,
        samplePrompt: db.prompts[0] || null,
      },
      queue: {
        length: queue.length,
        sample: queue[0] || null,
      },
    });
  });

  // Access control status endpoint
  app.get('/api/access-control/status', (req, res) => {
    if (dataAccessControl) {
      res.json({
        success: true,
        ...dataAccessControl.getStatus(),
      });
    } else {
      res.json({
        success: true,
        enabled: false,
        message: 'Data access control not initialized',
      });
    }
  });

  // Diagnostic endpoint to check capture mechanisms
  // Note: This endpoint needs to be enhanced with proper dependency injection
  // For now, it provides basic diagnostics
  app.get('/api/diagnostic/capture-status', async (req, res) => {
    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        capture_mechanisms: {
          file_watcher: {
            status: 'checking',
            note: 'Check file watcher service status via /health endpoint',
          },
          prompt_sync: {
            status: 'checking',
            note: 'Prompt sync runs every 30s. Check logs for sync status.',
          },
          terminal_monitor: {
            status: 'checking',
            note: 'Check terminal monitor status via /health endpoint',
          },
          clipboard_monitor: {
            status: clipboardMonitor
              ? clipboardMonitor.isMonitoring
                ? 'active'
                : 'inactive'
              : 'not_initialized',
            enabled_in_config: clipboardMonitor?.isMonitoring || false,
          },
        },
        data_counts: {
          entries: db.entries.length,
          prompts: db.prompts.length,
          events: queue.filter((item) => item.kind === 'event').length,
          queue_length: queue.length,
          sequence: sequence,
        },
        recommendations: [],
      };

      // Add recommendations based on data counts
      if (diagnostics.data_counts.prompts === 0) {
        diagnostics.recommendations.push({
          type: 'warning',
          message:
            'No prompts found. Ensure Cursor database is accessible and prompt sync is running.',
          action: 'Check /api/cursor-database endpoint to verify Cursor DB access',
        });
      }

      if (diagnostics.data_counts.entries === 0) {
        diagnostics.recommendations.push({
          type: 'warning',
          message: 'No file changes captured. Ensure file watcher is running.',
          action: 'Check file watcher service status',
        });
      }

      res.json({
        success: true,
        diagnostics,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
      });
    }
  });
}

module.exports = createCoreRoutes;
