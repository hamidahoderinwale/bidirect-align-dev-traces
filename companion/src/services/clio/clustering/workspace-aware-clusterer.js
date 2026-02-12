/**
 * Workspace-Aware Clustering Service
 * Implements multi-level clustering strategies: global, workspace-specific, and repository-type
 */

class WorkspaceAwareClusterer {
  constructor(adaptiveClusteringService, embeddingService = null) {
    this.adaptiveClusteringService = adaptiveClusteringService;
    this.embeddingService = embeddingService;
  }

  /**
   * Build clusters using multiple strategies
   */
  async buildClusters(data, workspaceContexts, options = {}) {
    const {
      strategies = ['global', 'workspace_specific', 'repo_type'],
      minClusterSize = null,
      minWorkspacesPerCluster = null,
    } = options;

    const workspaceStats = this.calculateWorkspaceStats(data);
    const clusteringParams = this.adaptiveClusteringService.calculateClusteringParams(
      data,
      workspaceStats,
      { minClusterSize, minWorkspacesPerCluster }
    );

    const results = {
      global: null,
      workspaceSpecific: {},
      repoType: {},
      metadata: {
        totalItems: data.length,
        workspaceCount: workspaceStats.uniqueWorkspaces,
        strategies: [],
        params: clusteringParams,
      },
    };

    // Strategy 1: Global clustering
    if (strategies.includes('global')) {
      try {
        results.global = await this.clusterGlobally(data, workspaceContexts, clusteringParams);
        results.metadata.strategies.push('global');
      } catch (error) {
        console.warn('[CLIO] Global clustering failed:', error.message);
      }
    }

    // Strategy 2: Workspace-specific clustering
    if (strategies.includes('workspace_specific')) {
      try {
        results.workspaceSpecific = await this.clusterPerWorkspace(
          data,
          workspaceContexts,
          clusteringParams
        );
        results.metadata.strategies.push('workspace_specific');
      } catch (error) {
        console.warn('[CLIO] Workspace-specific clustering failed:', error.message);
      }
    }

    // Strategy 3: Repository-type clustering
    if (strategies.includes('repo_type')) {
      try {
        results.repoType = await this.clusterByRepoType(data, workspaceContexts, clusteringParams);
        results.metadata.strategies.push('repo_type');
      } catch (error) {
        console.warn('[CLIO] Repository-type clustering failed:', error.message);
      }
    }

    return results;
  }

  /**
   * Cluster globally across all workspaces
   */
  async clusterGlobally(data, workspaceContexts, params) {
    // Group data by workspace for normalization
    const byWorkspace = this.groupByWorkspace(data);

    // Normalize data to prevent workspace bias
    const normalizedData = this.normalizeByWorkspace(data, byWorkspace);

    // Generate embeddings (would use embedding service)
    const embeddings = await this.generateEmbeddings(normalizedData);

    // Perform k-means clustering
    const clusters = await this.performKMeans(embeddings, params.k, {
      minSize: params.minClusterSize,
    });

    // Enrich clusters with workspace distribution
    const enrichedClusters = clusters.map((cluster) => {
      const clusterData = cluster.items.map((idx) => normalizedData[idx]);
      const workspaceDistribution = this.calculateWorkspaceDistribution(clusterData);

      return {
        ...cluster,
        workspaceDistribution,
        uniqueWorkspaces: Object.keys(workspaceDistribution).length,
        largestWorkspaceShare: Math.max(...Object.values(workspaceDistribution)),
      };
    });

    // Filter clusters that don't meet workspace requirements
    const validClusters = enrichedClusters.filter((cluster) => {
      return (
        cluster.uniqueWorkspaces >= params.minWorkspacesPerCluster &&
        cluster.largestWorkspaceShare <= params.maxWorkspaceConcentration
      );
    });

    return {
      clusters: validClusters,
      totalClusters: validClusters.length,
      filteredOut: enrichedClusters.length - validClusters.length,
      params,
    };
  }

