/**
 * Hugging Face Export & Upload API Routes
 * Provides endpoints for exporting data to Hugging Face Dataset format
 * and managing HF authentication and dataset uploads
 */

const path = require('path');
const HuggingFaceExporter = require('../services/huggingface-exporter.js');
const HuggingFaceUploadService = require('../services/huggingface-upload-service.js');

function createHuggingFaceRoutes(deps) {
  const { app, persistentDB, automaticHfSyncService = null } = deps;

  // Initialize upload service (singleton)
  const uploadService = new HuggingFaceUploadService();

  /**
   * Export to Hugging Face Dataset format
   * GET /api/huggingface/export
   *
   * Query parameters:
   * - privacy_level: 'raw', 'tokens', 'semantic_edits', 'functions', 'module_graph', 'clio' (default: 'clio')
   * - include_code: 'true' or 'false' (default: true for raw/rung1/rung2/rung3, false for clio/module_graph)
   * - include_prompts: 'true' or 'false' (default: true)
   * - anonymize: 'true' or 'false' (default: true)
   * - max_samples: number (default: 10000)
   * - output_dir: path to output directory (default: ./data/hf-export-<timestamp>)
   */
  app.get('/api/huggingface/export', async (req, res) => {
    try {
      console.log('[HF-API] Hugging Face export request received');

      // Map rung parameter to privacy_level if provided
      const rungParam = req.query.rung || req.query.privacy_level;
      const privacyLevel = rungParam || 'clio';
      const includeCode = req.query.include_code !== 'false';
      const includePrompts = req.query.include_prompts !== 'false';
      const anonymize = req.query.anonymize !== 'false';
      const maxSamples = parseInt(req.query.max_samples) || 10000;

      // Support workspace filtering
      const workspace = req.query.workspace || req.query.workspace_path || null;

      // Support date range filtering
      const since = req.query.since ? parseInt(req.query.since) : null;
      const until = req.query.until ? parseInt(req.query.until) : null;

      const outputDir =
        req.query.output_dir ||
        path.join(__dirname, '../../data', `hf-export-${privacyLevel}-${Date.now()}`);

      // Validate privacy level
      const validPrivacyLevels = [
        'raw',
        'tokens',
        'semantic_edits',
        'functions',
        'module_graph',
        'clio',
      ];
      if (!validPrivacyLevels.includes(privacyLevel)) {
        return res.status(400).json({
          success: false,
          error: `Invalid privacy_level. Must be one of: ${validPrivacyLevels.join(', ')}`,
        });
      }

      // Create exporter with options
      const exporter = new HuggingFaceExporter(persistentDB, {
        privacyLevel,
        includeCode,
        includePrompts,
        anonymize,
        maxSamples,
        workspace: workspace || null,
        since: since || null,
        until: until || null,
      });

      // Export to Hugging Face format
      console.log('[HF-API] Starting export with options:', {
        privacyLevel,
        includeCode,
        includePrompts,
        anonymize,
        maxSamples,
        outputDir,
      });

      const result = await exporter.exportToHuggingFaceFormat(outputDir);

      res.json({
        success: true,
        message: 'Export completed successfully',
        result: {
          outputDir: result.outputDir,
          totalSamples: result.totalSamples,
          files: result.files,
          privacyLevel,
          anonymized: anonymize,
        },
        instructions: {
          upload: [
            '1. Install Hugging Face CLI: pip install huggingface_hub',
            '2. Login: huggingface-cli login',
            `3. Create dataset: huggingface-cli repo create <your-username>/cursor-telemetry --type dataset`,
            `4. Upload files: cd ${result.outputDir} && huggingface-cli upload <your-username>/cursor-telemetry . .`,
            '5. Your dataset will be available at: https://huggingface.co/datasets/<your-username>/cursor-telemetry',
          ],
          usage: [
            'from datasets import load_dataset',
            'dataset = load_dataset("<your-username>/cursor-telemetry")',
            'train_data = dataset["train"]',
          ],
        },
      });
    } catch (error) {
      console.error('[HF-API] Export failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  });

  /**
   * Get export options and documentation
   * GET /api/huggingface/info
   */
  app.get('/api/huggingface/info', (req, res) => {
    res.json({
      success: true,
      description: 'Hugging Face Dataset Export & Upload Service',
      privacyLevels: {
        raw: 'Full data including all code and prompts (lowest privacy)',
        tokens: 'Token-level with PII redaction',
        semantic_edits: 'Semantic edit operations',
        functions: 'Function-level changes',
        module_graph: 'File dependencies only',
        clio: 'Workflow patterns only (highest privacy)',
      },
      options: {
        privacy_level:
          'Privacy level for export (raw, tokens, semantic_edits, functions, module_graph, clio)',
        include_code: 'Include code diffs in export (true/false)',
        include_prompts: 'Include AI prompts in export (true/false)',
        anonymize: 'Anonymize file paths and remove PII (true/false)',
        max_samples: 'Maximum number of samples to export (default: 10000)',
        output_dir: 'Custom output directory path (optional)',
      },
      endpoints: {
        export: 'GET /api/huggingface/export - Export data to HF format',
        info: 'GET /api/huggingface/info - Get API documentation',
        login: 'POST /api/hf/login - Login with HF token',
        status: 'GET /api/hf/status - Check login status',
        logout: 'POST /api/hf/logout - Logout',
        upload: 'POST /api/hf/upload - Upload dataset to HF Hub',
        datasets: 'GET /api/hf/datasets - List user datasets',
        deleteDataset: 'DELETE /api/hf/datasets/:name - Delete dataset',
      },
      examples: [
        '/api/huggingface/export?privacy_level=clio&anonymize=true',
        '/api/huggingface/export?privacy_level=functions&max_samples=5000',
        '/api/huggingface/export?privacy_level=raw&include_code=true&anonymize=false',
      ],
      resources: {
        documentation: 'https://huggingface.co/docs/datasets',
        hub: 'https://huggingface.co/datasets',
        cli: 'https://huggingface.co/docs/huggingface_hub/guides/cli',
        tokens: 'https://huggingface.co/settings/tokens',
      },
    });
  });

  // ============================================
  // Hugging Face Authentication & Upload Routes
  // ============================================

  /**
   * Login with Hugging Face token
   * POST /api/hf/login
   * Body: { token: string, sessionId?: string }
   */
  app.post('/api/hf/login', async (req, res) => {
    try {
      const { token, sessionId } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Token is required',
        });
      }

      const result = await uploadService.login(token, sessionId);

      res.json(result);
    } catch (error) {
      console.error('[HF-API] Login error:', error);
      res.status(401).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get login status
   * GET /api/hf/status?sessionId=xxx
   */
  app.get('/api/hf/status', async (req, res) => {
    try {
      const sessionId = req.query.sessionId;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'sessionId is required',
        });
      }

      const status = await uploadService.getStatus(sessionId);
      res.json(status);
    } catch (error) {
      console.error('[HF-API] Status error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Logout
   * POST /api/hf/logout
   * Body: { sessionId: string }
   */
  app.post('/api/hf/logout', async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'sessionId is required',
        });
      }

      const result = await uploadService.logout(sessionId);
      res.json(result);
    } catch (error) {
      console.error('[HF-API] Logout error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Upload dataset to Hugging Face Hub
   * POST /api/hf/upload
   * Body: {
   *   sessionId: string,
   *   repoName: string (username/dataset-name),
   *   directory: string,
   *   options?: { private?: boolean, commitMessage?: string }
   * }
   */
  app.post('/api/hf/upload', async (req, res) => {
    try {
      const { sessionId, repoName, directory, options = {} } = req.body;

      if (!sessionId || !repoName || !directory) {
        return res.status(400).json({
          success: false,
          error: 'sessionId, repoName, and directory are required',
        });
      }

      const result = await uploadService.uploadDataset(sessionId, repoName, directory, options);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[HF-API] Upload error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * List user's datasets
   * GET /api/hf/datasets?sessionId=xxx
   */
  app.get('/api/hf/datasets', async (req, res) => {
    try {
      const sessionId = req.query.sessionId;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'sessionId is required',
        });
      }

      const result = await uploadService.listDatasets(sessionId);
      res.json(result);
    } catch (error) {
      console.error('[HF-API] List datasets error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Delete a dataset
   * DELETE /api/hf/datasets/:name?sessionId=xxx
   */
  app.delete('/api/hf/datasets/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const sessionId = req.query.sessionId;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'sessionId is required',
        });
      }

      const result = await uploadService.deleteDataset(sessionId, name);
      res.json(result);
    } catch (error) {
      console.error('[HF-API] Delete dataset error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Automatic Sync Routes
  // ============================================

  if (automaticHfSyncService) {
    /**
     * Get automatic sync status
     * GET /api/hf/sync/status
     */
    app.get('/api/hf/sync/status', (req, res) => {
      try {
        const status = automaticHfSyncService.getStatus();
        res.json({
          success: true,
          ...status,
        });
      } catch (error) {
        console.error('[HF-API] Get sync status error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * Configure automatic sync
     * POST /api/hf/sync/configure
     * Body: { sessionId, repoName, privacyLevel?, enabled? }
     */
    app.post('/api/hf/sync/configure', async (req, res) => {
      try {
        const { sessionId, repoName, privacyLevel, enabled } = req.body;

        if (!sessionId || !repoName) {
          return res.status(400).json({
            success: false,
            error: 'sessionId and repoName are required',
          });
        }

        const config = await automaticHfSyncService.setSyncConfig({
          sessionId,
          repoName,
          privacyLevel,
        });

        if (enabled !== undefined) {
          automaticHfSyncService.options.enabled = enabled;
          if (enabled && !automaticHfSyncService.isInitialized) {
            await automaticHfSyncService.initialize();
          } else if (!enabled) {
            automaticHfSyncService.stop();
          }
        }

        res.json({
          success: true,
          config: config.config,
          status: automaticHfSyncService.getStatus(),
        });
      } catch (error) {
        console.error('[HF-API] Configure sync error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * Manually trigger sync
     * POST /api/hf/sync/trigger
     * Body: { privacyLevel?, maxSamples?, private?, commitMessage? }
     */
    app.post('/api/hf/sync/trigger', async (req, res) => {
      try {
        const options = req.body || {};
        const result = await automaticHfSyncService.triggerSync(options);
        res.json({
          success: result.success,
          ...result,
        });
      } catch (error) {
        console.error('[HF-API] Trigger sync error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    /**
     * Stop automatic sync
     * POST /api/hf/sync/stop
     */
    app.post('/api/hf/sync/stop', (req, res) => {
      try {
        automaticHfSyncService.stop();
        automaticHfSyncService.options.enabled = false;
        res.json({
          success: true,
          message: 'Automatic sync stopped',
        });
      } catch (error) {
        console.error('[HF-API] Stop sync error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });
  }

  return app;
}

module.exports = createHuggingFaceRoutes;
