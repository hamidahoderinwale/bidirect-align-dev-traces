/**
 * Community Detection
 * Implements Louvain algorithm for community detection
 */

const { getConfig } = require('./config');

class CommunityDetector {
  constructor() {
    this.algorithm = getConfig('analysis.communities.algorithm', 'louvain');
    this.resolution = getConfig('analysis.communities.resolution', 1.0);
  }

  /**
   * Detect communities in graph
   * @param {object} graph - Graph object with nodes and edges
   * @param {object} options - Options
   * @returns {object} Community detection results
   */
  detectCommunities(graph, options = {}) {
    if (!getConfig('analysis.communities.enabled', true)) {
      return { communities: [], modularity: 0 };
    }

    const algorithm = options.algorithm || this.algorithm;

    if (algorithm === 'louvain') {
      return this.louvainAlgorithm(graph, options);
    } else {
      // Fallback to simple connected components
      return this.simpleCommunities(graph);
    }
  }

  /**
   * Louvain algorithm for community detection
   * @param {object} graph - Graph object
   * @param {object} options - Options
   * @returns {object} Communities and modularity
   */
  louvainAlgorithm(graph, options = {}) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const resolution = options.resolution || this.resolution;

    // Initialize: each node in its own community
    const communities = new Map();
    const nodeToCommunity = new Map();
    nodes.forEach((node, i) => {
      communities.set(i, [node.id]);
      nodeToCommunity.set(node.id, i);
    });

    // Build adjacency and weights
    const adj = new Map();
    const weights = new Map();
    let totalWeight = 0;

    nodes.forEach((node) => {
      adj.set(node.id, []);
      weights.set(node.id, 0);
    });

    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        const weight = edge.weight || 1;
        adj.get(edge.source).push(edge.target);
        adj.get(edge.target).push(edge.source);
        weights.set(edge.source, (weights.get(edge.source) || 0) + weight);
        weights.set(edge.target, (weights.get(edge.target) || 0) + weight);
        totalWeight += weight;
      }
    });

    // Calculate initial modularity
    let modularity = this.calculateModularity(
      nodes,
      edges,
      nodeToCommunity,
      adj,
      weights,
      totalWeight,
      resolution
    );

    let improved = true;
    let iterations = 0;
    const maxIterations = 100;

    // Iterate until no improvement
    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      // Try moving each node to neighboring communities
      for (const node of nodes) {
        const currentCommunity = nodeToCommunity.get(node.id);
        const neighbors = adj.get(node.id) || [];
        const neighborCommunities = new Set(neighbors.map((n) => nodeToCommunity.get(n)));

        let bestCommunity = currentCommunity;
        let bestModularity = modularity;

        // Try each neighboring community
        for (const communityId of neighborCommunities) {
          if (communityId === currentCommunity) continue;

          // Move node to this community
          nodeToCommunity.set(node.id, communityId);
          const currentCommNodes = communities.get(currentCommunity);
          communities.set(
            currentCommunity,
            currentCommNodes.filter((id) => id !== node.id)
          );
          communities.get(communityId).push(node.id);

          // Calculate new modularity
          const newModularity = this.calculateModularity(
            nodes,
            edges,
            nodeToCommunity,
            adj,
            weights,
            totalWeight,
            resolution
          );

          if (newModularity > bestModularity) {
            bestModularity = newModularity;
            bestCommunity = communityId;
            improved = true;
          } else {
            // Revert
            nodeToCommunity.set(node.id, currentCommunity);
            communities.get(communityId).pop();
            communities.get(currentCommunity).push(node.id);
          }
        }

        if (bestCommunity !== currentCommunity) {
          nodeToCommunity.set(node.id, bestCommunity);
          modularity = bestModularity;
        }
      }
    }

    // Convert to array format
    const communityArray = Array.from(communities.values())
      .filter((comm) => comm.length > 0)
      .map((comm, idx) => ({
        id: idx,
        nodes: comm,
        size: comm.length,
      }));

    return {
      communities: communityArray,
      modularity,
      iterations,
    };
  }

  /**
   * Calculate modularity
   * @param {Array} nodes - Nodes
   * @param {Array} edges - Edges
   * @param {Map} nodeToCommunity - Node to community mapping
   * @param {Map} adj - Adjacency list
   * @param {Map} weights - Node weights
   * @param {number} totalWeight - Total edge weight
   * @param {number} resolution - Resolution parameter
   * @returns {number} Modularity score
   */
  calculateModularity(nodes, edges, nodeToCommunity, adj, weights, totalWeight, resolution) {
    if (totalWeight === 0) return 0;

    let modularity = 0;
    const communityMap = new Map();

    // Group nodes by community
    nodes.forEach((node) => {
      const commId = nodeToCommunity.get(node.id);
      if (!communityMap.has(commId)) {
        communityMap.set(commId, []);
      }
      communityMap.get(commId).push(node.id);
    });

    // Calculate modularity for each community
    for (const [commId, commNodes] of communityMap.entries()) {
      let edgesInCommunity = 0;
      let degreeSum = 0;

      for (const nodeId of commNodes) {
        degreeSum += weights.get(nodeId) || 0;
        const neighbors = adj.get(nodeId) || [];
        for (const neighbor of neighbors) {
          if (nodeToCommunity.get(neighbor) === commId) {
            // Find edge weight
            const edge = edges.find(
              (e) =>
                (e.source === nodeId && e.target === neighbor) ||
                (e.source === neighbor && e.target === nodeId)
            );
            edgesInCommunity += edge?.weight || 1;
          }
        }
      }

      // Divide by 2 because we counted each edge twice
      edgesInCommunity = edgesInCommunity / 2;

      const expectedEdges = (degreeSum * degreeSum) / (2 * totalWeight);
      modularity += edgesInCommunity / totalWeight - resolution * (expectedEdges / totalWeight);
    }

    return modularity;
  }

  /**
   * Simple community detection using connected components
   * @param {object} graph - Graph object
   * @returns {object} Communities
   */
  simpleCommunities(graph) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    // Build undirected adjacency list
    const adj = new Map();
    nodes.forEach((node) => adj.set(node.id, []));
    edges.forEach((edge) => {
      if (edge.source && edge.target) {
        adj.get(edge.source).push(edge.target);
        adj.get(edge.target).push(edge.source);
      }
    });

    const visited = new Set();
    const communities = [];

    const dfs = (nodeId, community) => {
      visited.add(nodeId);
      community.push(nodeId);
      const neighbors = adj.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, community);
        }
      }
    };

    nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        const community = [];
        dfs(node.id, community);
        communities.push({
          id: communities.length,
          nodes: community,
          size: community.length,
        });
      }
    });

    return {
      communities,
      modularity: 0, // Not calculated for simple communities
    };
  }
}

module.exports = CommunityDetector;
