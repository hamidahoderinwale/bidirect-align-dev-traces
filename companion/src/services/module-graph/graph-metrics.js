/**
 * Graph Metrics Calculator
 * Calculates various graph metrics: centrality, clustering, etc.
 */

const { getConfig } = require('./config');

class GraphMetricsCalculator {
  constructor() {
    this.cache = new Map(); // Cache calculated metrics
  }

  /**
   * Calculate all metrics for a graph
   * @param {object} graph - Graph object with nodes and edges
   * @param {object} options - Options
   * @returns {object} Calculated metrics
   */
  calculateAllMetrics(graph, options = {}) {
    const cacheKey = this.getCacheKey(graph);
    if (this.cache.has(cacheKey) && !options.forceRecalculate) {
      return this.cache.get(cacheKey);
    }

    const metrics = {
      basic: this.calculateBasicMetrics(graph),
      centrality: getConfig('analysis.metrics.includeCentrality', true)
        ? this.calculateCentralityMetrics(graph)
        : {},
      clustering: getConfig('analysis.metrics.includeClustering', true)
        ? this.calculateClusteringMetrics(graph)
        : {},
      structure: this.calculateStructuralMetrics(graph),
    };

    this.cache.set(cacheKey, metrics);
    return metrics;
  }

  /**
   * Calculate basic graph metrics
   * @param {object} graph - Graph object
   * @returns {object} Basic metrics
   */
  calculateBasicMetrics(graph) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    // Count nodes by type
    const nodesByType = {};
    nodes.forEach((node) => {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    });

    // Count edges by type
    const edgesByType = {};
    edges.forEach((edge) => {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    });

