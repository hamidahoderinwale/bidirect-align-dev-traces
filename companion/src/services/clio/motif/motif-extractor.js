/**
 * Motif Extractor (Rung 6)
 * Extracts recurring procedural patterns (motifs) from canonical workflow DAGs
 */

class MotifExtractor {
  constructor(options = {}) {
    this.minClusterSize = options.minClusterSize || 10;
    this.similarityThreshold = options.similarityThreshold || 0.7;
    this.maxMotifLength = options.maxMotifLength || 20;
  }

  /**
   * Extract motifs from canonical workflow DAGs
   * Input: Array of canonical DAGs (from Rung 5)
   * Output: Array of motif objects
   */
  async extractMotifs(canonicalDAGs) {
    if (!canonicalDAGs || canonicalDAGs.length === 0) {
      return [];
    }

    // Step 1: Convert DAGs to motif-friendly representations
    const representations = this.convertDAGsToRepresentations(canonicalDAGs);

    // Step 2: Cluster similar representations
    const clusters = await this.clusterRepresentations(representations);

    // Step 3: Extract motif from each cluster
    const motifs = [];
    for (const cluster of clusters) {
      if (cluster.items.length >= this.minClusterSize) {
        const motif = await this.extractMotifFromCluster(cluster, canonicalDAGs);
        if (motif) {
          motifs.push(motif);
        }
      }
    }

    // Step 4: Sort by frequency
    motifs.sort((a, b) => b.frequency - a.frequency);

    return motifs;
  }

  /**
   * Convert DAGs to motif-friendly representations
   * Options: Sequence abstraction, graph signatures, or frequent subgraph mining
   */
  convertDAGsToRepresentations(dags) {
    return dags.map((dag, index) => {
      // Option A: Sequence abstraction (extract main spine)
      const sequence = this.extractSequenceAbstraction(dag);

      // Option B: Graph signature (adjacency fingerprint)
      const signature = this.computeGraphSignature(dag);

      return {
        dagIndex: index,
        dag: dag,
        sequence: sequence,
        signature: signature,
        length: sequence.length,
      };
    });
  }

  /**
   * Extract sequence abstraction from DAG (main spine)
   */
  extractSequenceAbstraction(dag) {
    // Find the longest path through the DAG
    // This represents the "main spine" of the workflow
    const nodes = dag.nodes || [];
    const edges = dag.edges || [];

    if (nodes.length === 0) {
      return [];
    }

    // Build adjacency list
    const adj = new Map();
    const inDegree = new Map();

    nodes.forEach((node) => {
      adj.set(node.id, []);
      inDegree.set(node.id, 0);
    });

    edges.forEach((edge) => {
      adj.get(edge.from).push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    });

    // Find start nodes (in-degree = 0)
    const startNodes = nodes.filter((node) => inDegree.get(node.id) === 0);

    if (startNodes.length === 0) {
      // No clear start, use first node
      return this.extractSequenceFromNode(nodes[0].id, adj, nodes);
    }

    // Find longest path from each start node
    let longestPath = [];
    for (const start of startNodes) {
      const path = this.findLongestPath(start.id, adj, nodes);
      if (path.length > longestPath.length) {
        longestPath = path;
      }
    }

    // Convert to canonical sequence
    return longestPath.map((nodeId) => {
      const node = nodes.find((n) => n.id === nodeId);
      return this.canonicalizeEvent(node);
    });
  }

  /**
   * Find longest path from a node (DFS)
   */
  findLongestPath(startId, adj, nodes) {
    const visited = new Set();
    const path = [];

    const dfs = (nodeId) => {
      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      path.push(nodeId);

      const neighbors = adj.get(nodeId) || [];
      let maxLength = 0;
      let bestNext = null;

      for (const neighbor of neighbors) {
        const neighborPath = this.findLongestPath(neighbor, adj, nodes);
        if (neighborPath.length > maxLength) {
          maxLength = neighborPath.length;
          bestNext = neighbor;
        }
      }

      if (bestNext) {
        dfs(bestNext);
      }
    };

    dfs(startId);
    return path;
  }

  /**
   * Extract sequence from a specific node
   */
  extractSequenceFromNode(nodeId, adj, nodes) {
    const sequence = [nodeId];
    const visited = new Set([nodeId]);

    let current = nodeId;
    while (true) {
      const neighbors = adj.get(current) || [];
      const unvisited = neighbors.filter((n) => !visited.has(n));

      if (unvisited.length === 0) {
        break;
      }

      // Take first unvisited neighbor (or most common path)
      current = unvisited[0];
      sequence.push(current);
      visited.add(current);
    }

    return sequence;
  }

