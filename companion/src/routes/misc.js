/**
 * Miscellaneous API routes - ack, search, config, privacy
 */

const { config: configUtil } = require('../utils/config.js');

function createMiscRoutes(deps) {
  const { app, queue, sequence, entries, events, lunrIndex, indexedDocs, privacyConfig, clipboardMonitor } =
    deps;

  // Acknowledge queue
  app.post('/ack', (req, res) => {
    const { cursor: ackCursor } = req.body;
    if (ackCursor) {
      const ackSeq = Number(ackCursor);
      // Only clean up items that are older than 1 hour AND have been acknowledged
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const beforeCount = queue.length;

      // Note: queue is passed by reference, so modifications will affect the original
      const filteredQueue = queue.filter((item) => {
        const itemAge = Date.now() - new Date(item.payload.timestamp).getTime();
        return item.seq > ackSeq || itemAge < oneHourAgo;
      });

      // Clear and repopulate queue
      queue.length = 0;
      queue.push(...filteredQueue);

      // Update the legacy arrays for backward compatibility
      entries.length = 0;
      entries.push(...queue.filter((item) => item.kind === 'entry').map((item) => item.payload));
      events.length = 0;
      events.push(...queue.filter((item) => item.kind === 'event').map((item) => item.payload));

      const afterCount = queue.length;
      console.log(
        ` Queue acknowledged up to seq ${ackSeq}. Cleaned up ${beforeCount - afterCount} old items. Remaining: ${queue.length} items`
      );
    }
    res.json({ status: 'acknowledged', cursor: ackCursor });
  });

  // FTS Search Endpoint
  app.get('/search/fts', (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: 'Query parameter "q" is required.' });
      }

      if (!lunrIndex) {
        return res.status(503).json({ success: false, error: 'Lunr index not initialized.' });
      }

      const results = lunrIndex.search(query);
      const hydratedResults = results.map((result) => {
        // Retrieve original document from indexedDocs based on ref (id)
        const originalDoc = indexedDocs.find((doc) => doc.id === result.ref);
        return { ...originalDoc, score: result.score };
      });

      res.json({ success: true, query, results: hydratedResults });
    } catch (error) {
      console.error('Error during FTS search:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get configuration
  app.get('/config', (req, res) => {
    res.json(configUtil.get());
  });

  // Get configuration (API endpoint)
  app.get('/api/config', (req, res) => {
    res.json({ success: true, config: configUtil.get() });
  });

  // Update configuration
  app.post('/config', (req, res) => {
    const updated = configUtil.update(req.body);
    res.json({ status: 'updated', config: updated });
  });

  // Update configuration (API endpoint with validation)
  app.put('/api/config', async (req, res) => {
    try {
      const updates = req.body;
      const updated = configUtil.update(updates);
      console.log('[CONFIG] Configuration updated:', Object.keys(updates).join(', '));
      
      // Dynamically start/stop clipboard monitor if enable_clipboard changed
      if (updates.enable_clipboard !== undefined && deps.clipboardMonitor) {
        if (updates.enable_clipboard) {
          deps.clipboardMonitor.start();
          console.log('[CONFIG] Clipboard monitor started');
        } else {
          deps.clipboardMonitor.stop();
          console.log('[CONFIG] Clipboard monitor stopped');
        }
      }
      
      // Note: MCP endpoints require service restart as they're checked on route registration
      res.json({ 
        success: true, 
        config: updated,
        requiresRestart: updates.enable_mcp !== undefined
      });
    } catch (error) {
      console.error('[CONFIG] Failed to update configuration:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Privacy API endpoints
  app.get('/privacy/config', (req, res) => {
    res.json(privacyConfig);
  });

  app.post('/privacy/config', (req, res) => {
    Object.assign(privacyConfig, req.body);
    console.log(' Privacy config updated:', privacyConfig);
    res.json({ status: 'updated', privacyConfig });
  });

  app.post('/privacy/consent', (req, res) => {
    const { consent } = req.body;
    privacyConfig.consentGiven = consent;
    privacyConfig.enabled = consent;
    console.log(' Privacy consent updated:', consent);
    res.json({ status: 'updated', consentGiven: consent });
  });

  app.get('/privacy/status', (req, res) => {
    res.json({
      enabled: privacyConfig.enabled,
      consentGiven: privacyConfig.consentGiven,
      sensitivityLevel: privacyConfig.sensitivityLevel,
      redactionLevel: privacyConfig.redactionLevel,
    });
  });

  // Data deletion endpoints
  app.delete('/privacy/delete-session/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    try {
      // Remove from in-memory storage
      const sessionIndex = entries.findIndex((entry) => entry.sessionId === sessionId);
      if (sessionIndex >= 0) {
        entries.splice(sessionIndex, 1);
      }

      const eventIndex = events.findIndex((event) => event.sessionId === sessionId);
      if (eventIndex >= 0) {
        events.splice(eventIndex, 1);
      }

      // Remove from queue
      const queueIndex = queue.findIndex((item) => item.payload.sessionId === sessionId);
      if (queueIndex >= 0) {
        queue.splice(queueIndex, 1);
      }

      console.log(` Deleted session ${sessionId} from companion service`);
      res.json({ success: true, message: `Session ${sessionId} deleted` });
    } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/privacy/delete-all', (req, res) => {
    try {
      // Clear all in-memory storage
      entries.length = 0;
      events.length = 0;
      queue.length = 0;
      // Note: sequence reset should be handled by the caller if needed

      console.log(' Deleted all data from companion service');
      res.json({ success: true, message: 'All data deleted' });
    } catch (error) {
      console.error('Error deleting all data:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/privacy/delete-sensitive', (req, res) => {
    const { patterns } = req.body;

    try {
      let deletedCount = 0;

      // Delete entries matching sensitive patterns
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        const content = entry.content || entry.data || '';

        if (
          patterns.some((pattern) => {
            const regex = new RegExp(pattern, 'gi');
            return regex.test(content);
          })
        ) {
          entries.splice(i, 1);
          deletedCount++;
        }
      }

      // Delete events matching sensitive patterns
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        const content = event.content || event.data || '';

        if (
          patterns.some((pattern) => {
            const regex = new RegExp(pattern, 'gi');
            return regex.test(content);
          })
        ) {
          events.splice(i, 1);
          deletedCount++;
        }
      }

      // Delete queue items matching sensitive patterns
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i];
        const content = item.payload.content || item.payload.data || '';

        if (
          patterns.some((pattern) => {
            const regex = new RegExp(pattern, 'gi');
            return regex.test(content);
          })
        ) {
          queue.splice(i, 1);
          deletedCount++;
        }
      }

      console.log(` Deleted ${deletedCount} items matching sensitive patterns`);
      res.json({ success: true, deletedCount });
    } catch (error) {
      console.error('Error deleting sensitive data:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createMiscRoutes;
