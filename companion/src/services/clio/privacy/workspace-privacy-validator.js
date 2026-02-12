/**
 * Workspace-Aware Privacy Validator
 * Validates clusters meet privacy requirements including workspace distribution
 */

class WorkspacePrivacyValidator {
  constructor(config = {}) {
    this.config = {
      minConversations: config.minConversations || 100,
      minUniqueUsers: config.minUniqueUsers || 10,
      minUniqueWorkspaces: config.minUniqueWorkspaces || 3,
      maxWorkspaceConcentration: config.maxWorkspaceConcentration || 0.5,
      privacyScoreThreshold: config.privacyScoreThreshold || 3, // 1-5 scale, 3+ is acceptable
      ...config,
    };
  }

  /**
   * Validate cluster meets privacy requirements
   */
  validateCluster(cluster, options = {}) {
    const { strict = false, customThresholds = {} } = options;

    const thresholds = {
      minConversations: customThresholds.minConversations || this.config.minConversations,
      minUniqueUsers: customThresholds.minUniqueUsers || this.config.minUniqueUsers,
      minUniqueWorkspaces: customThresholds.minUniqueWorkspaces || this.config.minUniqueWorkspaces,
      maxWorkspaceConcentration:
        customThresholds.maxWorkspaceConcentration || this.config.maxWorkspaceConcentration,
    };

    // Calculate cluster statistics
    const stats = this.calculateClusterStats(cluster);

    const violations = [];

    // Check conversation count
    if (stats.conversationCount < thresholds.minConversations) {
      violations.push({
        type: 'insufficient_conversations',
        required: thresholds.minConversations,
        actual: stats.conversationCount,
        severity: 'high',
      });
    }

    // Check user count
    if (stats.uniqueUsers < thresholds.minUniqueUsers) {
      violations.push({
        type: 'insufficient_users',
        required: thresholds.minUniqueUsers,
        actual: stats.uniqueUsers,
        severity: 'high',
      });
    }

    // Check workspace distribution
    if (stats.uniqueWorkspaces < thresholds.minUniqueWorkspaces) {
      violations.push({
        type: 'insufficient_workspaces',
        required: thresholds.minUniqueWorkspaces,
        actual: stats.uniqueWorkspaces,
        severity: 'high',
      });
    }

    // Check workspace concentration
    if (stats.largestWorkspaceShare > thresholds.maxWorkspaceConcentration) {
      violations.push({
        type: 'workspace_concentration',
        required: `<= ${(thresholds.maxWorkspaceConcentration * 100).toFixed(0)}%`,
        actual: `${(stats.largestWorkspaceShare * 100).toFixed(1)}%`,
        severity: 'high',
        details: `Largest workspace: ${stats.largestWorkspace} (${(stats.largestWorkspaceShare * 100).toFixed(1)}%)`,
      });
    }

    // Check privacy score (if available)
    if (cluster.privacyScore !== undefined) {
      if (cluster.privacyScore < this.config.privacyScoreThreshold) {
        violations.push({
          type: 'low_privacy_score',
          required: `>= ${this.config.privacyScoreThreshold}`,
          actual: cluster.privacyScore,
          severity: 'medium',
        });
      }
    }

    const isValid =
      violations.length === 0 ||
      (strict === false && violations.every((v) => v.severity === 'low'));

    return {
      valid: isValid,
      violations,
      stats,
      recommendation: this.generateRecommendation(violations, stats, thresholds),
    };
  }

  /**
   * Calculate comprehensive cluster statistics
   */
  calculateClusterStats(cluster) {
    const conversations = cluster.items || cluster.conversations || [];
    const users = new Set();
    const workspaces = new Set();
    const workspaceCounts = {};
    const userCounts = {};

    let totalLength = 0;
    let totalTurns = 0;

    conversations.forEach((item) => {
      // Extract user ID
      const userId = item.user_id || item.userId || item.session_id || item.sessionId || 'unknown';
      users.add(userId);
      userCounts[userId] = (userCounts[userId] || 0) + 1;

      // Extract workspace
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';
      workspaces.add(workspace);
      workspaceCounts[workspace] = (workspaceCounts[workspace] || 0) + 1;

      // Extract metadata
      const text = item.text || item.prompt || item.content || '';
      totalLength += text.length;
      totalTurns += item.turn_count || 1;
    });

    // Calculate workspace distribution
    const workspaceDistribution = {};
    const total = conversations.length;
    let largestWorkspace = null;
    let largestWorkspaceShare = 0;

    Object.entries(workspaceCounts).forEach(([workspace, count]) => {
      const share = count / total;
      workspaceDistribution[workspace] = share;

      if (share > largestWorkspaceShare) {
        largestWorkspaceShare = share;
        largestWorkspace = workspace;
      }
    });

    // Calculate user distribution
    const userDistribution = {};
    Object.entries(userCounts).forEach(([user, count]) => {
      userDistribution[user] = count / total;
    });

    const largestUserShare = Math.max(...Object.values(userDistribution));

    return {
      conversationCount: conversations.length,
      uniqueUsers: users.size,
      uniqueWorkspaces: workspaces.size,
      workspaceDistribution,
      userDistribution,
      largestWorkspace,
      largestWorkspaceShare,
      largestUserShare,
      avgLength: totalLength / Math.max(1, conversations.length),
      avgTurns: totalTurns / Math.max(1, conversations.length),
      workspaceCounts,
      userCounts,
    };
  }

