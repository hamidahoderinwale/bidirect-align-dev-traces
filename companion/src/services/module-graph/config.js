/**
 * Module Graph Configuration
 * Centralized configuration for module graph service
 */

const config = {
  // Cache settings
  cache: {
    defaultTimeout: 5 * 60 * 1000, // 5 minutes
    maxSize: 100, // Maximum number of cached graphs
    adaptiveTimeout: true, // Adjust timeout based on data size
    warming: {
      enabled: true,
      workspaces: [], // Frequently accessed workspaces to warm cache
    },
  },

  // Edge detection settings
  edges: {
    editSequence: {
      timeWindow: 5 * 60 * 1000, // 5 minutes
      enabled: true,
    },
    navigation: {
      timeWindow: 5 * 60 * 1000, // 5 minutes
      enabled: true,
    },
    modelContext: {
      enabled: true,
    },
    toolInteraction: {
      enabled: true,
    },
    import: {
      enabled: true,
      useAST: true, // Use AST parsing when available
      resolveNodeModules: true,
      resolveTypeScriptPaths: true,
    },
    functionCall: {
      enabled: false, // Disabled by default (requires AST)
      minCallCount: 1,
    },
    typeDependency: {
      enabled: false, // Disabled by default (TypeScript only)
      includeInterfaces: true,
      includeTypes: true,
    },
  },

  // Extraction settings
  extraction: {
    timeout: 20000, // 20 seconds
    batchSize: 1000, // Process in batches
    parallel: true,
    progressCallback: null,
  },

  // Graph analysis settings
  analysis: {
    metrics: {
      enabled: true,
      includeCentrality: true,
      includeBetweenness: true,
      includeCloseness: true,
      includeClustering: true,
    },
    communities: {
      enabled: true,
      algorithm: 'louvain', // 'louvain' or 'leiden'
      resolution: 1.0,
    },
  },

  // Performance settings
  performance: {
    incrementalUpdates: true,
    streaming: true,
    maxNodesForFullAnalysis: 10000,
    levelOfDetail: {
      enabled: true,
      thresholds: {
        small: 100,
        medium: 1000,
        large: 10000,
      },
    },
  },
};

/**
 * Get configuration value
 * @param {string} path - Dot-separated path (e.g., 'cache.defaultTimeout')
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Configuration value
 */
function getConfig(path, defaultValue = undefined) {
  const parts = path.split('.');
  let value = config;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return defaultValue;
    }
  }

  return value;
}

/**
 * Set configuration value
 * @param {string} path - Dot-separated path
 * @param {*} value - Value to set
 */
function setConfig(path, value) {
  const parts = path.split('.');
  const lastPart = parts.pop();
  let target = config;

  for (const part of parts) {
    if (!target[part] || typeof target[part] !== 'object') {
      target[part] = {};
    }
    target = target[part];
  }

  target[lastPart] = value;
}

/**
 * Load configuration from environment variables
 */
function loadFromEnv() {
  // Cache settings
  if (process.env.MODULE_GRAPH_CACHE_TIMEOUT) {
    setConfig('cache.defaultTimeout', parseInt(process.env.MODULE_GRAPH_CACHE_TIMEOUT));
  }
  if (process.env.MODULE_GRAPH_CACHE_MAX_SIZE) {
    setConfig('cache.maxSize', parseInt(process.env.MODULE_GRAPH_CACHE_MAX_SIZE));
  }

  // Edge detection settings
  if (process.env.MODULE_GRAPH_EDIT_WINDOW) {
    setConfig('edges.editSequence.timeWindow', parseInt(process.env.MODULE_GRAPH_EDIT_WINDOW));
  }
  if (process.env.MODULE_GRAPH_USE_AST !== undefined) {
    setConfig('edges.import.useAST', process.env.MODULE_GRAPH_USE_AST === 'true');
  }

  // Extraction settings
  if (process.env.MODULE_GRAPH_EXTRACTION_TIMEOUT) {
    setConfig('extraction.timeout', parseInt(process.env.MODULE_GRAPH_EXTRACTION_TIMEOUT));
  }
  if (process.env.MODULE_GRAPH_BATCH_SIZE) {
    setConfig('extraction.batchSize', parseInt(process.env.MODULE_GRAPH_BATCH_SIZE));
  }
}

// Load from environment on module load
loadFromEnv();

module.exports = {
  config,
  getConfig,
  setConfig,
  loadFromEnv,
};
