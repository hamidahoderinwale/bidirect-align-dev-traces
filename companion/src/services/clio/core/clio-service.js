/**
 * Main Clio Service
 * Orchestrates the workspace-aware Clio pipeline
 */

const WorkspaceContextService = require('./workspace-context');
const AdaptiveClusteringService = require('./adaptive-clustering');
const RepositoryAwareFacetExtractor = require('../facets/repository-aware-extractor');
const WorkspaceAwareClusterer = require('../clustering/workspace-aware-clusterer');
const WorkspacePrivacyValidator = require('../privacy/workspace-privacy-validator');
const StratifiedSamplingService = require('../utils/sampling');
const ClioEmbeddingService = require('../services/embedding-service');
const ClioLLMService = require('../services/llm-service');

class ClioService {
  constructor(persistentDB, options = {}) {
    this.db = persistentDB;
    this.options = {
      embeddingService: null,
      llmService: null,
      ...options,
    };

    // Initialize services
    this.workspaceContextService = new WorkspaceContextService();
    this.adaptiveClusteringService = new AdaptiveClusteringService();

    // Initialize embedding and LLM services if not provided
    this.embeddingService = this.options.embeddingService || new ClioEmbeddingService();
    this.llmService = this.options.llmService || new ClioLLMService();

    this.facetExtractor = new RepositoryAwareFacetExtractor(
      this.workspaceContextService,
      this.llmService
    );
    this.clusterer = new WorkspaceAwareClusterer(
      this.adaptiveClusteringService,
      this.embeddingService
    );
    this.privacyValidator = new WorkspacePrivacyValidator(options.privacyConfig);
    this.samplingService = new StratifiedSamplingService();

    // Log service status
    console.log('[CLIO] Service initialized:');
    console.log(
      `[CLIO]   Embedding: ${this.embeddingService.getStatus().provider} (${this.embeddingService.isAvailable() ? 'available' : 'unavailable'})`
    );
    console.log(
      `[CLIO]   LLM: ${this.llmService.getStatus().provider} (${this.llmService.isAvailable() ? 'available' : 'unavailable'})`
    );
  }

  /**
   * Main pipeline: Process data through Clio
   */
  async processData(data, options = {}) {
    const {
      sampleSize = 100000,
      strategies = ['global', 'workspace_specific', 'repo_type'],
      privacyStrict = false,
    } = options;

    console.log(`[CLIO] Starting Clio pipeline with ${data.length} items`);

    // Step 1: Sample data if needed
    let processedData = data;
    if (data.length > sampleSize) {
      console.log(`[CLIO] Sampling ${sampleSize} items from ${data.length} total`);
      processedData = this.samplingService.sampleForClio(data, sampleSize);
      console.log(`[CLIO] Sampled ${processedData.length} items`);
    }

    // Step 2: Get workspace contexts
    console.log('[CLIO] Analyzing workspace contexts...');
    const workspaceContexts = await this.getWorkspaceContexts(processedData);
    console.log(`[CLIO] Analyzed ${Object.keys(workspaceContexts).length} workspaces`);

    // Step 3: Extract facets
    console.log('[CLIO] Extracting facets...');
    const facetedData = await this.extractFacets(processedData, workspaceContexts);
    console.log(`[CLIO] Extracted facets for ${facetedData.length} items`);

    // Step 4: Build clusters
    console.log('[CLIO] Building clusters...');
    const clusterResults = await this.clusterer.buildClusters(facetedData, workspaceContexts, {
      strategies,
    });
    console.log(
      `[CLIO] Built clusters using strategies: ${clusterResults.metadata.strategies.join(', ')}`
    );

    // Step 5: Validate privacy
    console.log('[CLIO] Validating privacy...');
    const validatedResults = await this.validatePrivacy(clusterResults, { strict: privacyStrict });
    console.log(`[CLIO] Privacy validation complete`);

    // Step 6: Generate summaries (would use LLM in production)
    console.log('[CLIO] Generating cluster summaries...');
    const summarizedResults = await this.generateSummaries(validatedResults);

    return summarizedResults;
  }

