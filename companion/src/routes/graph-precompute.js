/**
 * Graph Pre-computation Routes
 * Pre-computes graphs from existing companion data for faster Explorer loading
 */

function createGraphPrecomputeRoutes(deps) {
  const { app, persistentDB, cache } = deps;

  /**
   * Build action-level graph from events
   */
  function buildActionLevelGraph(events) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeA - timeB;
    });

    sortedEvents.forEach((event, index) => {
      const nodeId = event.id || `event-${index}`;
      nodeMap.set(nodeId, nodes.length);

      nodes.push({
        id: nodeId,
        label: event.type || 'unknown',
        type: event.type || 'unknown',
        x: undefined, // Will be computed by layout algorithm
        y: undefined,
        size: 6,
        color: getNodeColor(event.type),
        metadata: {
          index,
          timestamp: event.timestamp,
          session_id: event.session_id,
          workspace_path: event.workspace_path,
          annotation: event.annotation,
          intent: event.intent,
          originalEvent: event,
        },
      });

      // Create temporal edges (sequential events)
      if (index > 0) {
        const prevEvent = sortedEvents[index - 1];
        const prevNodeId = prevEvent.id || `event-${index - 1}`;
        edges.push({
          id: `edge-${prevNodeId}-${nodeId}`,
          from: prevNodeId,
          to: nodeId,
          type: 'temporal',
          weight: 1,
        });
      }

      // Create causal edges (same session, related events)
      if (event.session_id && index > 0) {
        const relatedEvents = sortedEvents
          .slice(Math.max(0, index - 10), index)
          .filter((e) => e.session_id === event.session_id && e.id !== event.id);
        relatedEvents.forEach((relatedEvent) => {
          const relatedNodeId = relatedEvent.id || `event-${sortedEvents.indexOf(relatedEvent)}`;
          if (nodeMap.has(relatedNodeId)) {
            edges.push({
              id: `edge-${relatedNodeId}-${nodeId}`,
              from: relatedNodeId,
              to: nodeId,
              type: 'causal',
              weight: 0.5,
            });
          }
        });
      }
    });

    // Apply force-directed layout (simplified)
    applyForceLayout(nodes, edges);

    return {
      nodes,
      edges,
      metadata: {
        totalEvents: events.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        computedAt: new Date().toISOString(),
        level: 'action',
      },
    };
  }

  /**
   * Build file-level graph from events
   */
  function buildFileLevelGraph(events) {
    const fileNodes = new Map();
    const edges = [];
    const fileEdges = new Map();

    // Group events by file
    events.forEach((event) => {
      const filePath = event.workspace_path || event.file_path || 'unknown';
      if (!fileNodes.has(filePath)) {
        fileNodes.set(filePath, {
          id: `file-${filePath}`,
          label: filePath.split('/').pop() || filePath,
          type: 'file',
          x: undefined,
          y: undefined,
          size: 10,
          color: '#4a9eff',
          metadata: {
            path: filePath,
            eventCount: 0,
            eventTypes: new Set(),
            firstModified: event.timestamp,
            lastModified: event.timestamp,
            sessions: new Set(),
          },
        });
      }

      const fileNode = fileNodes.get(filePath);
      fileNode.metadata.eventCount++;
      if (event.type) {
        fileNode.metadata.eventTypes.add(event.type);
      }
      if (event.session_id) {
        fileNode.metadata.sessions.add(event.session_id);
      }
      if (new Date(event.timestamp) < new Date(fileNode.metadata.firstModified)) {
        fileNode.metadata.firstModified = event.timestamp;
      }
      if (new Date(event.timestamp) > new Date(fileNode.metadata.lastModified)) {
        fileNode.metadata.lastModified = event.timestamp;
      }
    });

    // Convert Sets to Arrays for JSON serialization
    const nodes = Array.from(fileNodes.values()).map((node) => ({
      ...node,
      metadata: {
        ...node.metadata,
        eventTypes: Array.from(node.metadata.eventTypes),
        sessions: Array.from(node.metadata.sessions),
      },
    }));

    // Create co-modification edges (files modified in same session)
    const sessionFiles = new Map();
    events.forEach((event) => {
      const filePath = event.workspace_path || event.file_path || 'unknown';
      const sessionId = event.session_id || 'unknown';
      if (!sessionFiles.has(sessionId)) {
        sessionFiles.set(sessionId, new Set());
      }
      sessionFiles.get(sessionId).add(filePath);
    });

    sessionFiles.forEach((files, sessionId) => {
      const fileArray = Array.from(files);
      for (let i = 0; i < fileArray.length; i++) {
        for (let j = i + 1; j < fileArray.length; j++) {
          const edgeKey = `${fileArray[i]}-${fileArray[j]}`;
          if (!fileEdges.has(edgeKey)) {
            fileEdges.set(edgeKey, {
              id: `edge-${edgeKey}`,
              from: `file-${fileArray[i]}`,
              to: `file-${fileArray[j]}`,
              type: 'co_modified',
              weight: 1,
            });
          } else {
            fileEdges.get(edgeKey).weight++;
          }
        }
      }
    });

    edges.push(...Array.from(fileEdges.values()));

    // Apply force-directed layout
    applyForceLayout(nodes, edges);

    return {
      nodes,
      edges,
      metadata: {
        totalEvents: events.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        computedAt: new Date().toISOString(),
        level: 'file',
      },
    };
  }

  /**
   * Simple force-directed layout algorithm
   */
  function applyForceLayout(nodes, edges, iterations = 50) {
    if (nodes.length === 0) return;

    // Initialize positions in a circle
    const radius = Math.min(800, Math.sqrt(nodes.length) * 20);
    nodes.forEach((node, index) => {
      if (node.x === undefined || node.y === undefined) {
        const angle = (index / nodes.length) * Math.PI * 2;
        node.x = 400 + Math.cos(angle) * radius;
        node.y = 300 + Math.sin(angle) * radius;
      }
    });

    // Force-directed layout iterations
    for (let iter = 0; iter < iterations; iter++) {
      const forces = nodes.map(() => ({ x: 0, y: 0 }));

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 1000 / (distance * distance);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          forces[i].x -= fx;
          forces[i].y -= fy;
          forces[j].x += fx;
          forces[j].y += fy;
        }
      }

      // Attraction along edges
      edges.forEach((edge) => {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);
        if (!fromNode || !toNode) return;

        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = distance * 0.01 * (edge.weight || 1);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        forces[nodes.indexOf(fromNode)].x += fx;
        forces[nodes.indexOf(fromNode)].y += fy;
        forces[nodes.indexOf(toNode)].x -= fx;
        forces[nodes.indexOf(toNode)].y -= fy;
      });

      // Apply forces with damping
      const damping = 0.9;
      nodes.forEach((node, i) => {
        node.x += forces[i].x * damping;
        node.y += forces[i].y * damping;
      });
    }
  }

  /**
   * Get node color based on type
   */
  function getNodeColor(type) {
    const colorMap = {
      file_change: '#4a9eff',
      prompt_sent: '#1bc47d',
      code_change: '#ff6b6b',
      navigation: '#ffa500',
      build: '#9b59b6',
      test: '#e74c3c',
      default: '#888',
    };
    return colorMap[type] || colorMap.default;
  }

  /**
   * Generate cache key for graph
   */
  function generateGraphKey(workspace, level, eventCount) {
    return `graph_${workspace || 'all'}_${level}_${eventCount}`;
  }

  /**
   * Pre-compute graphs for a workspace
   */
  async function precomputeGraphs(workspace = null, limit = 10000) {
    try {
      console.log(`[GRAPH-PRECOMPUTE] Starting pre-computation for workspace: ${workspace || 'all'}`);

      // Fetch events from database
      // Note: getRecentEvents signature is (limit) - we'll filter by workspace if needed
      let events = await persistentDB.getRecentEvents(limit);
      if (workspace) {
        events = events.filter((e) => e.workspace_path === workspace);
      }
      console.log(`[GRAPH-PRECOMPUTE] Fetched ${events.length} events`);

      if (events.length === 0) {
        return {
          success: false,
          error: 'No events found',
        };
      }

      // Build graphs
      const actionGraph = buildActionLevelGraph(events);
      const fileGraph = buildFileLevelGraph(events);

      // Cache graphs
      const actionKey = generateGraphKey(workspace, 'action', events.length);
      const fileKey = generateGraphKey(workspace, 'file', events.length);

      await cache.set(actionKey, actionGraph, 24 * 60 * 60); // 24 hours
      await cache.set(fileKey, fileGraph, 24 * 60 * 60);

      console.log(`[GRAPH-PRECOMPUTE] Pre-computed graphs: ${actionGraph.nodes.length} action nodes, ${fileGraph.nodes.length} file nodes`);

      return {
        success: true,
        actionGraph: {
          nodeCount: actionGraph.nodes.length,
          edgeCount: actionGraph.edges.length,
        },
        fileGraph: {
          nodeCount: fileGraph.nodes.length,
          edgeCount: fileGraph.edges.length,
        },
        eventCount: events.length,
      };
    } catch (error) {
      console.error('[GRAPH-PRECOMPUTE] Error pre-computing graphs:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get pre-computed graph
   */
  async function getPrecomputedGraph(workspace = null, level = 'action', eventCount = null) {
    try {
      // Try to get from cache
      const cacheKey = generateGraphKey(workspace, level, eventCount || 'latest');
      const cached = await cache.get(cacheKey);

      if (cached) {
        return {
          success: true,
          graph: cached,
          cached: true,
        };
      }

      // If not cached, compute on-the-fly
      let events = await persistentDB.getRecentEvents(10000);
      if (workspace) {
        events = events.filter((e) => e.workspace_path === workspace);
      }
      if (events.length === 0) {
        return {
          success: false,
          error: 'No events found',
        };
      }

      const graph = level === 'action' ? buildActionLevelGraph(events) : buildFileLevelGraph(events);

      // Cache it
      const key = generateGraphKey(workspace, level, events.length);
      await cache.set(key, graph, 24 * 60 * 60);

      return {
        success: true,
        graph,
        cached: false,
      };
    } catch (error) {
      console.error('[GRAPH-PRECOMPUTE] Error getting pre-computed graph:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // API endpoint to trigger pre-computation
  app.post('/api/graph/precompute', async (req, res) => {
    try {
      const { workspace, limit } = req.body;
      const result = await precomputeGraphs(workspace, limit || 10000);
      res.json(result);
    } catch (error) {
      console.error('[API] Error in graph pre-compute:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // API endpoint to get pre-computed graph
  app.get('/api/graph/precomputed', async (req, res) => {
    try {
      const { workspace, level = 'action' } = req.query;
      const result = await getPrecomputedGraph(workspace || null, level);
      if (result.success) {
        res.json(result.graph);
      } else {
        res.status(404).json({ error: result.error });
      }
    } catch (error) {
      console.error('[API] Error getting pre-computed graph:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API endpoint to get graph for Explorer (with fallback)
  app.get('/api/activity/graph', async (req, res) => {
    try {
      const { workspace, level = 'action', limit = 10000 } = req.query;

      // Try to get pre-computed graph first
      const precomputed = await getPrecomputedGraph(workspace || null, level);
      if (precomputed.success && precomputed.cached) {
        console.log('[API] Using pre-computed graph');
        return res.json(precomputed.graph);
      }

      // Fallback to on-the-fly computation
      console.log('[API] Computing graph on-the-fly');
      let events = await persistentDB.getRecentEvents(parseInt(limit));
      if (workspace) {
        events = events.filter((e) => e.workspace_path === workspace);
      }
      if (events.length === 0) {
        return res.json({
          nodes: [],
          edges: [],
          metadata: { totalEvents: 0, nodeCount: 0, edgeCount: 0 },
        });
      }

      const graph = level === 'action' ? buildActionLevelGraph(events) : buildFileLevelGraph(events);

      // Cache it for next time
      const key = generateGraphKey(workspace, level, events.length);
      await cache.set(key, graph, 24 * 60 * 60);

      res.json(graph);
    } catch (error) {
      console.error('[API] Error getting graph:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { createGraphPrecomputeRoutes };