  /**
   * Canonicalize event node to motif representation
   */
  canonicalizeEvent(node) {
    const eventType = node.type || 'UNKNOWN';
    const intent = node.intent || null;

    // Map to canonical forms
    const canonicalMap = {
      code_change: 'EDIT',
      file_change: 'EDIT',
      terminal: 'RUN',
      error: 'ERROR',
      navigation: 'NAVIGATE',
      ai_suggestion: 'MODEL_SUGGEST',
      prompt: 'PROMPT',
    };

    let canonical = canonicalMap[eventType] || eventType.toUpperCase();

    // Add intent modifier if available
    if (intent) {
      const intentMap = {
        fix: 'fix',
        add: 'add',
        refactor: 'refactor',
        test: 'test',
        document: 'document',
      };
      const intentModifier = intentMap[intent.toLowerCase()] || intent.toLowerCase();
      canonical = `${canonical}(${intentModifier})`;
    }

    return canonical;
  }

  /**
   * Compute graph signature (adjacency fingerprint)
   */
  computeGraphSignature(dag) {
    const nodes = dag.nodes || [];
    const edges = dag.edges || [];

    // Create adjacency matrix fingerprint
    const nodeTypes = new Map();
    nodes.forEach((node) => {
      const canonical = this.canonicalizeEvent(node);
      nodeTypes.set(node.id, canonical);
    });

    // Build adjacency signature
    const signature = {
      nodeTypes: Array.from(nodeTypes.values()).sort(),
      edgeCount: edges.length,
      nodeCount: nodes.length,
      cycles: this.detectCycles(dag),
      branchingFactor: this.computeBranchingFactor(dag),
    };

    return JSON.stringify(signature);
  }