  /**
   * Get workspace contexts for all workspaces in data
   */
  async getWorkspaceContexts(data) {
    const workspaces = new Set();

    data.forEach((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace;
      if (workspace) {
        workspaces.add(workspace);
      }
    });

    const contexts = {};
    const workspaceArray = Array.from(workspaces);

    // Process in parallel with concurrency limit
    const concurrency = 5;
    for (let i = 0; i < workspaceArray.length; i += concurrency) {
      const batch = workspaceArray.slice(i, i + concurrency);
      const batchContexts = await Promise.all(
        batch.map((ws) => this.workspaceContextService.getWorkspaceContext(ws))
      );

      batch.forEach((ws, idx) => {
        contexts[ws] = batchContexts[idx];
      });
    }

    return contexts;
  }

  /**
   * Extract facets for all items
   */
  async extractFacets(data, workspaceContexts) {
    const facetedData = [];

    // Process in batches to avoid overwhelming the system
    const batchSize = 100;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const batchFacets = await Promise.all(
        batch.map((item) => {
          const workspace = item.workspace_path || item.workspacePath || item.workspace;
          const context = workspaceContexts[workspace];
          return this.facetExtractor.extractFacets(item, context);
        })
      );

      // Merge facets back into items
      batch.forEach((item, idx) => {
        facetedData.push({
          ...item,
          facets: batchFacets[idx],
        });
      });
    }

