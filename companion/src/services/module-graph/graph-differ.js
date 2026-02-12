/**
 * Graph Differ
 * Compares graphs at different timestamps and tracks changes
 */

class GraphDiffer {
  constructor() {
    this.changeCache = new Map(); // Cache diff results
  }

  /**
   * Compare two graphs
   * @param {object} graph1 - First graph (older)
   * @param {object} graph2 - Second graph (newer)
   * @param {object} options - Options
   * @returns {object} Diff results
   */
  diff(graph1, graph2, options = {}) {
    const cacheKey = this.getCacheKey(graph1, graph2);
    if (this.changeCache.has(cacheKey) && !options.forceRecalculate) {
      return this.changeCache.get(cacheKey);
    }

    const diff = {
      nodes: this.diffNodes(graph1.nodes || [], graph2.nodes || []),
      edges: this.diffEdges(graph1.edges || [], graph2.edges || []),
      metadata: this.diffMetadata(graph1.metadata || {}, graph2.metadata || {}),
      summary: {},
    };

    // Calculate summary
    diff.summary = {
      nodesAdded: diff.nodes.added.length,
      nodesRemoved: diff.nodes.removed.length,
      nodesModified: diff.nodes.modified.length,
      edgesAdded: diff.edges.added.length,
      edgesRemoved: diff.edges.removed.length,
      edgesModified: diff.edges.modified.length,
      totalChanges:
        diff.nodes.added.length +
        diff.nodes.removed.length +
        diff.nodes.modified.length +
        diff.edges.added.length +
        diff.edges.removed.length +
        diff.edges.modified.length,
    };

    this.changeCache.set(cacheKey, diff);
    return diff;
  }

  /**
   * Diff nodes between two graphs
   * @param {Array} nodes1 - First graph nodes
   * @param {Array} nodes2 - Second graph nodes
   * @returns {object} Node diff
   */
  diffNodes(nodes1, nodes2) {
    const nodeMap1 = new Map(nodes1.map((n) => [n.id, n]));
    const nodeMap2 = new Map(nodes2.map((n) => [n.id, n]));

    const added = [];
    const removed = [];
    const modified = [];

    // Find added and modified nodes
    for (const node2 of nodes2) {
      const node1 = nodeMap1.get(node2.id);
      if (!node1) {
        added.push(node2);
      } else if (!this.nodesEqual(node1, node2)) {
        modified.push({
          id: node2.id,
          before: node1,
          after: node2,
          changes: this.getNodeChanges(node1, node2),
        });
      }
    }

    // Find removed nodes
    for (const node1 of nodes1) {
      if (!nodeMap2.has(node1.id)) {
        removed.push(node1);
      }
    }

    return { added, removed, modified };
  }

  /**
   * Diff edges between two graphs
   * @param {Array} edges1 - First graph edges
   * @param {Array} edges2 - Second graph edges
   * @returns {object} Edge diff
   */
  diffEdges(edges1, edges2) {
    const edgeKey1 = new Map();
    const edgeKey2 = new Map();

    // Create edge keys: "source:target:type"
    edges1.forEach((e) => {
      const key = `${e.source}:${e.target}:${e.type}`;
      edgeKey1.set(key, e);
    });

    edges2.forEach((e) => {
      const key = `${e.source}:${e.target}:${e.type}`;
      edgeKey2.set(key, e);
    });

    const added = [];
    const removed = [];
    const modified = [];

    // Find added and modified edges
    for (const [key, edge2] of edgeKey2.entries()) {
      const edge1 = edgeKey1.get(key);
      if (!edge1) {
        added.push(edge2);
      } else if (!this.edgesEqual(edge1, edge2)) {
        modified.push({
          key,
          before: edge1,
          after: edge2,
          changes: this.getEdgeChanges(edge1, edge2),
        });
      }
    }

    // Find removed edges
    for (const [key, edge1] of edgeKey1.entries()) {
      if (!edgeKey2.has(key)) {
        removed.push(edge1);
      }
    }

    return { added, removed, modified };
  }

  /**
   * Diff metadata
   * @param {object} metadata1 - First metadata
   * @param {object} metadata2 - Second metadata
   * @returns {object} Metadata diff
   */
  diffMetadata(metadata1, metadata2) {
    const changes = {};
    const allKeys = new Set([...Object.keys(metadata1), ...Object.keys(metadata2)]);

    for (const key of allKeys) {
      const val1 = metadata1[key];
      const val2 = metadata2[key];
      if (val1 !== val2) {
        changes[key] = {
          before: val1,
          after: val2,
        };
      }
    }

    return changes;
  }

  /**
   * Check if two nodes are equal
   * @param {object} node1 - First node
   * @param {object} node2 - Second node
   * @returns {boolean} Are equal
   */
  nodesEqual(node1, node2) {
    // Compare key properties
    return (
      node1.id === node2.id &&
      node1.type === node2.type &&
      node1.path === node2.path &&
      JSON.stringify(node1.metadata) === JSON.stringify(node2.metadata)
    );
  }

  /**
   * Check if two edges are equal
   * @param {object} edge1 - First edge
   * @param {object} edge2 - Second edge
   * @returns {boolean} Are equal
   */
  edgesEqual(edge1, edge2) {
    return (
      edge1.source === edge2.source &&
      edge1.target === edge2.target &&
      edge1.type === edge2.type &&
      edge1.weight === edge2.weight
    );
  }

  /**
   * Get changes between two nodes
   * @param {object} node1 - First node
   * @param {object} node2 - Second node
   * @returns {Array} List of changed properties
   */
  getNodeChanges(node1, node2) {
    const changes = [];
    const props = ['type', 'path', 'lang', 'size_bucket', 'interaction_counts', 'metadata'];

    for (const prop of props) {
      if (JSON.stringify(node1[prop]) !== JSON.stringify(node2[prop])) {
        changes.push(prop);
      }
    }

    return changes;
  }

  /**
   * Get changes between two edges
   * @param {object} edge1 - First edge
   * @param {object} edge2 - Second edge
   * @returns {Array} List of changed properties
   */
  getEdgeChanges(edge1, edge2) {
    const changes = [];
    const props = ['weight', 'metadata', 'subtype'];

    for (const prop of props) {
      if (JSON.stringify(edge1[prop]) !== JSON.stringify(edge2[prop])) {
        changes.push(prop);
      }
    }

    return changes;
  }

  /**
   * Get cache key for two graphs
   * @param {object} graph1 - First graph
   * @param {object} graph2 - Second graph
   * @returns {string} Cache key
   */
  getCacheKey(graph1, graph2) {
    const time1 = graph1.metadata?.builtAt || '';
    const time2 = graph2.metadata?.builtAt || '';
    return `${time1}_${time2}`;
  }

  /**
   * Clear diff cache
   */
  clearCache() {
    this.changeCache.clear();
  }
}

module.exports = GraphDiffer;
