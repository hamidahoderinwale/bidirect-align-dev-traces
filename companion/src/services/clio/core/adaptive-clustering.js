/**
 * Adaptive Clustering Service
 * Calculates clustering parameters based on data distribution and workspace characteristics
 */

class AdaptiveClusteringService {
  constructor() {
    this.defaultParams = {
      k1: 1.5, // BM25 term frequency saturation
      b: 0.75, // BM25 length normalization
      minClusterSize: 10,
      minWorkspacesPerCluster: 3,
      maxWorkspaceConcentration: 0.5,
    };
  }

  /**
   * Calculate optimal clustering parameters based on data characteristics
   */
  calculateClusteringParams(data, workspaceStats, options = {}) {
    const {
      targetClusters = null,
      minClusterSize = null,
      minWorkspacesPerCluster = null,
    } = options;

    const totalItems = data.length;
    const workspaceCount = workspaceStats.uniqueWorkspaces || 1;
    const avgItemsPerWorkspace = workspaceStats.avgItemsPerWorkspace || totalItems;

    // Calculate base k using standard heuristic
    let baseK = targetClusters || Math.floor(Math.sqrt(totalItems / 2));

    // Adjust for workspace distribution
    if (workspaceCount > 10) {
      // Many workspaces: increase k to capture workspace-specific patterns
      baseK = Math.floor(baseK * 1.5);
    } else if (workspaceCount < 3) {
      // Few workspaces: reduce k to ensure minimum cluster sizes
      baseK = Math.floor(baseK * 0.7);
    }

    // Adjust for data sparsity
    if (avgItemsPerWorkspace < 50) {
      // Sparse data: reduce k to ensure minimum cluster sizes
      baseK = Math.floor(baseK * 0.7);
    } else if (avgItemsPerWorkspace > 1000) {
      // Dense data: can support more clusters
      baseK = Math.floor(baseK * 1.2);
    }

    // Calculate minimum cluster size
    const calculatedMinSize =
      minClusterSize ||
      this.calculateMinClusterSize(totalItems, workspaceCount, avgItemsPerWorkspace);

    // Calculate minimum workspaces per cluster
    const calculatedMinWorkspaces =
      minWorkspacesPerCluster || this.calculateMinWorkspaces(workspaceCount);

    // Calculate maximum workspace concentration
    const maxConcentration = this.calculateMaxWorkspaceConcentration(workspaceCount);

    return {
      k: Math.max(10, Math.min(10000, baseK)), // Clamp between 10 and 10000
      minClusterSize: calculatedMinSize,
      minWorkspacesPerCluster: calculatedMinWorkspaces,
      maxWorkspaceConcentration: maxConcentration,
      avgItemsPerWorkspace,
      workspaceCount,
      totalItems,
    };
  }

  /**
   * Calculate minimum cluster size based on data volume and workspace distribution
   */
  calculateMinClusterSize(totalItems, workspaceCount, avgItemsPerWorkspace) {
    // Base minimum: 0.1% of total items, but at least 10
    const baseMin = Math.max(10, Math.floor(totalItems * 0.001));

    // Workspace-aware minimum: need enough items to span multiple workspaces
    // If average is 50 items/workspace, need at least 3 workspaces = 150 items
    const workspaceMin =
      Math.max(3, Math.floor(workspaceCount * 0.2)) *
      Math.max(10, Math.floor(avgItemsPerWorkspace * 0.1));

    // Statistical significance: need enough data points for meaningful patterns
    const statisticalMin = Math.max(20, Math.floor(Math.sqrt(totalItems)));

    // Return the maximum of all requirements
    return Math.max(baseMin, workspaceMin, statisticalMin);
  }

  /**
   * Calculate minimum workspaces per cluster for privacy
   */
  calculateMinWorkspacesPerCluster(workspaceCount) {
    // Need at least 3 workspaces per cluster for privacy
    // But adjust based on total workspace count
    if (workspaceCount < 5) {
      return Math.max(1, Math.floor(workspaceCount * 0.4));
    } else if (workspaceCount < 20) {
      return Math.max(2, Math.floor(workspaceCount * 0.15));
    } else {
      return Math.max(3, Math.floor(workspaceCount * 0.1));
    }
  }

