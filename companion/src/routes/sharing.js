/**
 * Sharing API routes
 * Handles workspace sharing via shareable links
 * Supports both account-based and anonymous sharing
 */

function createSharingRoutes(deps) {
  const {
    app,
    sharingService,
    persistentDB,
    accountService = null,
    huggingFaceUploadService = null,
    automaticHfSyncService = null,
    automaticMiningScheduler = null,
  } = deps;

  /**
   * Helper to get account from request (if authenticated)
   * Returns account object with account_id field
   */
  async function getAccountFromRequest() {
    if (!accountService) return null;
    try {
      const account = await accountService.getAccount();
      // Ensure account has account_id field
      if (account && account.account_id) {
        return account;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a shareable link for workspace data
   * POST /api/share/create
   * Supports both authenticated (account-linked) and anonymous sharing
   */
  app.post('/api/share/create', async (req, res) => {
    try {
      const {
        workspaces = [],
        rung = 'clio',
        traceTypes = ['prompt', 'code', 'interaction'],
        filters = {},
        expirationDays = 7,
        name = null,
      } = req.body;

      // If no workspaces specified, get all available workspaces
      let finalWorkspaces = workspaces;
      if (!workspaces || workspaces.length === 0) {
        try {
          const allWorkspaces = await persistentDB.getWorkspaces();
          finalWorkspaces = allWorkspaces.map((ws) => ws.path || ws.id);
          if (finalWorkspaces.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'No workspaces found to share. Please record some activity first.',
            });
          }
        } catch (err) {
          console.warn('[SHARING] Could not get workspaces, using empty list:', err.message);
          finalWorkspaces = ['*']; // Use wildcard to indicate all workspaces
        }
      }

      // Validate rung
      const validRungs = ['clio', 'module_graph', 'functions', 'semantic_edits', 'tokens'];
      if (rung && !validRungs.includes(rung)) {
        return res.status(400).json({
          success: false,
          error: `Invalid rung. Must be one of: ${validRungs.join(', ')}`,
        });
      }

      // Get account info if available (optional - supports anonymous sharing)
      const account = await getAccountFromRequest();
      const accountId = account?.account_id || null;
      const deviceId = account && accountService ? accountService.deviceId : null;

      const shareLink = await sharingService.createShareLink({
        workspaces: finalWorkspaces,
        rung,
        traceTypes,
        filters,
        expirationDays,
        name,
        account_id: accountId,
        device_id: deviceId,
      });

      res.json({
        success: true,
        ...shareLink,
        account_linked: accountId !== null,
      });
    } catch (error) {
      console.error('[SHARING] Error creating share link:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get workspace data via share link
   * GET /api/share/:shareId
   */
  app.get('/api/share/:shareId', async (req, res) => {
    try {
      const { shareId } = req.params;

      const shareData = await sharingService.getShareLink(shareId);

      if (!shareData) {
        return res.status(404).json({
          success: false,
          error: 'Share link not found or expired',
        });
      }

      // Use the export functionality to generate the data
      // Use the /api/export/data endpoint which supports rungs
      const exportUrl = new URL(`${req.protocol}://${req.get('host')}/api/export/data`);

      // Add workspace filters
      shareData.workspaces.forEach((ws) => {
        exportUrl.searchParams.append('workspace', ws);
      });

      // Add rung
      if (shareData.rung) {
        exportUrl.searchParams.set('rung', shareData.rung);
      }

      // Add trace type filters if specified
      if (shareData.traceTypes && Array.isArray(shareData.traceTypes)) {
        shareData.traceTypes.forEach((type) => {
          exportUrl.searchParams.append('traceType', type);
        });
      }

      // Add other filters
      if (shareData.filters.dateFrom) {
        exportUrl.searchParams.set('since', shareData.filters.dateFrom);
      }
      if (shareData.filters.dateTo) {
        exportUrl.searchParams.set('until', shareData.filters.dateTo);
      }
      if (shareData.filters.limit) {
        exportUrl.searchParams.set('limit', shareData.filters.limit.toString());
      }

      // Make internal request to export endpoint
      const http = require('http');
      const exportPath = exportUrl.pathname + exportUrl.search;

      return new Promise((resolve, reject) => {
        const options = {
          hostname: req.get('host').split(':')[0],
          port: req.get('host').split(':')[1] || 43917,
          path: exportPath,
          method: 'GET',
          headers: {
            Host: req.get('host'),
          },
        };

        const exportReq = http.request(options, (exportRes) => {
          let data = '';
          exportRes.on('data', (chunk) => {
            data += chunk;
          });
          exportRes.on('end', () => {
            try {
              const exportData = JSON.parse(data);
              res.json(exportData);
            } catch (err) {
              res.status(500).json({
                success: false,
                error: 'Failed to parse export data',
              });
            }
          });
        });

        exportReq.on('error', (err) => {
          res.status(500).json({
            success: false,
            error: 'Failed to fetch shared data',
          });
        });

        exportReq.end();
      });
    } catch (error) {
      console.error('[SHARING] Error getting share link:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get share link metadata (without exporting data)
   * GET /api/share/:shareId/info
   */
  app.get('/api/share/:shareId/info', async (req, res) => {
    try {
      const { shareId } = req.params;

      const shareData = await sharingService.getShareLink(shareId);

      if (!shareData) {
        return res.status(404).json({
          success: false,
          error: 'Share link not found or expired',
        });
      }

      // Return metadata only (no access count update)
      res.json({
        success: true,
        shareId: shareData.id || shareData.shareId,
        name: shareData.name || null,
        workspaces: shareData.workspaces,
        rung: shareData.rung || null,
        traceTypes: shareData.traceTypes || ['prompt', 'code', 'interaction'],
        createdAt: new Date(shareData.createdAt).toISOString(),
        expiresAt: shareData.expiresAt ? new Date(shareData.expiresAt).toISOString() : null,
        isExpired: shareData.expiresAt ? Date.now() > shareData.expiresAt : false,
      });
    } catch (error) {
      console.error('[SHARING] Error getting share link info:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Delete a share link
   * DELETE /api/share/:shareId
   * Requires ownership if share link is account-linked
   */
  app.delete('/api/share/:shareId', async (req, res) => {
    try {
      const { shareId } = req.params;

      // Get account info for authorization check
      const account = await getAccountFromRequest();
      const accountId = account?.account_id || null;

      await sharingService.deleteShareLink(shareId, accountId);

      res.json({
        success: true,
        message: 'Share link deleted',
      });
    } catch (error) {
      console.error('[SHARING] Error deleting share link:', error);
      const statusCode = error.message.includes('Unauthorized') ? 403 : 500;
      res.status(statusCode).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * List all share links (for management)
   * GET /api/share
   * If authenticated, only returns links for the current account
   * If not authenticated, returns all links (for backward compatibility)
   */
  app.get('/api/share', async (req, res) => {
    try {
      // Get account info - filter by account if authenticated
      const account = await getAccountFromRequest();
      const accountId = account?.account_id || null;

      const links = await sharingService.listShareLinks(accountId);

      res.json({
        success: true,
        account_filtered: accountId !== null,
        links: links.map((link) => ({
          shareId: link.id || link.shareId,
          name: link.name || null,
          workspaces: link.workspaces,
          rung: link.rung || null,
          abstractionLevel: link.abstractionLevel, // Legacy
          account_linked: link.account_id !== null,
          createdAt: new Date(link.createdAt).toISOString(),
          expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString() : null,
          accessCount: link.accessCount || 0,
          lastAccessed: link.lastAccessed ? new Date(link.lastAccessed).toISOString() : null,
          isExpired: link.expiresAt ? Date.now() > link.expiresAt : false,
        })),
      });
    } catch (error) {
      console.error('[SHARING] Error listing share links:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Estimate storage size for different privacy rungs
   * POST /api/share/estimate-size
   * Body: { workspaces: [], traceTypes: [], dateRange: {} }
   */
  app.post('/api/share/estimate-size', async (req, res) => {
    try {
      const {
        workspaces = [],
        traceTypes = ['prompt', 'code', 'interaction'],
        dateRange = {},
        rungs = ['clio', 'module_graph', 'functions', 'semantic_edits', 'tokens'],
      } = req.body;

      if (!persistentDB) {
        return res.status(500).json({
          success: false,
          error: 'Database not available',
        });
      }

      await persistentDB.init();

      // Get data counts for selected workspaces
      const workspaceFilter =
        workspaces.length > 0
          ? `WHERE workspace_path IN (${workspaces.map(() => '?').join(',')})`
          : '';
      const workspaceParams = workspaces.length > 0 ? workspaces : [];

      // Date range filter
      let dateFilter = '';
      const dateParams = [];
      if (dateRange.since) {
        dateFilter += workspaceFilter ? ' AND' : ' WHERE';
        dateFilter += ' timestamp >= ?';
        dateParams.push(new Date(dateRange.since).getTime());
      }
      if (dateRange.until) {
        dateFilter += workspaceFilter || dateFilter ? ' AND' : ' WHERE';
        dateFilter += ' timestamp <= ?';
        dateParams.push(new Date(dateRange.until).getTime());
      }

      // Get entry counts
      const entryCount = await new Promise((resolve, reject) => {
        persistentDB.db.get(
          `SELECT COUNT(*) as count FROM entries ${workspaceFilter}${dateFilter}`,
          [...workspaceParams, ...dateParams],
          (err, row) => (err ? reject(err) : resolve(row?.count || 0))
        );
      });

      // Get prompt counts (prompts table uses workspace_path, not workspace_id)
      const promptWorkspaceFilter =
        workspaces.length > 0
          ? `WHERE workspace_path IN (${workspaces.map(() => '?').join(',')})`
          : '';

      // Build date filter for prompts (same structure as entries)
      let promptDateFilter = '';
      const promptDateParams = [];
      if (dateRange.since) {
        promptDateFilter += promptWorkspaceFilter ? ' AND' : ' WHERE';
        promptDateFilter += ' timestamp >= ?';
        promptDateParams.push(new Date(dateRange.since).getTime());
      }
      if (dateRange.until) {
        promptDateFilter += promptWorkspaceFilter || promptDateFilter ? ' AND' : ' WHERE';
        promptDateFilter += ' timestamp <= ?';
        promptDateParams.push(new Date(dateRange.until).getTime());
      }

      const promptCount = await new Promise((resolve, reject) => {
        persistentDB.db.get(
          `SELECT COUNT(*) as count FROM prompts ${promptWorkspaceFilter}${promptDateFilter}`,
          [...workspaceParams, ...promptDateParams],
          (err, row) => {
            if (err) {
              console.error('[SHARING] Error querying prompts count:', err);
              resolve(0);
            } else {
              resolve(row?.count || 0);
            }
          }
        );
      });

      // Get event counts
      const eventCount = await new Promise((resolve, reject) => {
        persistentDB.db.get(
          `SELECT COUNT(*) as count FROM events ${workspaceFilter}${dateFilter}`,
          [...workspaceParams, ...dateParams],
          (err, row) => (err ? reject(err) : resolve(row?.count || 0))
        );
      });

      // Calculate export sizes using detailed formulas from documentation
      // Based on compression ratios and entry counts per rung
      const sizeEstimates = {};

      // Get file count (approximate from entries or use a default ratio)
      const fileCount = Math.max(1, Math.floor(entryCount / 20)); // Rough estimate: ~20 entries per file

      // Total raw entries
      const totalRawEntries = entryCount + promptCount + eventCount;

      rungs.forEach((rung) => {
        let entries, avgEntrySizeKB, compression;

        switch (rung) {
          case 'tokens':
            // All entries with PII redaction only, ~27 KB per entry avg, 2:1 compression
            entries = totalRawEntries;
            avgEntrySizeKB = 27;
            compression = 2;
            break;

          case 'semantic_edits':
            // Only code edits, ~4 KB per entry avg, 20:1 compression
            entries = entryCount;
            avgEntrySizeKB = 4;
            compression = 20;
            break;

          case 'functions':
            // ~37.5% of code edits as unique functions, ~1.3 KB per entry avg, 50:1 compression
            entries = Math.max(1, Math.floor(entryCount * 0.375));
            avgEntrySizeKB = 1.3;
            compression = 50;
            break;

          case 'module_graph':
            // ~5 edges per file, ~3 KB per entry avg, 100:1 compression
            entries = Math.max(1, fileCount * 5);
            avgEntrySizeKB = 3;
            compression = 100;
            break;

          case 'clio':
            // Max(15, total_raw_entries // 500), ~50 KB per entry avg, 500:1 compression
            entries = Math.max(15, Math.floor(totalRawEntries / 500));
            avgEntrySizeKB = 50;
            compression = 500;
            break;

          default:
            entries = totalRawEntries;
            avgEntrySizeKB = 27;
            compression = 1;
        }

        const sizeKB = entries * avgEntrySizeKB;
        const sizeMB = sizeKB / 1024;
        const originalSizeMB = sizeMB * compression;

        sizeEstimates[rung] = {
          sizeKB: Math.round(sizeKB),
          sizeMB: sizeMB.toFixed(2),
          entries: entries,
          prompts:
            rung === 'tokens'
              ? promptCount
              : rung === 'clio'
                ? 0
                : Math.floor(promptCount / compression),
          events:
            rung === 'tokens'
              ? eventCount
              : rung === 'clio'
                ? 0
                : Math.floor(eventCount / compression),
          compression: `${compression}:1`,
          originalSizeMB: originalSizeMB.toFixed(2),
        };
      });

      res.json({
        success: true,
        estimates: sizeEstimates,
        totals: {
          entries: entryCount,
          prompts: promptCount,
          events: eventCount,
        },
      });
    } catch (error) {
      console.error('[SHARING] Error estimating size:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get trace type statistics
   * POST /api/share/trace-stats
   * Body: { workspaces: [], dateRange: {} }
   */
  app.post('/api/share/trace-stats', async (req, res) => {
    try {
      const { workspaces = [], dateRange = {} } = req.body;

      if (!persistentDB) {
        return res.status(500).json({
          success: false,
          error: 'Database not available',
        });
      }

      await persistentDB.init();

      const workspaceFilter =
        workspaces.length > 0
          ? `WHERE workspace_path IN (${workspaces.map(() => '?').join(',')})`
          : '';
      const workspaceParams = workspaces.length > 0 ? workspaces : [];

      let dateFilter = '';
      const dateParams = [];
      if (dateRange.since) {
        dateFilter += workspaceFilter ? ' AND' : ' WHERE';
        dateFilter += ' timestamp >= ?';
        dateParams.push(new Date(dateRange.since).getTime());
      }
      if (dateRange.until) {
        dateFilter += workspaceFilter || dateFilter ? ' AND' : ' WHERE';
        dateFilter += ' timestamp <= ?';
        dateParams.push(new Date(dateRange.until).getTime());
      }

      // Count prompts (Prompt Traces)
      // Check if message_role column exists, otherwise use source as fallback
      let promptQuery = `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN COALESCE(message_role, '') = 'user' THEN 1 ELSE 0 END) as human,
        SUM(CASE WHEN COALESCE(message_role, '') IN ('assistant', 'system') THEN 1 ELSE 0 END) as ai
      FROM prompts`;
      let promptParams = [];

      // Build date filter for prompts (using timestamp column)
      const promptDateFilters = [];
      if (dateRange.since) {
        promptDateFilters.push('timestamp >= ?');
        promptParams.push(new Date(dateRange.since).getTime());
      }
      if (dateRange.until) {
        promptDateFilters.push('timestamp <= ?');
        promptParams.push(new Date(dateRange.until).getTime());
      }

      // Add workspace filter if provided
      if (workspaces.length > 0) {
        promptDateFilters.push(`workspace_path IN (${workspaces.map(() => '?').join(',')})`);
        promptParams.push(...workspaces);
      }

      if (promptDateFilters.length > 0) {
        promptQuery += ' WHERE ' + promptDateFilters.join(' AND ');
      }

      const promptStats = await new Promise((resolve, reject) => {
        persistentDB.db.get(promptQuery, promptParams, (err, row) => {
          if (err) {
            console.error('[SHARING] Error querying prompts:', err);
            // Return zeros if query fails (e.g., column doesn't exist)
            resolve({ total: 0, human: 0, ai: 0 });
          } else {
            resolve(row || { total: 0, human: 0, ai: 0 });
          }
        });
      });

      // Count entries with code changes (Code Traces)
      const codeStats = await new Promise((resolve, reject) => {
        persistentDB.db.all(
          `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN before_code IS NOT NULL OR after_code IS NOT NULL THEN 1 ELSE 0 END) as withCode
          FROM entries ${workspaceFilter}${dateFilter}`,
          [...workspaceParams, ...dateParams],
          (err, rows) => {
            if (err) {
              console.error('[SHARING] Error querying entries:', err);
              resolve({ total: 0, withCode: 0 });
            } else {
              resolve(rows[0] || { total: 0, withCode: 0 });
            }
          }
        );
      });

      // Count events (Interaction Traces)
      const interactionStats = await new Promise((resolve, reject) => {
        persistentDB.db.all(
          `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN type = 'file_change' THEN 1 ELSE 0 END) as fileChanges,
            SUM(CASE WHEN type = 'terminal_command' THEN 1 ELSE 0 END) as terminalCommands,
            SUM(CASE WHEN type = 'cursor_activity' THEN 1 ELSE 0 END) as cursorActivity
          FROM events ${workspaceFilter}${dateFilter}`,
          [...workspaceParams, ...dateParams],
          (err, rows) => {
            if (err) reject(err);
            else
              resolve(
                rows[0] || { total: 0, fileChanges: 0, terminalCommands: 0, cursorActivity: 0 }
              );
          }
        );
      });

      res.json({
        success: true,
        traceTypes: {
          prompt: {
            total: promptStats.total || 0,
            human: promptStats.human || 0,
            ai: promptStats.ai || 0,
          },
          code: {
            total: codeStats.total || 0,
            withCode: codeStats.withCode || 0,
          },
          interaction: {
            total: interactionStats.total || 0,
            fileChanges: interactionStats.fileChanges || 0,
            terminalCommands: interactionStats.terminalCommands || 0,
            cursorActivity: interactionStats.cursorActivity || 0,
          },
        },
      });
    } catch (error) {
      console.error('[SHARING] Error getting trace stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get preview data (head equivalent)
   * POST /api/share/preview
   * Body: { workspaces: [], rung: string, limit: number, traceTypes: [] }
   */
  app.post('/api/share/preview', async (req, res) => {
    try {
      const {
        workspaces = [],
        rung = 'clio',
        limit = 10,
        traceTypes = ['prompt', 'code', 'interaction'],
        dateRange = {},
      } = req.body;

      if (!persistentDB) {
        return res.status(500).json({
          success: false,
          error: 'Database not available',
        });
      }

      await persistentDB.init();

      const preview = {
        entries: [],
        prompts: [],
        events: [],
      };

      const workspaceFilter =
        workspaces.length > 0
          ? `WHERE workspace_path IN (${workspaces.map(() => '?').join(',')})`
          : '';
      const workspaceParams = workspaces.length > 0 ? workspaces : [];

      let dateFilter = '';
      const dateParams = [];
      if (dateRange.since) {
        dateFilter += workspaceFilter ? ' AND' : ' WHERE';
        dateFilter += ' timestamp >= ?';
        dateParams.push(new Date(dateRange.since).getTime());
      }
      if (dateRange.until) {
        dateFilter += workspaceFilter || dateFilter ? ' AND' : ' WHERE';
        dateFilter += ' timestamp <= ?';
        dateParams.push(new Date(dateRange.until).getTime());
      }

      // Get sample entries
      if (traceTypes.includes('code')) {
        const entries = await new Promise((resolve, reject) => {
          persistentDB.db.all(
            `SELECT * FROM entries ${workspaceFilter}${dateFilter} ORDER BY timestamp DESC LIMIT ?`,
            [...workspaceParams, ...dateParams, limit],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });
        preview.entries = entries.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          workspace_path: e.workspace_path,
          file_path: e.file_path,
          change_type: e.change_type,
          before_content: e.before_content ? e.before_content.substring(0, 200) : null,
          after_content: e.after_content ? e.after_content.substring(0, 200) : null,
        }));
      }

      // Get sample prompts
      if (traceTypes.includes('prompt')) {
        let promptQuery = 'SELECT * FROM prompts';
        let promptParams = [];
        let promptWhere = [];

        if (dateRange.since) {
          promptWhere.push('timestamp >= ?');
          promptParams.push(new Date(dateRange.since).toISOString());
        }
        if (dateRange.until) {
          promptWhere.push('timestamp <= ?');
          promptParams.push(new Date(dateRange.until).toISOString());
        }

        if (promptWhere.length > 0) {
          promptQuery += ' WHERE ' + promptWhere.join(' AND');
        }
        promptQuery += ' ORDER BY timestamp DESC LIMIT ?';
        promptParams.push(limit);

        const prompts = await new Promise((resolve, reject) => {
          persistentDB.db.all(promptQuery, promptParams, (err, rows) =>
            err ? reject(err) : resolve(rows || [])
          );
        });
        preview.prompts = prompts.map((p) => ({
          id: p.id,
          timestamp: p.timestamp,
          workspace_id: p.workspace_id,
          role: p.message_role || p.role,
          content: p.text ? p.text.substring(0, 300) : null,
        }));
      }

      // Get sample events
      if (traceTypes.includes('interaction')) {
        const events = await new Promise((resolve, reject) => {
          persistentDB.db.all(
            `SELECT * FROM events ${workspaceFilter}${dateFilter} ORDER BY timestamp DESC LIMIT ?`,
            [...workspaceParams, ...dateParams, limit],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });
        preview.events = events.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          workspace_path: e.workspace_path,
          type: e.type,
          data: e.data ? JSON.parse(e.data) : null,
        }));
      }

      res.json({
        success: true,
        preview,
      });
    } catch (error) {
      console.error('[SHARING] Error getting preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Create share link and optionally upload to Hugging Face
   * POST /api/share/create-with-hf
   * Body: { ...shareOptions, hfSessionId?: string, hfRepoName?: string, uploadToHF?: boolean }
   */
  if (huggingFaceUploadService) {
    app.post('/api/share/create-with-hf', async (req, res) => {
      try {
        const {
          workspaces = [],
          rung = 'clio',
          traceTypes = ['prompt', 'code', 'interaction'],
          filters = {},
          expirationDays = 7,
          name = null,
          hfSessionId = null,
          hfRepoName = null,
          uploadToHF = false,
        } = req.body;

        if (!workspaces || workspaces.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'At least one workspace must be specified',
          });
        }

        // Validate rung
        const validRungs = ['clio', 'module_graph', 'functions', 'semantic_edits', 'tokens'];
        if (rung && !validRungs.includes(rung)) {
          return res.status(400).json({
            success: false,
            error: `Invalid rung. Must be one of: ${validRungs.join(', ')}`,
          });
        }

        // Get account info if available
        const account = await getAccountFromRequest();
        const accountId = account?.account_id || null;
        const deviceId = account && accountService ? accountService.deviceId : null;

        // Create share link
        const shareLink = await sharingService.createShareLink({
          workspaces,
          rung,
          traceTypes,
          filters,
          expirationDays,
          name,
          account_id: accountId,
          device_id: deviceId,
        });

        const result = {
          success: true,
          shareLink: {
            shareId: shareLink.id || shareLink.shareId,
            shareUrl: `/api/share/${shareLink.id || shareLink.shareId}`,
            name: shareLink.name || null,
            workspaces: shareLink.workspaces,
            rung: shareLink.rung || null,
            createdAt: new Date(shareLink.createdAt).toISOString(),
            expiresAt: shareLink.expiresAt ? new Date(shareLink.expiresAt).toISOString() : null,
          },
          hfUpload: null,
        };

        // Optionally upload to Hugging Face
        if (uploadToHF && hfSessionId && hfRepoName) {
          try {
            // Export data first (using HuggingFaceExporter)
            const HuggingFaceExporter = require('../services/huggingface-exporter.js');
            const path = require('path');
            const outputDir = path.join(__dirname, '../../data', `hf-export-${Date.now()}`);

            const exporter = new HuggingFaceExporter(persistentDB, {
              privacyLevel: rung,
              includeCode: ['tokens', 'semantic_edits', 'functions'].includes(rung),
              includePrompts: true,
              anonymize: true,
              maxSamples: 10000,
            });

            const exportResult = await exporter.exportToHuggingFaceFormat(outputDir);

            // Upload to HF
            const uploadResult = await huggingFaceUploadService.uploadDataset(
              hfSessionId,
              hfRepoName,
              exportResult.outputDir,
              { private: false }
            );

            result.hfUpload = {
              success: true,
              repoName: hfRepoName,
              repoUrl: uploadResult.repoUrl,
              filesUploaded: uploadResult.filesUploaded,
            };
          } catch (hfError) {
            console.error('[SHARING] HF upload error:', hfError);
            result.hfUpload = {
              success: false,
              error: hfError.message,
            };
          }
        }

        res.json(result);
      } catch (error) {
        console.error('[SHARING] Create share with HF error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });
  }

  /**
   * Get automation status (all automated services)
   * GET /api/automation/status
   * Optimized: Parallel queries with caching and timeout
   */
  let automationStatusCache = null;
  let automationStatusCacheTime = 0;
  const AUTOMATION_CACHE_TTL = 5000; // 5 second cache for database stats

  app.get('/api/automation/status', async (req, res) => {
    // Set response timeout
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout - database queries taking too long',
        });
      }
    }, 10000); // 10 second max

    try {
      const status = {
        success: true,
        timestamp: Date.now(),
        services: {},
      };

      // HF Auto-Sync Status (fast, in-memory)
      if (automaticHfSyncService) {
        status.services.hfSync = automaticHfSyncService.getStatus();
      } else {
        status.services.hfSync = {
          enabled: false,
          initialized: false,
          error: 'Service not available',
        };
      }

      // Mining Scheduler Status (fast, in-memory)
      if (automaticMiningScheduler) {
        status.services.mining = automaticMiningScheduler.getStatus();
      } else {
        status.services.mining = {
          enabled: false,
          initialized: false,
          error: 'Service not available',
        };
      }

      // Data Capture Status - use cache if available
      const now = Date.now();
      if (automationStatusCache && now - automationStatusCacheTime < AUTOMATION_CACHE_TTL) {
        status.services.dataCapture = automationStatusCache;
      } else {
        // Run database queries in parallel with timeout
        try {
          await persistentDB.init();

          const oneHourAgo = Date.now() - 60 * 60 * 1000;

          // Parallel queries with Promise.all for faster response
          const [entryCount, promptCount, workspaceCount, recentEntries, recentPrompts] =
            await Promise.all([
              new Promise((resolve) => {
                persistentDB.db.get('SELECT COUNT(*) as count FROM entries', [], (err, row) => {
                  resolve(err ? 0 : row?.count || 0);
                });
              }),
              new Promise((resolve) => {
                persistentDB.db.get(
                  'SELECT COUNT(*) as count FROM conversation_turns',
                  [],
                  (err, row) => {
                    resolve(err ? 0 : row?.count || 0);
                  }
                );
              }),
              new Promise((resolve) => {
                persistentDB.db.get(
                  'SELECT COUNT(DISTINCT workspace_path) as count FROM entries WHERE workspace_path IS NOT NULL',
                  [],
                  (err, row) => {
                    resolve(err ? 0 : row?.count || 0);
                  }
                );
              }),
              new Promise((resolve) => {
                persistentDB.db.get(
                  'SELECT COUNT(*) as count FROM entries WHERE CAST(timestamp AS INTEGER) > ?',
                  [oneHourAgo],
                  (err, row) => {
                    resolve(err ? 0 : row?.count || 0);
                  }
                );
              }),
              new Promise((resolve) => {
                persistentDB.db.get(
                  'SELECT COUNT(*) as count FROM conversation_turns WHERE CAST(created_at AS INTEGER) > ?',
                  [oneHourAgo],
                  (err, row) => {
                    resolve(err ? 0 : row?.count || 0);
                  }
                );
              }),
            ]);

          const dataCapture = {
            enabled: true,
            totalEntries: entryCount,
            totalPrompts: promptCount,
            activeWorkspaces: workspaceCount,
            eventsLastHour: recentEntries + recentPrompts,
            eventsPerMinute: Math.round((recentEntries + recentPrompts) / 60),
          };

          // Cache the result
          automationStatusCache = dataCapture;
          automationStatusCacheTime = now;
          status.services.dataCapture = dataCapture;
        } catch (error) {
          console.error('[SHARING] Error getting data capture status:', error);
          status.services.dataCapture = { enabled: false, error: error.message };
        }
      }

      clearTimeout(timeout);
      res.json(status);
    } catch (error) {
      clearTimeout(timeout);
      console.error('[SHARING] Error getting automation status:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get activity stream (recent events)
   * GET /api/activity/stream?limit=50&since=timestamp
   */
  app.get('/api/activity/stream', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const since = req.query.since ? parseInt(req.query.since) : Date.now() - 24 * 60 * 60 * 1000; // Default: last 24 hours

      const activities = [];

      await persistentDB.init();

      // Get recent entries
      try {
        const entries = await new Promise((resolve, reject) => {
          persistentDB.db.all(
            `SELECT 
              timestamp,
              'entry' as type,
              'file_change' as subtype,
              file_path as description,
              workspace_path as workspace,
              type as change_type
            FROM entries 
            WHERE CAST(timestamp AS INTEGER) > ? 
            ORDER BY CAST(timestamp AS INTEGER) DESC 
            LIMIT ?`,
            [since, limit],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });
        entries.forEach((e) => {
          activities.push({
            timestamp: parseInt(e.timestamp) || e.timestamp,
            type: e.type,
            subtype: e.subtype,
            description: e.description || 'File change',
            workspace: e.workspace,
            metadata: { changeType: e.change_type },
          });
        });
      } catch (error) {
        console.error('[SHARING] Error getting entries:', error);
      }

      // Get recent prompts (join with conversations to get workspace_path)
      try {
        const prompts = await new Promise((resolve, reject) => {
          persistentDB.db.all(
            `SELECT 
              ct.created_at as timestamp,
              'prompt' as type,
              CASE 
                WHEN ct.role = 'user' THEN 'human_prompt'
                WHEN ct.role = 'assistant' THEN 'ai_response'
                ELSE 'prompt'
              END as subtype,
              SUBSTR(ct.content, 1, 100) as description,
              c.workspace_path as workspace,
              ct.role as metadata
            FROM conversation_turns ct
            LEFT JOIN conversations c ON ct.conversation_id = c.id
            WHERE CAST(ct.created_at AS INTEGER) > ? 
            ORDER BY CAST(ct.created_at AS INTEGER) DESC 
            LIMIT ?`,
            [since, limit],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });
        prompts.forEach((p) => {
          activities.push({
            timestamp: parseInt(p.timestamp) || p.timestamp,
            type: p.type,
            subtype: p.subtype,
            description: p.description || 'AI interaction',
            workspace: p.workspace,
            metadata: { role: p.metadata },
          });
        });
      } catch (error) {
        console.error('[SHARING] Error getting prompts:', error);
      }

      // Get mining runs
      try {
        const miningRuns = await new Promise((resolve, reject) => {
          persistentDB.db.all(
            `SELECT 
              started_at as timestamp,
              'mining' as type,
              CASE 
                WHEN status = 'completed' THEN 'mining_completed'
                WHEN status = 'in_progress' THEN 'mining_started'
                ELSE 'mining'
              END as subtype,
              workspace_path as description,
              workspace_path as workspace,
              status as metadata
            FROM mining_runs 
            WHERE CAST(started_at AS INTEGER) > ? 
            ORDER BY CAST(started_at AS INTEGER) DESC 
            LIMIT ?`,
            [since, Math.min(limit, 20)],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });
        miningRuns.forEach((m) => {
          activities.push({
            timestamp: parseInt(m.timestamp) || m.timestamp,
            type: m.type,
            subtype: m.subtype,
            description: `Mining ${m.description || 'workspace'}`,
            workspace: m.workspace,
            metadata: { status: m.metadata },
          });
        });
      } catch (error) {
        // mining_runs table might not exist, ignore
        console.warn('[SHARING] Could not get mining runs (table may not exist):', error.message);
      }

      // Sort by timestamp descending
      activities.sort((a, b) => b.timestamp - a.timestamp);
      activities.splice(limit); // Limit total results

      res.json({
        success: true,
        activities,
        count: activities.length,
        since,
        limit,
      });
    } catch (error) {
      console.error('[SHARING] Error getting activity stream:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get sample of captured data for transparency
   * GET /api/share/data-sample?type=prompt|code|interaction&limit=5
   */
  app.get('/api/share/data-sample', async (req, res) => {
    try {
      const type = req.query.type || 'all';
      const limit = parseInt(req.query.limit) || 5;

      await persistentDB.init();

      const samples = {};

      if (type === 'all' || type === 'prompt') {
        try {
          const prompts = await new Promise((resolve, reject) => {
            persistentDB.db.all(
              `SELECT 
                ct.id,
                ct.role,
                ct.content,
                ct.created_at,
                ct.model_name,
                ct.total_tokens,
                ct.context_files,
                c.workspace_path
              FROM conversation_turns ct
              LEFT JOIN conversations c ON ct.conversation_id = c.id
              ORDER BY CAST(ct.created_at AS INTEGER) DESC
              LIMIT ?`,
              [limit],
              (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
          });
          samples.prompts = prompts.map((p) => ({
            id: p.id,
            role: p.role,
            content: p.content ? p.content.substring(0, 200) : null,
            created_at: p.created_at,
            model_name: p.model_name,
            total_tokens: p.total_tokens,
            context_files: p.context_files ? JSON.parse(p.context_files) : null,
            workspace_path: p.workspace_path,
          }));
        } catch (error) {
          console.error('[SHARING] Error getting prompt samples:', error);
          samples.prompts = [];
        }
      }

      if (type === 'all' || type === 'code') {
        try {
          const entries = await new Promise((resolve, reject) => {
            persistentDB.db.all(
              `SELECT 
                id,
                file_path,
                workspace_path,
                timestamp,
                type,
                before_code,
                after_code,
                source
              FROM entries
              WHERE before_code IS NOT NULL OR after_code IS NOT NULL
              ORDER BY CAST(timestamp AS INTEGER) DESC
              LIMIT ?`,
              [limit],
              (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
          });
          samples.entries = entries.map((e) => ({
            id: e.id,
            file_path: e.file_path,
            workspace_path: e.workspace_path,
            timestamp: e.timestamp,
            type: e.type,
            source: e.source,
            before_code: e.before_code ? e.before_code.substring(0, 200) : null,
            after_code: e.after_code ? e.after_code.substring(0, 200) : null,
          }));
        } catch (error) {
          console.error('[SHARING] Error getting entry samples:', error);
          samples.entries = [];
        }
      }

      if (type === 'all' || type === 'interaction') {
        try {
          const events = await new Promise((resolve, reject) => {
            persistentDB.db.all(
              `SELECT 
                id,
                type,
                timestamp,
                workspace_path,
                file_path,
                details
              FROM events
              ORDER BY CAST(timestamp AS INTEGER) DESC
              LIMIT ?`,
              [limit],
              (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
          });
          samples.events = events.map((e) => ({
            id: e.id,
            type: e.type,
            timestamp: e.timestamp,
            workspace_path: e.workspace_path,
            file_path: e.file_path,
            details: e.details ? JSON.parse(e.details) : null,
          }));
        } catch (error) {
          console.error('[SHARING] Error getting event samples:', error);
          samples.events = [];
        }
      }

      res.json({
        success: true,
        samples,
        count: Object.values(samples).reduce((sum, arr) => sum + arr.length, 0),
      });
    } catch (error) {
      console.error('[SHARING] Error getting data sample:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Calculate data sufficiency for analytics
   * GET /api/share/data-sufficiency?rung=clio
   */
  app.get('/api/share/data-sufficiency', async (req, res) => {
    try {
      const rung = req.query.rung || 'clio';
      await persistentDB.init();

      // Get current data counts
      const promptCount = await new Promise((resolve, reject) => {
        persistentDB.db.get('SELECT COUNT(*) as count FROM conversation_turns', [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      });

      const entryCount = await new Promise((resolve, reject) => {
        persistentDB.db.get(
          'SELECT COUNT(*) as count FROM entries WHERE before_code IS NOT NULL OR after_code IS NOT NULL',
          [],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.count || 0);
          }
        );
      });

      // Minimum thresholds based on research (approximate)
      const thresholds = {
        clio: {
          prompts: 1000, // Need substantial data for meaningful clustering
          entries: 500,
          description: 'Clio requires substantial data for meaningful workflow pattern clustering',
        },
        module_graph: {
          entries: 100, // File relationships need fewer samples
          prompts: 50,
          description: 'Module graphs need file change data to establish relationships',
        },
        functions: {
          entries: 200, // Function-level changes
          prompts: 100,
          description: 'Function-level analysis needs code change data',
        },
        semantic_edits: {
          entries: 150,
          prompts: 75,
          description: 'Semantic edits require code change data with context',
        },
        tokens: {
          entries: 50, // Tokens can work with less data
          prompts: 25,
          description: 'Token-level analysis works with smaller datasets',
        },
      };

      const threshold = thresholds[rung] || thresholds.clio;
      const current = { prompts: promptCount, entries: entryCount };
      const sufficient = {
        prompts: promptCount >= threshold.prompts,
        entries: entryCount >= threshold.entries,
      };
      const overall = sufficient.prompts && sufficient.entries;

      res.json({
        success: true,
        rung,
        current,
        threshold,
        sufficient,
        overall,
        description: threshold.description,
        progress: {
          prompts: Math.min(100, Math.round((promptCount / threshold.prompts) * 100)),
          entries: Math.min(100, Math.round((entryCount / threshold.entries) * 100)),
        },
      });
    } catch (error) {
      console.error('[SHARING] Error calculating data sufficiency:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Preview Hugging Face dataset schema
   * GET /api/hf/preview-schema?rung=clio
   */
  app.get('/api/hf/preview-schema', async (req, res) => {
    try {
      const rung = req.query.rung || 'clio';

      // Schema structure based on rung
      const schemas = {
        clio: {
          features: {
            id: 'string',
            timestamp: 'string',
            motif_id: 'string',
            workflow_pattern: 'string',
            intent_classification: 'string',
            embedding_cluster: 'int32',
            k_anonymity: 15,
          },
          description: 'High-level workflow patterns and motifs',
        },
        module_graph: {
          features: {
            id: 'string',
            timestamp: 'string',
            file_node: 'string',
            relationship_type: 'string',
            target_file: 'string',
            operation: 'string',
            edit_type: 'string',
          },
          description: 'File relationships and module dependencies',
        },
        functions: {
          features: {
            id: 'string',
            timestamp: 'string',
            file_path: 'string',
            function_name: 'string',
            change_type: 'string',
            signature: 'string',
            call_graph_updates: 'array',
          },
          description: 'Function-level changes and signatures',
        },
        semantic_edits: {
          features: {
            id: 'string',
            timestamp: 'string',
            file_path: 'string',
            edit_operation: 'string',
            before_ast: 'string',
            after_ast: 'string',
            prompt_metadata: 'object',
          },
          description: 'Semantic edit operations from AST differencing',
        },
        tokens: {
          features: {
            id: 'string',
            timestamp: 'string',
            file_path: 'string',
            token_sequence: 'array',
            canonical_sequence: 'array',
            pii_redacted: 'boolean',
          },
          description: 'Token sequences with PII redaction',
        },
      };

      const schema = schemas[rung] || schemas.clio;

      res.json({
        success: true,
        rung,
        schema,
        format: 'parquet',
        splits: ['train', 'validation'],
        compression: 'gzip',
      });
    } catch (error) {
      console.error('[SHARING] Error getting HF schema preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = createSharingRoutes;
