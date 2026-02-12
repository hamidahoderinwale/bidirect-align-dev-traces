/**
 * Graph Query Language
 * Simple query language for graph traversal and filtering
 */

class GraphQuery {
  constructor(graph) {
    this.graph = graph;
    this.nodes = graph.nodes || [];
    this.edges = graph.edges || [];

    // Build indexes for fast lookup
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    this.edgeMap = new Map(); // source -> [edges]
    this.reverseEdgeMap = new Map(); // target -> [edges]

    this.edges.forEach((edge) => {
      if (edge.source) {
        if (!this.edgeMap.has(edge.source)) {
          this.edgeMap.set(edge.source, []);
        }
        this.edgeMap.get(edge.source).push(edge);
      }
      if (edge.target) {
        if (!this.reverseEdgeMap.has(edge.target)) {
          this.reverseEdgeMap.set(edge.target, []);
        }
        this.reverseEdgeMap.get(edge.target).push(edge);
      }
    });
  }

  /**
   * Execute a query
   * @param {object} query - Query object
   * @returns {object} Query results
   */
  execute(query) {
    if (query.type === 'findNodes') {
      return this.findNodes(query.filters || {});
    } else if (query.type === 'findEdges') {
      return this.findEdges(query.filters || {});
    } else if (query.type === 'findPaths') {
      return this.findPaths(query.from, query.to, query.options || {});
    } else if (query.type === 'neighbors') {
      return this.getNeighbors(query.nodeId, query.options || {});
    } else if (query.type === 'subgraph') {
      return this.getSubgraph(query.nodeIds, query.options || {});
    } else {
      throw new Error(`Unknown query type: ${query.type}`);
    }
  }

  /**
   * Find nodes matching filters
   * @param {object} filters - Filter criteria
   * @returns {Array} Matching nodes
   */
  findNodes(filters) {
    let results = [...this.nodes];

    if (filters.type) {
      results = results.filter((n) => n.type === filters.type);
    }

    if (filters.lang) {
      results = results.filter((n) => n.lang === filters.lang);
    }

    if (filters.path) {
      const pathPattern = new RegExp(filters.path);
      results = results.filter((n) => pathPattern.test(n.path));
    }

    if (filters.minDegree !== undefined) {
      results = results.filter((n) => {
        const degree =
          (this.edgeMap.get(n.id)?.length || 0) + (this.reverseEdgeMap.get(n.id)?.length || 0);
        return degree >= filters.minDegree;
      });
    }

    if (filters.maxDegree !== undefined) {
      results = results.filter((n) => {
        const degree =
          (this.edgeMap.get(n.id)?.length || 0) + (this.reverseEdgeMap.get(n.id)?.length || 0);
        return degree <= filters.maxDegree;
      });
    }

    if (filters.hasEdgeType) {
      const edgeType = filters.hasEdgeType;
      results = results.filter((n) => {
        const outEdges = this.edgeMap.get(n.id) || [];
        const inEdges = this.reverseEdgeMap.get(n.id) || [];
        return (
          outEdges.some((e) => e.type === edgeType) || inEdges.some((e) => e.type === edgeType)
        );
      });
    }

    if (filters.metadata) {
      results = results.filter((n) => {
        return Object.entries(filters.metadata).every(([key, value]) => {
          return n.metadata?.[key] === value;
        });
      });
    }

    return results;
  }

  /**
   * Find edges matching filters
   * @param {object} filters - Filter criteria
   * @returns {Array} Matching edges
   */
  findEdges(filters) {
    let results = [...this.edges];

    if (filters.type) {
      results = results.filter((e) => e.type === filters.type);
    }

    if (filters.source) {
      results = results.filter((e) => e.source === filters.source);
    }

    if (filters.target) {
      results = results.filter((e) => e.target === filters.target);
    }

    if (filters.minWeight !== undefined) {
      results = results.filter((e) => (e.weight || 1) >= filters.minWeight);
    }

    if (filters.maxWeight !== undefined) {
      results = results.filter((e) => (e.weight || 1) <= filters.maxWeight);
    }

    return results;
  }

