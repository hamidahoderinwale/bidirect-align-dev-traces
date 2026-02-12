/**
 * Motif API Routes (Rung 6)
 * Endpoints for motif extraction and retrieval
 */

const { nanoid } = require('nanoid');

function createMotifRoutes(deps) {
  const { app, persistentDB, motifService } = deps;

  console.log('[MOTIF] Registering motif routes...');

  // Helper function to check if service is available
  const checkService = (res) => {
    if (!motifService) {
      res.status(503).json({
        success: false,
        error: 'Motif service not available',
        message:
          'The motif service is not initialized. This feature may not be available in this installation.',
      });
      return false;
    }
    return true;
  };

  /**
   * GET /api/motifs
   * Get all motifs with optional filters
   */
  app.get('/api/motifs', async (req, res) => {
    if (!checkService(res)) return;

    try {
      const filters = {
        intentClass: req.query.intent_class || null,
        motifShape: req.query.shape || null,
        complexityBand: req.query.complexity || null,
        frequencyBand: req.query.frequency || null,
        modelInvolvement: req.query.model_involvement || null,
      };

      const motifs = await motifService.getMotifs(filters);

      res.json({
        success: true,
        motifs: motifs,
        count: motifs.length,
      });
    } catch (error) {
      console.error('[MOTIF] Error getting motifs:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/motifs/:id
   * Get single motif by ID
   */
  app.get('/api/motifs/:id', async (req, res) => {
    if (!checkService(res)) return;

    try {
      const motifId = req.params.id;
      const motif = await motifService.getMotif(motifId);

      if (!motif) {
        return res.status(404).json({
          success: false,
          error: 'Motif not found',
        });
      }

      res.json({
        success: true,
        motif: motif,
      });
    } catch (error) {
      console.error('[MOTIF] Error getting motif:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/motifs/:id/timeline
   * Get motif frequency timeline
   */
  app.get('/api/motifs/:id/timeline', async (req, res) => {
    if (!checkService(res)) return;

    try {
      const motifId = req.params.id;
      const timeRange = req.query.range || null;

      const timeline = await motifService.getMotifTimeline(motifId, timeRange);

      res.json({
        success: true,
        timeline: timeline,
      });
    } catch (error) {
      console.error('[MOTIF] Error getting motif timeline:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/motifs/extract
   * Extract motifs from canonical DAGs
   */
  app.post('/api/motifs/extract', async (req, res) => {
    if (!checkService(res)) return;

    try {
      const { canonicalDAGs, options = {} } = req.body;

      if (!canonicalDAGs || !Array.isArray(canonicalDAGs)) {
        return res.status(400).json({
          success: false,
          error: 'canonicalDAGs array is required',
        });
      }

      const motifs = await motifService.processDAGsToMotifs(canonicalDAGs, options);

      res.json({
        success: true,
        motifs: motifs,
        count: motifs.length,
      });
    } catch (error) {
      console.error('[MOTIF] Error extracting motifs:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/motifs/summary
   * Get summary statistics for motifs
   */
  app.get('/api/motifs/summary', async (req, res) => {
    if (!checkService(res)) return;

    try {
      const motifs = await motifService.getMotifs();

      // Compute summary statistics
      const intentDistribution = {};
      const shapeDistribution = {};
      let totalFrequency = 0;
      let totalModelEdits = 0;
      let totalHumanEdits = 0;
      const workflowLengths = [];

      motifs.forEach((motif) => {
        // Intent distribution
        const intent = motif.dominantIntent || 'UNKNOWN';
        intentDistribution[intent] = (intentDistribution[intent] || 0) + motif.frequency;

        // Shape distribution
        const shape = motif.shape || 'unknown';
        shapeDistribution[shape] = (shapeDistribution[shape] || 0) + 1;

        // Frequency
        totalFrequency += motif.frequency;

        // Model/human mix (if available in stats)
        if (motif.stats?.modelContributions) {
          totalModelEdits += motif.frequency * (motif.stats.modelContributions / 100);
          totalHumanEdits += motif.frequency * (1 - motif.stats.modelContributions / 100);
        }

        // Workflow lengths
        if (motif.stats?.medianLength) {
          workflowLengths.push(motif.stats.medianLength);
        }
      });

      // Convert to percentages
      const intentPercentages = {};
      Object.entries(intentDistribution).forEach(([intent, count]) => {
        intentPercentages[intent] = (count / totalFrequency) * 100;
      });

      const modelHumanMix = {
        model: totalFrequency > 0 ? (totalModelEdits / totalFrequency) * 100 : 0,
        human: totalFrequency > 0 ? (totalHumanEdits / totalFrequency) * 100 : 0,
      };

      const avgWorkflowLength =
        workflowLengths.length > 0
          ? workflowLengths.reduce((a, b) => a + b, 0) / workflowLengths.length
          : 0;

      const clusterCoverage = {
        motifs: motifs.length,
        coverage: motifs.length > 0 ? (totalFrequency / (totalFrequency + 100)) * 100 : 0, // Simplified
      };

      res.json({
        success: true,
        summary: {
          intentDistribution: intentPercentages,
          modelHumanMix: modelHumanMix,
          avgWorkflowLength: avgWorkflowLength,
          clusterCoverage: clusterCoverage,
          shapeDistribution: shapeDistribution,
        },
      });
    } catch (error) {
      console.error('[MOTIF] Error getting motif summary:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = createMotifRoutes;