  /**
   * Generate recommendation for fixing privacy violations
   */
  generateRecommendation(violations, stats, thresholds) {
    if (violations.length === 0) {
      return 'Cluster meets all privacy requirements';
    }

    const recommendations = [];

    if (violations.some((v) => v.type === 'insufficient_conversations')) {
      recommendations.push(
        `Need ${thresholds.minConversations - stats.conversationCount} more conversations ` +
          `(currently ${stats.conversationCount})`
      );
    }

    if (violations.some((v) => v.type === 'insufficient_users')) {
      recommendations.push(
        `Need ${thresholds.minUniqueUsers - stats.uniqueUsers} more unique users ` +
          `(currently ${stats.uniqueUsers})`
      );
    }

    if (violations.some((v) => v.type === 'insufficient_workspaces')) {
      recommendations.push(
        `Need ${thresholds.minUniqueWorkspaces - stats.uniqueWorkspaces} more workspaces ` +
          `(currently ${stats.uniqueWorkspaces})`
      );
    }

    if (violations.some((v) => v.type === 'workspace_concentration')) {
      recommendations.push(
        `Reduce concentration of workspace "${stats.largestWorkspace}" ` +
          `from ${(stats.largestWorkspaceShare * 100).toFixed(1)}% to ` +
          `${(thresholds.maxWorkspaceConcentration * 100).toFixed(0)}% or less`
      );
    }

    return recommendations.join('. ') || 'Review cluster composition';
  }

  /**
   * Validate multiple clusters
   */
  validateClusters(clusters, options = {}) {
    const results = clusters.map((cluster, index) => {
      const validation = this.validateCluster(cluster, options);
      return {
        clusterId: cluster.id || `cluster_${index}`,
        ...validation,
      };
    });

    const validCount = results.filter((r) => r.valid).length;
    const invalidCount = results.length - validCount;

    return {
      results,
      summary: {
        total: results.length,
        valid: validCount,
        invalid: invalidCount,
        violationTypes: this.aggregateViolations(results),
      },
    };
  }

  /**
   * Aggregate violation types across clusters
   */
  aggregateViolations(validationResults) {
    const violations = {};

    validationResults.forEach((result) => {
      result.violations.forEach((violation) => {
        if (!violations[violation.type]) {
          violations[violation.type] = {
            count: 0,
            severity: violation.severity,
            examples: [],
          };
        }
        violations[violation.type].count++;
        if (violations[violation.type].examples.length < 3) {
          violations[violation.type].examples.push({
            clusterId: result.clusterId,
            details: violation,
          });
        }
      });
    });

    return violations;
  }

  /**
   * Filter clusters to only valid ones
   */
  filterValidClusters(clusters, options = {}) {
    const validationResults = this.validateClusters(clusters, options);

    return {
      valid: clusters.filter((_, index) => validationResults.results[index].valid),
      invalid: clusters.filter((_, index) => !validationResults.results[index].valid),
      validation: validationResults,
    };
  }

  /**
   * Calculate privacy score for cluster (1-5 scale)
   */
  calculatePrivacyScore(cluster) {
    const stats = this.calculateClusterStats(cluster);
    let score = 5; // Start with perfect score

    // Deduct points for privacy concerns
    if (stats.uniqueWorkspaces < 3) score -= 1;
    if (stats.uniqueUsers < 10) score -= 1;
    if (stats.largestWorkspaceShare > 0.5) score -= 1;
    if (stats.largestUserShare > 0.3) score -= 0.5;
    if (stats.conversationCount < 100) score -= 0.5;

    return Math.max(1, Math.min(5, score));
  }
}

module.exports = WorkspacePrivacyValidator;