  /**
   * Cluster within each workspace
   */
  async clusterPerWorkspace(data, workspaceContexts, globalParams) {
    const byWorkspace = this.groupByWorkspace(data);
    const workspaceClusters = {};

    for (const [workspace, items] of Object.entries(byWorkspace)) {
      if (items.length < globalParams.minClusterSize) {
        continue; // Skip workspaces with too few items
      }

      const workspaceContext = workspaceContexts[workspace] || {};
      const workspaceParams = this.adaptiveClusteringService.calculateWorkspaceSpecificParams(
        items,
        workspaceContext
      );

      try {
        // Generate embeddings for this workspace
        const embeddings = await this.generateEmbeddings(items);

        // Perform k-means for this workspace
        const clusters = await this.performKMeans(embeddings, workspaceParams.k, {
          minSize: workspaceParams.minClusterSize,
        });

        workspaceClusters[workspace] = {
          clusters: clusters.map((cluster) => ({
            ...cluster,
            workspace,
            items: cluster.items.map((idx) => items[idx]),
          })),
          totalClusters: clusters.length,
          params: workspaceParams,
          workspaceContext,
        };
      } catch (error) {
        console.warn(`[CLIO] Clustering failed for workspace ${workspace}:`, error.message);
      }
    }

    return workspaceClusters;
  }

  /**
   * Cluster by repository type
   */
  async clusterByRepoType(data, workspaceContexts, globalParams) {
    const byRepoType = this.groupByRepoType(data, workspaceContexts);
    const repoTypeClusters = {};

    const repoTypeParams = this.adaptiveClusteringService.calculateRepoTypeParams(byRepoType);

    for (const [repoType, items] of Object.entries(byRepoType)) {
      if (items.length < globalParams.minClusterSize) {
        continue;
      }

      const params = repoTypeParams[repoType] || {
        k: Math.floor(Math.sqrt(items.length / 2)),
        minClusterSize: globalParams.minClusterSize,
      };

      try {
        const embeddings = await this.generateEmbeddings(items);
        const clusters = await this.performKMeans(embeddings, params.k, {
          minSize: params.minClusterSize,
        });

        repoTypeClusters[repoType] = {
          clusters: clusters.map((cluster) => ({
            ...cluster,
            repoType,
            items: cluster.items.map((idx) => items[idx]),
          })),
          totalClusters: clusters.length,
          params,
        };
      } catch (error) {
        console.warn(`[CLIO] Clustering failed for repo type ${repoType}:`, error.message);
      }
    }

    return repoTypeClusters;
  }

  /**
   * Group data by workspace
   */
  groupByWorkspace(data) {
    const grouped = {};

    data.forEach((item, index) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';

      if (!grouped[workspace]) {
        grouped[workspace] = [];
      }

      grouped[workspace].push({ ...item, _originalIndex: index });
    });