  /**
   * Find paths between two nodes
   * @param {string} from - Source node ID
   * @param {string} to - Target node ID
   * @param {object} options - Options
   * @returns {Array} Array of paths
   */
  findPaths(from, to, options = {}) {
    const maxDepth = options.maxDepth || 10;
    const edgeTypes = options.edgeTypes || null; // Filter by edge types
    const maxPaths = options.maxPaths || 10;

    const paths = [];
    const visited = new Set();

    const dfs = (current, target, path, depth) => {
      if (depth > maxDepth) return;
      if (paths.length >= maxPaths) return;

      if (current === target) {
        paths.push([...path]);
        return;
      }

      visited.add(current);
      const edges = this.edgeMap.get(current) || [];

      for (const edge of edges) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (visited.has(edge.target)) continue;

        path.push(edge.target);
        dfs(edge.target, target, path, depth + 1);
        path.pop();
      }

      visited.delete(current);
    };

    dfs(from, to, [from], 0);
    return paths;
  }

  /**
   * Get neighbors of a node
   * @param {string} nodeId - Node ID
   * @param {object} options - Options
   * @returns {object} Neighbors (incoming, outgoing, all)
   */
  getNeighbors(nodeId, options = {}) {
    const edgeTypes = options.edgeTypes || null;
    const direction = options.direction || 'all'; // 'in', 'out', 'all'

    const incoming = (this.reverseEdgeMap.get(nodeId) || [])
      .filter((e) => !edgeTypes || edgeTypes.includes(e.type))
      .map((e) => ({
        node: this.nodeMap.get(e.source),
        edge: e,
      }))
      .filter((n) => n.node);

    const outgoing = (this.edgeMap.get(nodeId) || [])
      .filter((e) => !edgeTypes || edgeTypes.includes(e.type))
      .map((e) => ({
        node: this.nodeMap.get(e.target),
        edge: e,
      }))
      .filter((n) => n.node);

    if (direction === 'in') {
      return { incoming, outgoing: [], all: incoming };
    } else if (direction === 'out') {
      return { incoming: [], outgoing, all: outgoing };
    } else {
      return { incoming, outgoing, all: [...incoming, ...outgoing] };
    }
  }

  /**
   * Get subgraph containing specified nodes
   * @param {Array} nodeIds - Node IDs to include
   * @param {object} options - Options
   * @returns {object} Subgraph
   */
  getSubgraph(nodeIds, options = {}) {
    const includeNeighbors = options.includeNeighbors || false;
    const edgeTypes = options.edgeTypes || null;

    const nodeSet = new Set(nodeIds);
    const edgeSet = new Set();

    // Add nodes
    const subgraphNodes = nodeIds.map((id) => this.nodeMap.get(id)).filter((n) => n);

    // Add edges between included nodes
    for (const nodeId of nodeIds) {
      const edges = this.edgeMap.get(nodeId) || [];
      for (const edge of edges) {
        if (nodeSet.has(edge.target)) {
          if (!edgeTypes || edgeTypes.includes(edge.type)) {
            edgeSet.add(edge);
          }
        }
      }
    }

    // Optionally include neighbors
    if (includeNeighbors) {
      for (const nodeId of nodeIds) {
        const neighbors = this.getNeighbors(nodeId, { edgeTypes });
        for (const neighbor of neighbors.all) {
          if (!nodeSet.has(neighbor.node.id)) {
            nodeSet.add(neighbor.node.id);
            subgraphNodes.push(neighbor.node);
          }
        }
      }
    }

    const subgraphEdges = Array.from(edgeSet);

    return {
      nodes: subgraphNodes,
      edges: subgraphEdges,
      metadata: {
        nodeCount: subgraphNodes.length,
        edgeCount: subgraphEdges.length,
      },
    };
  }
}

module.exports = GraphQuery;
