/**
 * Module Graph API Routes
 * Endpoints for file-level abstraction (module graph) data
 */

function createModuleGraphRoutes(deps) {
  const { app, moduleGraphService } = deps;

  if (!moduleGraphService) {
    console.warn('[MODULE-GRAPH] Module graph service not available, routes disabled');
    return;
  }

  console.log('[MODULE-GRAPH] Registering module graph routes...');

  /**
   * GET /api/module-graph/preview
   * Get preview samples of module graph
   */
  app.get('/api/module-graph/preview', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const limit = parseInt(req.query.limit) || 5;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;

      const nodes = await moduleGraphService.getNodes(normalizedWorkspace, {});
      const edges = await moduleGraphService.getEdges(normalizedWorkspace, {});

      // Get sample nodes (first N)
      const sampleNodes = nodes.slice(0, limit).map((node) => ({
        id: node.id,
        file: node.file || node.name || null,
        name: node.name || node.file || null,
        type: node.type || 'module',
        dependencies: node.dependencies || [],
        dependents: node.dependents || [],
        metadata: {
          edit_count: node.edit_count || 0,
          language: node.lang || 'unknown',
        },
      }));

      // Get sample edges (first N)
      const sampleEdges = edges.slice(0, limit).map((edge) => ({
        id: edge.id,
        source: edge.source || edge.from,
        target: edge.target || edge.to,
        type: edge.type || edge.edgeType || 'dependency',
        metadata: {
          weight: edge.weight || 1,
        },
      }));

      res.json({
        success: true,
        samples: {
          nodes: sampleNodes,
          edges: sampleEdges,
        },
        count: {
          nodes: sampleNodes.length,
          edges: sampleEdges.length,
        },
        total_available: {
          nodes: nodes.length,
          edges: edges.length,
        },
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error getting preview:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/graph
   * Get complete module graph
   */
  app.get('/api/module-graph/graph', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error:
            'Request timeout - module graph extraction is taking too long. Try a specific workspace or use /api/module-graph/nodes for faster results.',
        });
      }
    }, 30000); // 30 second timeout

    try {
      if (!moduleGraphService) {
        clearTimeout(timeout);
        return res.status(503).json({
          success: false,
          error: 'Module graph service not available',
        });
      }

      const workspace = req.query.workspace || req.query.workspace_path || null;
      // Normalize "all" to null for global extraction
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      const forceRefresh = req.query.force_refresh === 'true';

      const graph = await moduleGraphService.getModuleGraph(normalizedWorkspace, { forceRefresh });

      clearTimeout(timeout);
      res.json({
        success: true,
        graph,
        metadata: graph.metadata,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error getting module graph:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/module-graph/nodes
   * Get module nodes with filters
   */
  app.get('/api/module-graph/nodes', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filters = {
        type: req.query.type || null,
        lang: req.query.lang || null,
        minEdits: req.query.min_edits ? parseInt(req.query.min_edits) : undefined,
        hasModelContext: req.query.has_model_context === 'true',
      };

      const nodes = await moduleGraphService.getNodes(workspace, filters);

      res.json({
        success: true,
        nodes,
        count: nodes.length,
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error getting nodes:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/edges
   * Get typed edges with filters
   */
  app.get('/api/module-graph/edges', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const filters = {
        edgeType: req.query.edge_type || null,
        source: req.query.source || null,
        target: req.query.target || null,
        minWeight: req.query.min_weight ? parseInt(req.query.min_weight) : undefined,
      };

      const edges = await moduleGraphService.getEdges(workspace, filters);

      res.json({
        success: true,
        edges,
        count: edges.length,
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error getting edges:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/events
   * Get structural events with filters
   */
  app.get('/api/module-graph/events', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout',
        });
      }
    }, 30000);

    try {
      if (!moduleGraphService) {
        clearTimeout(timeout);
        return res.status(503).json({
          success: false,
          error: 'Module graph service not available',
        });
      }

      const workspace = req.query.workspace || req.query.workspace_path || null;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      const filters = {
        timeRange: null,
        eventType: req.query.event_type || null,
        file: req.query.file || null,
      };

      if (req.query.since || req.query.until) {
        filters.timeRange = {
          since: req.query.since ? parseInt(req.query.since) : null,
          until: req.query.until ? parseInt(req.query.until) : null,
        };
      }

      const events = await moduleGraphService.getEvents(normalizedWorkspace, filters);

      clearTimeout(timeout);
      res.json({
        success: true,
        events,
        count: events.length,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error getting events:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/module-graph/hierarchy
   * Get directory hierarchy
   */
  app.get('/api/module-graph/hierarchy', async (req, res) => {
    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;

      const hierarchy = await moduleGraphService.getHierarchy(workspace);

      res.json({
        success: true,
        hierarchy,
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error getting hierarchy:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/module-graph/refresh
   * Force refresh cache
   */
  app.post('/api/module-graph/refresh', async (req, res) => {
    try {
      const workspace = req.body.workspace || req.body.workspace_path || null;

      moduleGraphService.clearCache(workspace);

      res.json({
        success: true,
        message: 'Cache cleared',
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error refreshing cache:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/metrics
   * Get graph metrics (centrality, clustering, etc.)
   */
  app.get('/api/module-graph/metrics', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout',
        });
      }
    }, 60000); // 60 second timeout for metrics

    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      const forceRecalculate = req.query.force_recalculate === 'true';

      const metrics = await moduleGraphService.getMetrics(normalizedWorkspace, {
        forceRecalculate,
      });

      clearTimeout(timeout);
      res.json({
        success: true,
        metrics,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error getting metrics:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/communities
   * Get community detection results
   */
  app.get('/api/module-graph/communities', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout',
        });
      }
    }, 60000);

    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      const algorithm = req.query.algorithm || 'louvain';
      const resolution = req.query.resolution ? parseFloat(req.query.resolution) : 1.0;

      const communities = await moduleGraphService.getCommunities(normalizedWorkspace, {
        algorithm,
        resolution,
      });

      clearTimeout(timeout);
      res.json({
        success: true,
        ...communities,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error getting communities:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/diff
   * Compare graphs at different times
   */
  app.get('/api/module-graph/diff', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout',
        });
      }
    }, 60000);

    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      // For now, compare current with previous version
      // TODO: Support time1 and time2 parameters

      const diff = await moduleGraphService.getDiff(normalizedWorkspace, {});

      clearTimeout(timeout);
      res.json({
        success: true,
        diff,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error getting diff:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/module-graph/query
   * Execute graph query
   */
  app.post('/api/module-graph/query', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout',
        });
      }
    }, 30000);

    try {
      const workspace = req.body.workspace || req.body.workspace_path || null;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      const query = req.body.query;

      if (!query || !query.type) {
        clearTimeout(timeout);
        return res.status(400).json({
          success: false,
          error: 'Query type is required',
        });
      }

      const results = await moduleGraphService.executeQuery(normalizedWorkspace, query);

      clearTimeout(timeout);
      res.json({
        success: true,
        results,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error executing query:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/paths
   * Find paths between nodes
   */
  app.get('/api/module-graph/paths', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: 'Request timeout',
        });
      }
    }, 30000);

    try {
      const workspace = req.query.workspace || req.query.workspace_path || null;
      const normalizedWorkspace = workspace === 'all' ? null : workspace;
      const from = req.query.from;
      const to = req.query.to;

      if (!from || !to) {
        clearTimeout(timeout);
        return res.status(400).json({
          success: false,
          error: 'from and to parameters are required',
        });
      }

      const options = {
        maxDepth: req.query.max_depth ? parseInt(req.query.max_depth) : 10,
        maxPaths: req.query.max_paths ? parseInt(req.query.max_paths) : 10,
        edgeTypes: req.query.edge_types ? req.query.edge_types.split(',') : null,
      };

      const paths = await moduleGraphService.findPaths(normalizedWorkspace, from, to, options);

      clearTimeout(timeout);
      res.json({
        success: true,
        paths,
        count: paths.length,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('[MODULE-GRAPH] Error finding paths:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/stats
   * Get extraction/build statistics
   */
  app.get('/api/module-graph/stats', async (req, res) => {
    try {
      const performanceMetrics = moduleGraphService.getPerformanceMetrics();
      const cacheStats = moduleGraphService.getCacheStats();

      res.json({
        success: true,
        performance: performanceMetrics,
        cache: cacheStats,
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error getting stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/cache-info
   * Get cache status
   */
  app.get('/api/module-graph/cache-info', async (req, res) => {
    try {
      const cacheStats = moduleGraphService.getCacheStats();

      res.json({
        success: true,
        cache: cacheStats,
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error getting cache info:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/module-graph/health
   * Health check with performance metrics
   */
  app.get('/api/module-graph/health', async (req, res) => {
    try {
      const performanceMetrics = moduleGraphService.getPerformanceMetrics();
      const cacheStats = moduleGraphService.getCacheStats();

      const isHealthy = performanceMetrics.averageBuildTime < 30000; // Less than 30s average

      res.json({
        success: true,
        healthy: isHealthy,
        performance: performanceMetrics,
        cache: cacheStats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[MODULE-GRAPH] Error in health check:', error);
      res.status(500).json({
        success: false,
        healthy: false,
        error: error.message,
      });
    }
  });
}

module.exports = createModuleGraphRoutes;