    // Calculate average degree
    const nodeDegrees = this.calculateNodeDegrees(nodes, edges);
    const degrees = Array.from(nodeDegrees.values());
    const avgDegree = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodesByType,
      edgesByType,
      averageDegree: avgDegree,
      density: this.calculateDensity(nodes.length, edges.length),
    };
  }

  /**
   * Calculate centrality metrics
   * @param {object} graph - Graph object
   * @returns {object} Centrality metrics
   */
  calculateCentralityMetrics(graph) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Build adjacency lists
    const inEdges = new Map(); // target -> [sources]
    const outEdges = new Map(); // source -> [targets]

    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        if (!outEdges.has(edge.source)) outEdges.set(edge.source, []);
        if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
        outEdges.get(edge.source).push(edge.target);
        inEdges.get(edge.target).push(edge.source);
      }
    });

    const degreeCentrality = this.calculateDegreeCentrality(nodes, inEdges, outEdges);
    const betweennessCentrality = getConfig('analysis.metrics.includeBetweenness', true)
      ? this.calculateBetweennessCentrality(nodes, edges)
      : {};
    const closenessCentrality = getConfig('analysis.metrics.includeCloseness', true)
      ? this.calculateClosenessCentrality(nodes, edges)
      : {};

    // Find hub nodes (high out-degree)
    const hubNodes = Array.from(degreeCentrality.entries())
      .filter(([id, metrics]) => metrics.outDegree > 5)
      .sort((a, b) => b[1].outDegree - a[1].outDegree)
      .slice(0, 10)
      .map(([id]) => id);

    // Find isolated nodes (no edges)
    const isolatedNodes = nodes
      .filter((n) => !inEdges.has(n.id) && !outEdges.has(n.id))
      .map((n) => n.id);

    return {
      degree: Object.fromEntries(degreeCentrality),
      betweenness: betweennessCentrality,
      closeness: closenessCentrality,
      hubNodes,
      isolatedNodes,
    };
  }

  /**
   * Calculate degree centrality
   * @param {Array} nodes - Nodes
   * @param {Map} inEdges - Incoming edges map
   * @param {Map} outEdges - Outgoing edges map
   * @returns {Map} Node ID -> {inDegree, outDegree, totalDegree}
   */
  calculateDegreeCentrality(nodes, inEdges, outEdges) {
    const centrality = new Map();

    nodes.forEach((node) => {
      const inDegree = inEdges.get(node.id)?.length || 0;
      const outDegree = outEdges.get(node.id)?.length || 0;
      const totalDegree = inDegree + outDegree;

      centrality.set(node.id, {
        inDegree,
        outDegree,
        totalDegree,
        normalized: nodes.length > 1 ? totalDegree / (nodes.length - 1) : 0,
      });
    });

    return centrality;
  }

  /**
   * Calculate betweenness centrality (simplified - uses shortest paths)
   * @param {Array} nodes - Nodes
   * @param {Array} edges - Edges
   * @returns {object} Node ID -> betweenness value
   */
  calculateBetweennessCentrality(nodes, edges) {
    // Simplified implementation - for production, use Brandes algorithm
    const betweenness = {};
    nodes.forEach((node) => {
      betweenness[node.id] = 0;
    });

    // Build adjacency list
    const adj = new Map();
    nodes.forEach((node) => adj.set(node.id, []));
    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        adj.get(edge.source).push(edge.target);
      }
    });

    // For each node, calculate shortest paths through it
    // This is a simplified version - full implementation would use BFS/DFS
    nodes.forEach((node) => {
      let pathsThrough = 0;
      // Sample a subset of node pairs for performance
      const sampleSize = Math.min(100, nodes.length);
      const sampleNodes = nodes.slice(0, sampleSize);

      for (let i = 0; i < sampleNodes.length; i++) {
        for (let j = i + 1; j < sampleNodes.length; j++) {
          const source = sampleNodes[i].id;
          const target = sampleNodes[j].id;
          if (source === node.id || target === node.id) continue;

          // Check if shortest path goes through this node
          const path = this.findShortestPath(source, target, adj);
          if (path && path.includes(node.id)) {
            pathsThrough++;
          }
        }
      }

      betweenness[node.id] = pathsThrough;
    });

    return betweenness;
  }

  /**
   * Calculate closeness centrality
   * @param {Array} nodes - Nodes
   * @param {Array} edges - Edges
   * @returns {object} Node ID -> closeness value
   */
  calculateClosenessCentrality(nodes, edges) {
    const closeness = {};

    // Build adjacency list
    const adj = new Map();
    nodes.forEach((node) => adj.set(node.id, []));
    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        adj.get(edge.source).push(edge.target);
        // Make undirected for closeness
        adj.get(edge.target).push(edge.source);
      }
    });

    nodes.forEach((node) => {
      const distances = this.calculateDistances(node.id, adj);
      const reachable = Object.values(distances).filter((d) => d !== Infinity);
      const sumDistances = reachable.reduce((a, b) => a + b, 0);

      closeness[node.id] = reachable.length > 0 ? reachable.length / sumDistances : 0;
    });

    return closeness;
  }

  /**
   * Calculate clustering coefficient
   * @param {object} graph - Graph object
   * @returns {object} Clustering metrics
   */
  calculateClusteringMetrics(graph) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    // Build adjacency list (undirected)
    const adj = new Map();
    nodes.forEach((node) => adj.set(node.id, new Set()));
    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        adj.get(edge.source).add(edge.target);
        adj.get(edge.target).add(edge.source);
      }
    });

    const coefficients = {};
    let totalCoefficient = 0;
    let nodesWithNeighbors = 0;

    nodes.forEach((node) => {
      const neighbors = Array.from(adj.get(node.id));
      if (neighbors.length < 2) {
        coefficients[node.id] = 0;
        return;
      }

      // Count edges between neighbors
      let edgesBetweenNeighbors = 0;
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          if (adj.get(neighbors[i]).has(neighbors[j])) {
            edgesBetweenNeighbors++;
          }
        }
      }

      const possibleEdges = (neighbors.length * (neighbors.length - 1)) / 2;
      const coefficient = possibleEdges > 0 ? edgesBetweenNeighbors / possibleEdges : 0;

      coefficients[node.id] = coefficient;
      totalCoefficient += coefficient;
      nodesWithNeighbors++;
    });

    return {
      coefficients,
      averageClustering: nodesWithNeighbors > 0 ? totalCoefficient / nodesWithNeighbors : 0,
    };
  }

  /**
   * Calculate structural metrics
   * @param {object} graph - Graph object
   * @returns {object} Structural metrics
   */
  calculateStructuralMetrics(graph) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    // Check for cycles (simplified)
    const hasCycles = this.detectCycles(nodes, edges);

    // Calculate connected components
    const components = this.findConnectedComponents(nodes, edges);

    return {
      hasCycles,
      connectedComponents: components.length,
      largestComponent: components.length > 0 ? Math.max(...components.map((c) => c.length)) : 0,
    };
  }

  /**
   * Calculate node degrees
   * @param {Array} nodes - Nodes
   * @param {Array} edges - Edges
   * @returns {Map} Node ID -> degree
   */
  calculateNodeDegrees(nodes, edges) {
    const degrees = new Map();
    nodes.forEach((node) => degrees.set(node.id, 0));

    edges.forEach((edge) => {
      if (edge.source) degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
      if (edge.target) degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
    });

    return degrees;
  }

  /**
   * Calculate graph density
   * @param {number} nodeCount - Number of nodes
   * @param {number} edgeCount - Number of edges
   * @returns {number} Density (0-1)
   */
  calculateDensity(nodeCount, edgeCount) {
    if (nodeCount < 2) return 0;
    const maxEdges = (nodeCount * (nodeCount - 1)) / 2;
    return maxEdges > 0 ? edgeCount / maxEdges : 0;
  }

  /**
   * Find shortest path using BFS
   * @param {string} source - Source node ID
   * @param {string} target - Target node ID
   * @param {Map} adj - Adjacency list
   * @returns {Array|null} Path or null
   */
  findShortestPath(source, target, adj) {
    const queue = [[source]];
    const visited = new Set([source]);

    while (queue.length > 0) {
      const path = queue.shift();
      const node = path[path.length - 1];

      if (node === target) {
        return path;
      }

      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }

    return null;
  }

  /**
   * Calculate distances from a source node
   * @param {string} source - Source node ID
   * @param {Map} adj - Adjacency list
   * @returns {object} Node ID -> distance
   */
  calculateDistances(source, adj) {
    const distances = {};
    const queue = [{ node: source, dist: 0 }];
    const visited = new Set([source]);
    distances[source] = 0;

    while (queue.length > 0) {
      const { node, dist } = queue.shift();
      const neighbors = adj.get(node) || [];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          distances[neighbor] = dist + 1;
          queue.push({ node: neighbor, dist: dist + 1 });
        }
      }
    }

    return distances;
  }

  /**
   * Detect cycles in graph
   * @param {Array} nodes - Nodes
   * @param {Array} edges - Edges
   * @returns {boolean} Has cycles
   */
  detectCycles(nodes, edges) {
    // Simplified cycle detection using DFS
    const adj = new Map();
    nodes.forEach((node) => adj.set(node.id, []));
    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        adj.get(edge.source).push(edge.target);
      }
    });

    const visited = new Set();
    const recStack = new Set();

    const hasCycle = (node) => {
      if (recStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      recStack.add(node);

      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor)) return true;
      }

      recStack.delete(node);
      return false;
    };

    for (const node of nodes) {
      if (!visited.has(node.id) && hasCycle(node.id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find connected components
   * @param {Array} nodes - Nodes
   * @param {Array} edges - Edges
   * @returns {Array} Array of component arrays
   */
  findConnectedComponents(nodes, edges) {
    const adj = new Map();
    nodes.forEach((node) => adj.set(node.id, []));
    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        adj.get(edge.source).push(edge.target);
        adj.get(edge.target).push(edge.source);
      }
    });

    const visited = new Set();
    const components = [];

    const dfs = (node, component) => {
      visited.add(node);
      component.push(node);
      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, component);
        }
      }
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        const component = [];
        dfs(node.id, component);
        components.push(component);
      }
    }

    return components;
  }

  /**
   * Get cache key for graph
   * @param {object} graph - Graph object
   * @returns {string} Cache key
   */
  getCacheKey(graph) {
    const nodeCount = graph.nodes?.length || 0;
    const edgeCount = graph.edges?.length || 0;
    return `${nodeCount}_${edgeCount}_${graph.metadata?.builtAt || ''}`;
  }

  /**
   * Clear metrics cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = GraphMetricsCalculator;