  /**
   * Calculate maximum workspace concentration (privacy requirement)
   */
  calculateMaxWorkspaceConcentration(workspaceCount) {
    // No single workspace should dominate a cluster
    // More workspaces = stricter concentration limit
    if (workspaceCount < 5) {
      return 0.7; // 70% max if few workspaces
    } else if (workspaceCount < 20) {
      return 0.5; // 50% max if moderate workspaces
    } else {
      return 0.4; // 40% max if many workspaces
    }
  }

  /**
   * Calculate parameters for workspace-specific clustering
   */
  calculateWorkspaceSpecificParams(workspaceData, workspaceContext) {
    const itemCount = workspaceData.length;
    const size = workspaceContext.size || 'medium';

    // Smaller k for smaller workspaces
    let k = Math.floor(Math.sqrt(itemCount / 2));

    // Adjust based on workspace size
    if (size === 'small') {
      k = Math.floor(k * 0.5);
    } else if (size === 'large' || size === 'very_large') {
      k = Math.floor(k * 1.5);
    }

    // Minimum cluster size for workspace-specific clustering
    const minSize = Math.max(5, Math.floor(itemCount * 0.05));

    return {
      k: Math.max(5, Math.min(500, k)),
      minClusterSize: minSize,
      workspace: workspaceContext.path,
    };
  }

  /**
   * Calculate parameters for repository-type clustering
   */
  calculateRepoTypeParams(dataByRepoType) {
    const params = {};

    Object.entries(dataByRepoType).forEach(([repoType, items]) => {
      const itemCount = items.length;
      const k = Math.floor(Math.sqrt(itemCount / 2));
      const minSize = Math.max(10, Math.floor(itemCount * 0.01));

      params[repoType] = {
        k: Math.max(5, Math.min(1000, k)),
        minClusterSize: minSize,
        repoType,
      };
    });

    return params;
  }

  /**
   * Determine if global or workspace-specific clustering is better
   */
  shouldClusterGlobally(workspaceStats) {
    const { uniqueWorkspaces, avgItemsPerWorkspace } = workspaceStats;

    // Cluster globally if:
    // 1. Many workspaces (cross-workspace patterns likely)
    // 2. Sufficient data per workspace (can support global clusters)
    // 3. Not too many workspaces (can still find meaningful patterns)

    return uniqueWorkspaces >= 3 && uniqueWorkspaces <= 50 && avgItemsPerWorkspace >= 20;
  }

  /**
   * Determine optimal clustering strategy
   */
  determineClusteringStrategy(workspaceStats, data) {
    const strategies = [];

    // Strategy 1: Global clustering (if conditions met)
    if (this.shouldClusterGlobally(workspaceStats)) {
      strategies.push({
        type: 'global',
        priority: 1,
        description: 'Cluster across all workspaces to find common patterns',
      });
    }

    // Strategy 2: Workspace-specific clustering (always available)
    strategies.push({
      type: 'workspace_specific',
      priority: 2,
      description: 'Cluster within each workspace to find workspace-specific patterns',
    });

    // Strategy 3: Repository-type clustering (if multiple repo types)
    const repoTypes = this.detectRepoTypes(data);
    if (repoTypes.size > 1) {
      strategies.push({
        type: 'repo_type',
        priority: 3,
        description: `Cluster by repository type: ${Array.from(repoTypes).join(', ')}`,
      });
    }

    return strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Detect repository types in data
   */
  detectRepoTypes(data) {
    const repoTypes = new Set();

    data.forEach((item) => {
      // Try to extract repo type from workspace context or metadata
      const repoType = item.repoType || item.metadata?.repoType || item.workspaceContext?.repoType;

      if (repoType && repoType !== 'unknown') {
        repoTypes.add(repoType);
      }
    });

    return repoTypes;
  }
}

module.exports = AdaptiveClusteringService;
