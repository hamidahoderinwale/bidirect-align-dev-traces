/**
 * Rung 1 API Routes
 * Endpoints for token-level abstraction data
 */

function createRung1Routes(deps) {
  const { app, tokensService } = deps;

  if (!tokensService) {
    console.warn('[RUNG1] Rung 1 service not available, routes disabled');
    return;
  }

  /**
   * GET /api/tokens/tokens
   * Get token sequences with filters
   */
  app.get('/api/tokens/tokens', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filters = {
        language: req.query.language || null,
        filePath: req.query.file_path || null,
        since: req.query.since || null,
        until: req.query.until || null,
        conversationId: req.query.conversation_id || null,
        eventType: req.query.event_type || null,
      };

      // Parse PII options from query params (for export/sharing)
      const piiOptions = {
        redactEmails: req.query.redact_emails !== 'false',
        redactNames: req.query.redact_names !== 'false',
        redactNumbers: req.query.redact_numbers !== 'false',
        redactUrls: req.query.redact_urls !== 'false',
        redactIpAddresses: req.query.redact_ip_addresses !== 'false',
        redactFilePaths: req.query.redact_file_paths !== 'false',
        redactAllStrings: req.query.redact_all_strings !== 'false',
        redactAllNumbers: req.query.redact_all_numbers !== 'false',
      };

      // Parse semantic expressiveness fuzzing option
      const fuzzSemanticExpressiveness = req.query.fuzz_semantic_expressiveness === 'true';

      // Temporarily update options if provided
      const originalPIIOptions = { ...tokensService.piiOptions };
      const originalFuzzOption = tokensService.fuzzSemanticExpressiveness;

      if (Object.values(piiOptions).some((v) => v !== undefined)) {
        tokensService.updatePIIOptions(piiOptions);
      }
      if (fuzzSemanticExpressiveness !== undefined) {
        tokensService.setFuzzSemanticExpressiveness(fuzzSemanticExpressiveness);
      }

      const tokens = await tokensService.getTokens(workspace, filters);

      // Restore original options
      if (Object.values(piiOptions).some((v) => v !== undefined)) {
        tokensService.updatePIIOptions(originalPIIOptions);
      }
      if (fuzzSemanticExpressiveness !== undefined) {
        tokensService.setFuzzSemanticExpressiveness(originalFuzzOption);
      }

      res.json({
        success: true,
        tokens,
        count: tokens.length,
        piiOptions: piiOptions, // Include applied PII options in response
        fuzzSemanticExpressiveness: fuzzSemanticExpressiveness,
      });
    } catch (error) {
      console.error('[RUNG1] Error getting tokens:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/tokens/preview
   * Get preview samples of token sequences
   */
  app.get('/api/tokens/preview', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const limit = parseInt(req.query.limit) || 5;

      const filters = {
        language: req.query.language || null,
        filePath: req.query.file_path || null,
      };

      const tokens = await tokensService.getTokens(workspace, filters);

      // Get sample tokens (first N)
      const samples = tokens.slice(0, limit).map((token) => ({
        id: token.id,
        original: token.original_code || token.before || '',
        canonicalized: token.canonicalized || token.after || token.tokens || '',
        tokens: token.tokens || [],
        language: token.language || 'text',
        file_path: token.file_path || token.filePath || null,
        timestamp: token.timestamp || token.created_at || Date.now(),
        metadata: {
          token_count: token.tokens?.length || 0,
          has_pii: token.has_pii || false,
        },
      }));

      res.json({
        success: true,
        samples,
        count: samples.length,
        total_available: tokens.length,
      });
    } catch (error) {
      console.error('[RUNG1] Error getting preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/tokens/tokens/:id
   * Get specific token sequence
   */
  app.get('/api/tokens/tokens/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const tokens = await tokensService.getTokens();
      const token = tokens.find((t) => t.id === id);

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'Token sequence not found',
        });
      }

      res.json({
        success: true,
        token,
      });
    } catch (error) {
      console.error('[RUNG1] Error getting token:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/tokens/stats
   * Get token distribution statistics
   */
  app.get('/api/tokens/stats', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const stats = await tokensService.getTokenStats(workspace);

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error('[RUNG1] Error getting stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/tokens/refresh
   * Force refresh cache
   */
  app.post('/api/tokens/refresh', async (req, res) => {
    try {
      const workspace = req.body.workspace || req.body.workspace_path || null;
      tokensService.clearCache(workspace);

      res.json({
        success: true,
        message: 'Cache cleared',
      });
    } catch (error) {
      console.error('[RUNG1] Error refreshing cache:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/tokens/extract
   * Trigger extraction of tokens from Cursor database
   */
  app.post('/api/tokens/extract', async (req, res) => {
    try {
      const workspace = req.body.workspace || req.body.workspace_path || null;
      const forceRefresh = req.body.force === true;

      console.log(`[RUNG1] Starting extraction for workspace: ${workspace || 'all'}`);

      const tokens = await tokensService.extractTokens(workspace, { forceRefresh });

      res.json({
        success: true,
        message: `Extracted ${tokens.length} token sequences`,
        count: tokens.length,
      });
    } catch (error) {
      console.error('[RUNG1] Error extracting tokens:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        details: error.stack,
      });
    }
  });
}

module.exports = createRung1Routes;