    return facetedData;
  }

  /**
   * Validate privacy for all clusters
   */
  async validatePrivacy(clusterResults, options = {}) {
    const validated = {
      global: null,
      workspaceSpecific: {},
      repoType: {},
      metadata: {
        ...clusterResults.metadata,
        privacyValidation: {},
      },
    };

    // Validate global clusters
    if (clusterResults.global) {
      const globalValidation = this.privacyValidator.filterValidClusters(
        clusterResults.global.clusters,
        options
      );
      validated.global = {
        ...clusterResults.global,
        clusters: globalValidation.valid,
        filteredOut: globalValidation.invalid.length,
        validation: globalValidation.validation,
      };
      validated.metadata.privacyValidation.global = globalValidation.validation.summary;
    }

    // Validate workspace-specific clusters
    Object.entries(clusterResults.workspaceSpecific).forEach(([workspace, wsClusters]) => {
      const wsValidation = this.privacyValidator.filterValidClusters(
        wsClusters.clusters,
        { ...options, strict: false } // Less strict for workspace-specific
      );
      validated.workspaceSpecific[workspace] = {
        ...wsClusters,
        clusters: wsValidation.valid,
        filteredOut: wsValidation.invalid.length,
        validation: wsValidation.validation,
      };
    });

    // Validate repo-type clusters
    Object.entries(clusterResults.repoType).forEach(([repoType, rtClusters]) => {
      const rtValidation = this.privacyValidator.filterValidClusters(rtClusters.clusters, options);
      validated.repoType[repoType] = {
        ...rtClusters,
        clusters: rtValidation.valid,
        filteredOut: rtValidation.invalid.length,
        validation: rtValidation.validation,
      };
    });

    return validated;
  }

  /**
   * Generate summaries for clusters using LLM
   */
  async generateSummaries(clusterResults) {
    if (!this.llmService.isAvailable()) {
      console.warn('[CLIO] LLM service not available, using placeholder summaries');
      return this.generatePlaceholderSummaries(clusterResults);
    }

    const summarizeCluster = async (cluster, clusterType) => {
      try {
        const summary = await this.llmService.generateClusterSummary(cluster, clusterType);
        return {
          ...cluster,
          title: summary.title || cluster.title || `Cluster ${cluster.id}`,
          description: summary.description || cluster.description || '',
          summary: summary.summary || cluster.summary || '',
        };
      } catch (error) {
        console.warn(`[CLIO] Failed to generate summary for cluster ${cluster.id}:`, error.message);
        return {
          ...cluster,
          title: cluster.title || `Cluster ${cluster.id}`,
          description: cluster.description || 'Summary generation failed',
          summary: cluster.summary || 'Unable to generate summary',
        };
      }
    };

    const summarized = {
      global: null,
      workspaceSpecific: {},
      repoType: {},
      metadata: clusterResults.metadata,
    };

    // Generate summaries in parallel with concurrency limit
    const concurrency = 5;

    if (clusterResults.global) {
      const globalClusters = await this.summarizeClustersBatch(
        clusterResults.global.clusters,
        'global',
        summarizeCluster,
        concurrency
      );
      summarized.global = {
        ...clusterResults.global,
        clusters: globalClusters,
      };
    }

    for (const [workspace, wsClusters] of Object.entries(clusterResults.workspaceSpecific)) {
      const wsClusterSummaries = await this.summarizeClustersBatch(
        wsClusters.clusters,
        'workspace_specific',
        summarizeCluster,
        concurrency
      );
      summarized.workspaceSpecific[workspace] = {
        ...wsClusters,
        clusters: wsClusterSummaries,
      };
    }

    for (const [repoType, rtClusters] of Object.entries(clusterResults.repoType)) {
      const rtClusterSummaries = await this.summarizeClustersBatch(
        rtClusters.clusters,
        'repo_type',
        summarizeCluster,
        concurrency
      );
      summarized.repoType[repoType] = {
        ...rtClusters,
        clusters: rtClusterSummaries,
      };
    }

    return summarized;
  }

  /**
   * Summarize clusters in batches with concurrency control
   */
  async summarizeClustersBatch(clusters, clusterType, summarizeFn, concurrency) {
    const results = [];

    for (let i = 0; i < clusters.length; i += concurrency) {
      const batch = clusters.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((cluster) => summarizeFn(cluster, clusterType))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate placeholder summaries when LLM is not available
   */
  generatePlaceholderSummaries(clusterResults) {
    const summarizeCluster = (cluster) => {
      return {
        ...cluster,
        title: cluster.title || `Cluster ${cluster.id}`,
        description: cluster.description || 'Cluster description would be generated by LLM',
        summary: cluster.summary || 'Cluster summary would be generated by LLM',
      };
    };

    const summarized = {
      global: null,
      workspaceSpecific: {},
      repoType: {},
      metadata: clusterResults.metadata,
    };

    if (clusterResults.global) {
      summarized.global = {
        ...clusterResults.global,
        clusters: clusterResults.global.clusters.map(summarizeCluster),
      };
    }

    Object.entries(clusterResults.workspaceSpecific).forEach(([workspace, wsClusters]) => {
      summarized.workspaceSpecific[workspace] = {
        ...wsClusters,
        clusters: wsClusters.clusters.map(summarizeCluster),
      };
    });

    Object.entries(clusterResults.repoType).forEach(([repoType, rtClusters]) => {
      summarized.repoType[repoType] = {
        ...rtClusters,
        clusters: rtClusters.clusters.map(summarizeCluster),
      };
    });

    return summarized;
  }

  /**
   * Get cluster statistics
   */
  getClusterStats(clusterResults) {
    const stats = {
      global: null,
      workspaceSpecific: {},
      repoType: {},
      totals: {
        totalClusters: 0,
        totalItems: 0,
        totalWorkspaces: 0,
      },
    };

    if (clusterResults.global) {
      stats.global = {
        clusterCount: clusterResults.global.clusters.length,
        itemCount: clusterResults.global.clusters.reduce((sum, c) => sum + c.size, 0),
        filteredOut: clusterResults.global.filteredOut || 0,
      };
      stats.totals.totalClusters += stats.global.clusterCount;
      stats.totals.totalItems += stats.global.itemCount;
    }

    Object.entries(clusterResults.workspaceSpecific).forEach(([workspace, wsClusters]) => {
      stats.workspaceSpecific[workspace] = {
        clusterCount: wsClusters.clusters.length,
        itemCount: wsClusters.clusters.reduce((sum, c) => sum + c.size, 0),
        filteredOut: wsClusters.filteredOut || 0,
      };
      stats.totals.totalClusters += stats.workspaceSpecific[workspace].clusterCount;
      stats.totals.totalItems += stats.workspaceSpecific[workspace].itemCount;
    });

    Object.entries(clusterResults.repoType).forEach(([repoType, rtClusters]) => {
      stats.repoType[repoType] = {
        clusterCount: rtClusters.clusters.length,
        itemCount: rtClusters.clusters.reduce((sum, c) => sum + c.size, 0),
        filteredOut: rtClusters.filteredOut || 0,
      };
      stats.totals.totalClusters += stats.repoType[repoType].clusterCount;
      stats.totals.totalItems += stats.repoType[repoType].itemCount;
    });

    return stats;
  }
}

module.exports = ClioService;
