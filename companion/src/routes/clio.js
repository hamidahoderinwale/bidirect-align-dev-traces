/**
 * Clio API Routes
 * Privacy-preserving workflow pattern analysis endpoints
 */

const express = require('express');

function createClioRoutes(deps) {
  const router = express.Router();
  const { persistentDB, clioService } = deps;

  if (!clioService) {
    console.warn('[CLIO-ROUTES] ClioService not available - routes will return 503');
  }

  /**
   * GET /api/clio/preview
   * Get preview samples of Clio motifs
   */
  router.get('/preview', async (req, res) => {
    try {
      if (!clioService) {
        return res.status(503).json({
          success: false,
          error: 'Clio service not initialized',
        });
      }

      const workspace = req.query.workspace || req.query.workspace_path || null;
      const limit = parseInt(req.query.limit) || 5;

      // Get motifs from database
      let query = 'SELECT * FROM clio_motifs ORDER BY created_at DESC LIMIT ?';
      const params = [limit];

      if (workspace && workspace !== 'all') {
        query =
          'SELECT * FROM clio_motifs WHERE workspace_path = ? ORDER BY created_at DESC LIMIT ?';
        params.unshift(workspace);
      }

      const motifs = await persistentDB.all(query, params);

      const samples = motifs.map((motif) => {
        let clusterData = {};
        try {
          clusterData =
            typeof motif.cluster_data === 'string'
              ? JSON.parse(motif.cluster_data)
              : motif.cluster_data || {};
        } catch (e) {
          clusterData = {};
        }

        return {
          id: motif.id || motif.cluster_id,
          cluster_id: motif.cluster_id || motif.id,
          cluster_type: motif.cluster_type || 'global',
          pattern: clusterData.pattern || clusterData.description || 'Workflow pattern',
          k: clusterData.k || motif.k || null,
          size: clusterData.size || clusterData.count || motif.size || 0,
          workspace_path: motif.workspace_path || null,
          metadata: {
            created_at: motif.created_at || motif.timestamp,
            strategy: clusterData.strategy || motif.cluster_type,
          },
        };
      });

      res.json({
        success: true,
        samples: {
          motifs: samples,
          clusters: samples, // Alias for compatibility
        },
        count: samples.length,
        total_available: motifs.length,
      });
    } catch (error) {
      console.error('[CLIO-API] Error getting preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Process data through Clio pipeline
   * POST /api/clio/process
   */
  router.post('/process', async (req, res) => {
    try {
      if (!clioService) {
        return res.status(503).json({
          success: false,
          error: 'Clio service not initialized',
        });
      }

      const {
        sampleSize = 10000,
        strategies = ['global', 'workspace_specific', 'repo_type'],
        privacyStrict = false,
        workspaces = null,
      } = req.body;

      console.log(`[CLIO-API] Processing data with strategies: ${strategies.join(', ')}`);

      // Get data from database
      let data = [];

      // Fetch recent events
      const events = await persistentDB.all(
        'SELECT * FROM events ORDER BY timestamp DESC LIMIT ?',
        [sampleSize]
      );

      // Fetch recent prompts
      const prompts = await persistentDB.all(
        'SELECT * FROM prompts ORDER BY timestamp DESC LIMIT ?',
        [sampleSize]
      );

      // Combine and tag items
      data = [
        ...events.map((e) => ({ ...e, itemType: 'event' })),
        ...prompts.map((p) => ({ ...p, itemType: 'prompt' })),
      ];

      // Filter by workspaces if specified
      if (workspaces && Array.isArray(workspaces)) {
        data = data.filter((item) =>
          workspaces.some((ws) => (item.workspace_path || '').includes(ws))
        );
      }

      if (data.length === 0) {
        return res.json({
          success: true,
          message: 'No data to process',
          clusters: [],
          metadata: { totalItems: 0 },
        });
      }

      // Process through Clio
      const result = await clioService.processData(data, {
        sampleSize,
        strategies,
        privacyStrict,
      });

      res.json({
        success: true,
        ...result,
        metadata: {
          ...result.metadata,
          totalItems: data.length,
          processedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[CLIO-API] Processing error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get Clio service status
   * GET /api/clio/status
   */
  router.get('/status', async (req, res) => {
    try {
      if (!clioService) {
        return res.json({
          available: false,
          error: 'Clio service not initialized',
        });
      }

      const embeddingStatus = clioService.embeddingService.getStatus();
      const llmStatus = clioService.llmService.getStatus();

      res.json({
        available: true,
        embedding: embeddingStatus,
        llm: llmStatus,
        ready: embeddingStatus.available && llmStatus.available,
      });
    } catch (error) {
      res.status(500).json({
        available: false,
        error: error.message,
      });
    }
  });

  /**
   * Get stored Clio motifs from database
   * GET /api/clio/motifs
   */
  router.get('/motifs', async (req, res) => {
    try {
      const { workspace, limit = 100 } = req.query;

      let query = 'SELECT * FROM clio_motifs ORDER BY created_at DESC LIMIT ?';
      let params = [parseInt(limit)];

      if (workspace) {
        query =
          'SELECT * FROM clio_motifs WHERE workspace_path = ? ORDER BY created_at DESC LIMIT ?';
        params = [workspace, parseInt(limit)];
      }

      const motifs = await persistentDB.all(query, params);

      res.json({
        success: true,
        motifs: motifs.map((m) => ({
          ...m,
          cluster_data: m.cluster_data ? JSON.parse(m.cluster_data) : null,
        })),
        count: motifs.length,
      });
    } catch (error) {
      console.error('[CLIO-API] Error fetching motifs:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get specific motif by ID
   * GET /api/clio/motifs/:id
   */
  router.get('/motifs/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const motif = await persistentDB.get('SELECT * FROM clio_motifs WHERE id = ?', [id]);

      if (!motif) {
        return res.status(404).json({
          success: false,
          error: 'Motif not found',
        });
      }

      res.json({
        success: true,
        motif: {
          ...motif,
          cluster_data: motif.cluster_data ? JSON.parse(motif.cluster_data) : null,
        },
      });
    } catch (error) {
      console.error('[CLIO-API] Error fetching motif:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Save Clio results to database
   * POST /api/clio/save
   */
  router.post('/save', async (req, res) => {
    try {
      const { clusters, metadata } = req.body;

      if (!clusters || !Array.isArray(clusters)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid clusters data',
        });
      }

      // Ensure clio_motifs table exists
      await persistentDB.run(`
        CREATE TABLE IF NOT EXISTS clio_motifs (
          id TEXT PRIMARY KEY,
          cluster_type TEXT,
          title TEXT,
          description TEXT,
          summary TEXT,
          size INTEGER,
          privacy_score REAL,
          workspace_path TEXT,
          cluster_data TEXT,
          created_at TEXT,
          updated_at TEXT
        )
      `);

      // Save each cluster
      const saved = [];
      for (const cluster of clusters) {
        const id = cluster.id || `motif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await persistentDB.run(
          `
          INSERT OR REPLACE INTO clio_motifs 
          (id, cluster_type, title, description, summary, size, privacy_score, workspace_path, cluster_data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            id,
            cluster.type || 'unknown',
            cluster.title || null,
            cluster.description || null,
            cluster.summary || null,
            cluster.size || 0,
            cluster.privacyScore || 0,
            cluster.workspace || null,
            JSON.stringify(cluster),
            new Date().toISOString(),
            new Date().toISOString(),
          ]
        );

        saved.push(id);
      }

      res.json({
        success: true,
        saved: saved.length,
        ids: saved,
      });
    } catch (error) {
      console.error('[CLIO-API] Error saving motifs:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Export Clio motifs
   * GET /api/clio/export
   */
  router.get('/export', async (req, res) => {
    try {
      const { workspace, format = 'json' } = req.query;

      let query = 'SELECT * FROM clio_motifs ORDER BY created_at DESC';
      let params = [];

      if (workspace) {
        query = 'SELECT * FROM clio_motifs WHERE workspace_path = ? ORDER BY created_at DESC';
        params = [workspace];
      }

      const motifs = await persistentDB.all(query, params);

      const exportData = motifs.map((m) => ({
        ...m,
        cluster_data: m.cluster_data ? JSON.parse(m.cluster_data) : null,
      }));

      if (format === 'csv') {
        // Simple CSV export
        const csv = [
          'id,type,title,description,size,privacy_score,workspace,created_at',
          ...exportData.map(
            (m) =>
              `${m.id},${m.cluster_type},"${m.title || ''}","${m.description || ''}",${m.size},${m.privacy_score},${m.workspace_path || ''},${m.created_at}`
          ),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="clio-motifs.csv"');
        res.send(csv);
      } else {
        res.json({
          success: true,
          motifs: exportData,
          count: exportData.length,
          exportedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('[CLIO-API] Error exporting motifs:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = createClioRoutes;