  /**
   * Detect cycles in DAG (should be minimal, but check anyway)
   */
  detectCycles(dag) {
    const nodes = dag.nodes || [];
    const edges = dag.edges || [];

    // Build adjacency list
    const adj = new Map();
    nodes.forEach((node) => {
      adj.set(node.id, []);
    });
    edges.forEach((edge) => {
      adj.get(edge.from).push(edge.to);
    });

    // DFS to detect cycles
    const visited = new Set();
    const recStack = new Set();
    let cycleCount = 0;

    const hasCycle = (nodeId) => {
      visited.add(nodeId);
      recStack.add(nodeId);

      for (const neighbor of adj.get(nodeId) || []) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) {
            cycleCount++;
            return true;
          }
        } else if (recStack.has(neighbor)) {
          cycleCount++;
          return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        hasCycle(node.id);
      }
    }

    return cycleCount;
  }

  /**
   * Compute average branching factor
   */
  computeBranchingFactor(dag) {
    const edges = dag.edges || [];
    const nodes = dag.nodes || [];

    if (nodes.length === 0) return 0;

    const outDegree = new Map();
    nodes.forEach((node) => {
      outDegree.set(node.id, 0);
    });

    edges.forEach((edge) => {
      outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
    });

    const totalOutDegree = Array.from(outDegree.values()).reduce((a, b) => a + b, 0);
    return totalOutDegree / nodes.length;
  }

  /**
   * Cluster representations using similarity
   */
  async clusterRepresentations(representations) {
    // Use sequence-based clustering (DTW or edit distance)
    // For now, use simple sequence similarity

    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < representations.length; i++) {
      if (assigned.has(i)) continue;

      const cluster = {
        id: `cluster_${clusters.length}`,
        items: [i],
        centroid: representations[i],
      };

      // Find similar representations
      for (let j = i + 1; j < representations.length; j++) {
        if (assigned.has(j)) continue;

        const similarity = this.computeSequenceSimilarity(
          representations[i].sequence,
          representations[j].sequence
        );

        if (similarity >= this.similarityThreshold) {
          cluster.items.push(j);
          assigned.add(j);
        }
      }

      if (cluster.items.length >= this.minClusterSize) {
        clusters.push(cluster);
        assigned.add(i);
      }
    }

    return clusters;
  }

  /**
   * Compute sequence similarity (edit distance normalized)
   */
  computeSequenceSimilarity(seq1, seq2) {
    if (!seq1 || !seq2 || seq1.length === 0 || seq2.length === 0) {
      return 0;
    }

    // Use longest common subsequence (LCS) ratio
    const lcs = this.longestCommonSubsequence(seq1, seq2);
    const maxLen = Math.max(seq1.length, seq2.length);

    return lcs / maxLen;
  }

  /**
   * Longest Common Subsequence
   */
  longestCommonSubsequence(seq1, seq2) {
    const m = seq1.length;
    const n = seq2.length;
    const dp = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (seq1[i - 1] === seq2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Extract motif from cluster
   */
  async extractMotifFromCluster(cluster, originalDAGs) {
    const clusterDAGs = cluster.items.map((idx) => originalDAGs[idx]);

    // Build consensus sequence
    const consensusSequence = this.buildConsensusSequence(
      cluster.items.map((idx) => {
        const rep = cluster.centroid;
        return rep.sequence;
      })
    );

    // Compute intent distribution
    const intentDistribution = this.computeIntentDistribution(clusterDAGs);

    // Determine dominant intent
    const dominantIntent =
      Object.entries(intentDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';

    // Determine motif shape
    const motifShape = this.determineMotifShape(consensusSequence);

    // Compute structural stats
    const stats = this.computeStructuralStats(clusterDAGs);

    // Compute privacy indicators
    const privacy = {
      clusterSize: cluster.items.length,
      safeRungs: [6, 7], // Motif rung and above are safe
      meetsThreshold: cluster.items.length >= this.minClusterSize,
    };

    // Generate motif ID
    const motifId = `MOTIF_${String(clusters.length + 1).padStart(3, '0')}`;

    return {
      id: motifId,
      pattern: consensusSequence.join(' → '),
      sequence: consensusSequence,
      intents: intentDistribution,
      dominantIntent: dominantIntent,
      shape: motifShape,
      stats: stats,
      privacy: privacy,
      frequency: cluster.items.length,
      confidence: this.computeClusterConfidence(cluster),
    };
  }

  /**
   * Build consensus sequence from multiple sequences
   */
  buildConsensusSequence(sequences) {
    if (sequences.length === 0) return [];
    if (sequences.length === 1) return sequences[0];

    // Use most common sequence as base
    const sequenceCounts = new Map();
    sequences.forEach((seq) => {
      const key = seq.join('|');
      sequenceCounts.set(key, (sequenceCounts.get(key) || 0) + 1);
    });

    const mostCommon = Array.from(sequenceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!mostCommon) return sequences[0];

    return mostCommon.split('|');
  }

  /**
   * Compute intent distribution from DAGs
   */
  computeIntentDistribution(dags) {
    const intentCounts = new Map();
    let total = 0;

    dags.forEach((dag) => {
      const nodes = dag.nodes || [];
      nodes.forEach((node) => {
        const intent = node.intent || 'UNKNOWN';
        intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);
        total++;
      });
    });

    const distribution = {};
    intentCounts.forEach((count, intent) => {
      distribution[intent] = count / total;
    });

    return distribution;
  }

  /**
   * Determine motif shape archetype
   */
  determineMotifShape(sequence) {
    // Detect patterns
    const seqStr = sequence.join('|');

    // Check for loops (repeated subsequences)
    if (this.hasLoop(sequence)) {
      return 'loop';
    }

    // Check for branching (multiple paths)
    // Simplified: if sequence has many unique event types, likely branching
    const uniqueEvents = new Set(sequence);
    if (uniqueEvents.size < sequence.length * 0.5) {
      return 'branch';
    }

    // Check for fork-join patterns
    if (this.hasForkJoin(sequence)) {
      return 'fork-join';
    }

    // Default: linear chain
    return 'linear';
  }

  /**
   * Check if sequence has loop pattern
   */
  hasLoop(sequence) {
    // Look for repeated subsequences
    for (let len = 2; len <= Math.floor(sequence.length / 2); len++) {
      for (let i = 0; i <= sequence.length - len * 2; i++) {
        const subseq = sequence.slice(i, i + len);
        const nextSubseq = sequence.slice(i + len, i + len * 2);
        if (subseq.join('|') === nextSubseq.join('|')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check for fork-join pattern (simplified)
   */
  hasForkJoin(sequence) {
    // Simplified: if we see the same event type multiple times with different contexts
    const eventCounts = new Map();
    sequence.forEach((event) => {
      const baseEvent = event.split('(')[0];
      eventCounts.set(baseEvent, (eventCounts.get(baseEvent) || 0) + 1);
    });

    // If any event appears 3+ times, might be fork-join
    return Array.from(eventCounts.values()).some((count) => count >= 3);
  }

  /**
   * Compute structural statistics
   */
  computeStructuralStats(dags) {
    const lengths = dags.map((dag) => (dag.nodes || []).length);
    const branchingFactors = dags.map((dag) => this.computeBranchingFactor(dag));
    const cycleCounts = dags.map((dag) => this.detectCycles(dag));

    return {
      medianLength: this.median(lengths),
      avgBranchingFactor: this.average(branchingFactors),
      maxCycles: Math.max(...cycleCounts),
      eventTypeCount: this.countEventTypes(dags),
    };
  }

  /**
   * Count unique event types
   */
  countEventTypes(dags) {
    const types = new Set();
    dags.forEach((dag) => {
      (dag.nodes || []).forEach((node) => {
        types.add(node.type || 'UNKNOWN');
      });
    });
    return types.size;
  }

  /**
   * Compute cluster confidence
   */
  computeClusterConfidence(cluster) {
    // Based on cluster size and similarity
    const sizeScore = Math.min(cluster.items.length / 100, 1.0);
    // Could add similarity variance here
    return sizeScore;
  }

  /**
   * Utility: Median
   */
  median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * Utility: Average
   */
  average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}

module.exports = MotifExtractor;