    return grouped;
  }

  /**
   * Group data by repository type
   */
  groupByRepoType(data, workspaceContexts) {
    const grouped = {};

    data.forEach((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace;
      const context = workspaceContexts[workspace];
      const repoType = context?.repoType || item.repoType || item.metadata?.repoType || 'unknown';

      if (!grouped[repoType]) {
        grouped[repoType] = [];
      }

      grouped[repoType].push(item);
    });

    return grouped;
  }

  /**
   * Normalize data to prevent workspace bias
   */
  normalizeByWorkspace(data, byWorkspace) {
    // Calculate sampling weights to balance workspace representation
    const workspaceWeights = {};
    const totalItems = data.length;
    const workspaceCount = Object.keys(byWorkspace).length;
    const targetPerWorkspace = Math.floor(totalItems / workspaceCount);

    Object.entries(byWorkspace).forEach(([workspace, items]) => {
      if (items.length > targetPerWorkspace) {
        // Downsample large workspaces
        workspaceWeights[workspace] = targetPerWorkspace / items.length;
      } else {
        // Keep all items from small workspaces
        workspaceWeights[workspace] = 1.0;
      }
    });

    // Apply weights (in practice, would sample or weight embeddings)
    return data.map((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';
      return {
        ...item,
        _workspaceWeight: workspaceWeights[workspace] || 1.0,
      };
    });
  }

  /**
   * Calculate workspace distribution within a cluster
   */
  calculateWorkspaceDistribution(clusterData) {
    const distribution = {};
    const total = clusterData.length;

    clusterData.forEach((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';

      distribution[workspace] = (distribution[workspace] || 0) + 1;
    });

    // Convert to percentages
    Object.keys(distribution).forEach((workspace) => {
      distribution[workspace] = distribution[workspace] / total;
    });

    return distribution;
  }

  /**
   * Calculate workspace statistics
   */
  calculateWorkspaceStats(data) {
    const workspaces = new Set();
    const workspaceCounts = {};

    data.forEach((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';
      workspaces.add(workspace);
      workspaceCounts[workspace] = (workspaceCounts[workspace] || 0) + 1;
    });

    const uniqueWorkspaces = workspaces.size;
    const totalItems = data.length;
    const avgItemsPerWorkspace = totalItems / Math.max(1, uniqueWorkspaces);

    return {
      totalItems,
      uniqueWorkspaces,
      avgItemsPerWorkspace,
      workspaceCounts,
    };
  }

  /**
   * Generate embeddings for items (placeholder - would use actual embedding service)
   */
  async generateEmbeddings(items) {
    // In production, this would use the embedding service (all-mpnet-base-v2)
    // For now, return placeholder structure
    if (this.embeddingService) {
      return await this.embeddingService.embedItems(items);
    }

    // Fallback: return dummy embeddings (would fail in production)
    console.warn('[CLIO] No embedding service available, using placeholder');
    return items.map(() => new Array(768).fill(0).map(() => Math.random()));
  }

  /**
   * Perform k-means clustering (simplified implementation)
   */
  async performKMeans(embeddings, k, options = {}) {
    const { minSize = 10 } = options;
    const n = embeddings.length;

    if (n < k) {
      k = Math.max(1, Math.floor(n / 2));
    }

    // Initialize centroids randomly
    const centroids = [];
    for (let i = 0; i < k; i++) {
      const randomIndex = Math.floor(Math.random() * n);
      centroids.push([...embeddings[randomIndex]]);
    }

    // K-means iteration
    let assignments = new Array(n).fill(-1);
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;

      // Assign points to nearest centroid
      for (let i = 0; i < n; i++) {
        let minDist = Infinity;
        let nearest = -1;

        for (let j = 0; j < k; j++) {
          const dist = this.euclideanDistance(embeddings[i], centroids[j]);
          if (dist < minDist) {
            minDist = dist;
            nearest = j;
          }
        }

        if (assignments[i] !== nearest) {
          changed = true;
          assignments[i] = nearest;
        }
      }

      // Update centroids
      for (let j = 0; j < k; j++) {
        const clusterPoints = embeddings.filter((_, i) => assignments[i] === j);
        if (clusterPoints.length > 0) {
          const dim = embeddings[0].length;
          centroids[j] = new Array(dim).fill(0).map((_, d) => {
            return clusterPoints.reduce((sum, point) => sum + point[d], 0) / clusterPoints.length;
          });
        }
      }

      iterations++;
    }

    // Build cluster results
    const clusters = [];
    for (let j = 0; j < k; j++) {
      const clusterIndices = embeddings.map((_, i) => i).filter((i) => assignments[i] === j);

      if (clusterIndices.length >= minSize) {
        clusters.push({
          id: `cluster_${j}`,
          centroid: centroids[j],
          items: clusterIndices,
          size: clusterIndices.length,
        });
      }
    }

    return clusters;
  }

  /**
   * Calculate Euclidean distance between two vectors
   */
  euclideanDistance(vec1, vec2) {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = vec1[i] - vec2[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }
}

module.exports = WorkspaceAwareClusterer;
