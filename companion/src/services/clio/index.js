/**
 * Clio Service - Main Entry Point
 * Workspace-aware privacy-preserving usage analytics
 */

const ClioService = require('./core/clio-service');
const WorkspaceContextService = require('./core/workspace-context');
const AdaptiveClusteringService = require('./core/adaptive-clustering');
const RepositoryAwareFacetExtractor = require('./facets/repository-aware-extractor');
const WorkspaceAwareClusterer = require('./clustering/workspace-aware-clusterer');
const WorkspacePrivacyValidator = require('./privacy/workspace-privacy-validator');
const StratifiedSamplingService = require('./utils/sampling');
const ClioEmbeddingService = require('./services/embedding-service');
const ClioLLMService = require('./services/llm-service');

module.exports = {
  ClioService,
  WorkspaceContextService,
  AdaptiveClusteringService,
  RepositoryAwareFacetExtractor,
  WorkspaceAwareClusterer,
  WorkspacePrivacyValidator,
  StratifiedSamplingService,
  ClioEmbeddingService,
  ClioLLMService,
};
