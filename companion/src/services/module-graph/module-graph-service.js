/**
 * Module Graph Service
 * Main orchestration service for module graph file-level abstraction
 */

const ModuleGraphExtractor = require('./module-graph-extractor');
const ModuleGraphBuilder = require('./module-graph-builder');
const GraphMetricsCalculator = require('./graph-metrics');
const CommunityDetector = require('./community-detector');
const GraphDiffer = require('./graph-differ');
const GraphQuery = require('./graph-query');
const { getConfig } = require('./config');

class ModuleGraphService {
  constructor(cursorDbParser = null, options = {}) {
    // Dependency injection - allow injecting extractor and builder for testing
    this.extractor = options.extractor || new ModuleGraphExtractor(cursorDbParser);
    this.graphBuilder = options.builder || new ModuleGraphBuilder();

    // Initialize analysis components
    this.metricsCalculator = options.metricsCalculator || new GraphMetricsCalculator();
    this.communityDetector = options.communityDetector || new CommunityDetector();
    this.graphDiffer = options.graphDiffer || new GraphDiffer();

    // Initialize cache with LRU-like behavior
    this.cache = new Map();
    this.cacheAccessOrder = []; // Track access order for LRU eviction
    this.cacheTimeout = options.cacheTimeout || getConfig('cache.defaultTimeout', 5 * 60 * 1000);
    this.cacheMaxSize = options.cacheMaxSize || getConfig('cache.maxSize', 100);

    // Cache statistics
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };

    // Graph version tracking for incremental updates
    this.graphVersions = new Map(); // workspacePath -> version

    // Performance tracking
    this.buildTimes = new Map(); // Track build times for adaptive caching

    // Graph history for diffing
    this.graphHistory = new Map(); // workspacePath -> [graphs]
  }

  /**
   * Get module graph for a workspace
   * @param {string|null} workspacePath - Workspace path or null for global
   * @param {object} options - Options
   * @param {boolean} options.forceRefresh - Force refresh even if cached
   * @param {boolean} options.incremental - Use incremental updates if available
   * @returns {Promise<object>} Module graph
   */
  async getModuleGraph(workspacePath = null, options = {}) {
    const cacheKey = workspacePath || 'global';
    const startTime = Date.now();

    // Check cache with adaptive timeout
    if (!options.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        const adaptiveTimeout = this.getAdaptiveTimeout(cacheKey);

        if (age < adaptiveTimeout) {
          // Update access order for LRU
          this.updateCacheAccess(cacheKey);
          this.cacheStats.hits++;
          return cached.graph;
        }
      }
    }

    this.cacheStats.misses++;

    // Extract data
    const extractedData = await this.extractor.extractAll(workspacePath);

    // Build graph (with incremental updates if enabled)
    let graph;
    if (options.incremental && this.graphVersions.has(cacheKey)) {
      graph = await this.buildGraphIncremental(extractedData, cacheKey);
    } else {
      graph = await this.graphBuilder.buildGraph(extractedData, {
        workspaceRoot: workspacePath,
      });
      this.graphVersions.set(cacheKey, Date.now());
    }

    // Track build time for adaptive caching
    const buildTime = Date.now() - startTime;
    this.buildTimes.set(cacheKey, buildTime);

    // Cache result with LRU eviction
    this.setCache(cacheKey, {
      graph,
      timestamp: Date.now(),
      version: this.graphVersions.get(cacheKey),
      buildTime,
    });

    return graph;
  }

  /**
   * Get adaptive cache timeout based on data size and change frequency
   * @param {string} cacheKey - Cache key
   * @returns {number} Timeout in milliseconds
   */
  getAdaptiveTimeout(cacheKey) {
    if (!getConfig('cache.adaptiveTimeout', true)) {
      return this.cacheTimeout;
    }

    const cached = this.cache.get(cacheKey);
    if (!cached) return this.cacheTimeout;

    const graph = cached.graph;
    const nodeCount = graph?.nodes?.length || 0;
    const edgeCount = graph?.edges?.length || 0;
    const totalSize = nodeCount + edgeCount;

    // Larger graphs get longer cache times (up to 2x)
    // Small graphs (< 100 items) use default timeout
    // Large graphs (> 10000 items) use 2x timeout
    if (totalSize < 100) {
      return this.cacheTimeout;
    } else if (totalSize > 10000) {
      return this.cacheTimeout * 2;
    } else {
      // Linear interpolation
      const factor = 1 + (totalSize - 100) / 9900;
      return Math.floor(this.cacheTimeout * factor);
    }
  }

  /**
   * Update cache access order for LRU
   * @param {string} cacheKey - Cache key
   */
  updateCacheAccess(cacheKey) {
    const index = this.cacheAccessOrder.indexOf(cacheKey);
    if (index > -1) {
      this.cacheAccessOrder.splice(index, 1);
    }
    this.cacheAccessOrder.push(cacheKey);
  }

  /**
   * Set cache with LRU eviction
   * @param {string} cacheKey - Cache key
   * @param {object} value - Value to cache
   */
  setCache(cacheKey, value) {
    // Evict if at max size
    if (this.cache.size >= this.cacheMaxSize && !this.cache.has(cacheKey)) {
      const oldestKey = this.cacheAccessOrder.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.cacheStats.evictions++;
      }
    }

    this.cache.set(cacheKey, value);
    this.updateCacheAccess(cacheKey);
  }

  /**
   * Build graph incrementally (placeholder for future implementation)
   * @param {object} extractedData - Extracted data
   * @param {string} cacheKey - Cache key
   * @returns {Promise<object>} Graph
   */
  async buildGraphIncremental(extractedData, cacheKey) {
    // For now, just rebuild fully
    // TODO: Implement true incremental updates
    return this.graphBuilder.buildGraph(extractedData);
  }

  /**
   * Get nodes with filters
   */
  async getNodes(workspacePath = null, filters = {}) {
    const graph = await this.getModuleGraph(workspacePath);
    let nodes = graph.nodes;

    // Apply filters
    if (filters.type) {
      nodes = nodes.filter((n) => n.type === filters.type);
    }

    if (filters.lang) {
      nodes = nodes.filter((n) => n.lang === filters.lang);
    }

    if (filters.minEdits !== undefined) {
      nodes = nodes.filter((n) => n.interaction_counts?.edits >= filters.minEdits);
    }

    if (filters.hasModelContext) {
      // Filter to files that have MODEL_CONTEXT edges
      const contextFileIds = new Set(
        graph.edges.filter((e) => e.type === 'MODEL_CONTEXT').map((e) => e.source)
      );
      nodes = nodes.filter((n) => contextFileIds.has(n.id));
    }

    return nodes;
  }

  /**
   * Get edges with filters
   */
  async getEdges(workspacePath = null, filters = {}) {
    const graph = await this.getModuleGraph(workspacePath);
    let edges = graph.edges;

    // Apply filters
    if (filters.edgeType) {
      edges = edges.filter((e) => e.type === filters.edgeType);
    }

    if (filters.source) {
      edges = edges.filter((e) => e.source === filters.source);
    }

    if (filters.target) {
      edges = edges.filter((e) => e.target === filters.target);
    }

    if (filters.minWeight !== undefined) {
      edges = edges.filter((e) => e.weight >= filters.minWeight);
    }

    return edges;
  }

  /**
   * Get structural events
   */
  async getEvents(workspacePath = null, filters = {}) {
    const graph = await this.getModuleGraph(workspacePath);
    let events = graph.events;

    // Apply filters
    if (filters.timeRange) {
      const { since, until } = filters.timeRange;
      events = events.filter((e) => {
        const ts = e.timestamp;
        if (since && ts < since) return false;
        if (until && ts > until) return false;
        return true;
      });
    }

    if (filters.eventType) {
      events = events.filter((e) => e.event_type === filters.eventType);
    }

    if (filters.file) {
      events = events.filter((e) => e.file === filters.file);
    }

    return events;
  }

  /**
   * Get directory hierarchy
   */
  async getHierarchy(workspacePath = null) {
    const graph = await this.getModuleGraph(workspacePath);
    return graph.hierarchy;
  }

  /**
   * Clear cache
   * @param {string|null} workspacePath - Workspace path or null for all
   */
  clearCache(workspacePath = null) {
    if (workspacePath) {
      const cacheKey = workspacePath || 'global';
      this.cache.delete(cacheKey);
      const index = this.cacheAccessOrder.indexOf(cacheKey);
      if (index > -1) {
        this.cacheAccessOrder.splice(index, 1);
      }
      this.graphVersions.delete(cacheKey);
      this.buildTimes.delete(cacheKey);
    } else {
      this.cache.clear();
      this.cacheAccessOrder = [];
      this.graphVersions.clear();
      this.buildTimes.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getCacheStats() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      ...this.cacheStats,
      hitRate: total > 0 ? this.cacheStats.hits / total : 0,
      size: this.cache.size,
      maxSize: this.cacheMaxSize,
    };
  }

  /**
   * Get performance metrics
   * @returns {object} Performance metrics
   */
  getPerformanceMetrics() {
    const buildTimes = Array.from(this.buildTimes.values());
    return {
      averageBuildTime:
        buildTimes.length > 0 ? buildTimes.reduce((a, b) => a + b, 0) / buildTimes.length : 0,
      minBuildTime: buildTimes.length > 0 ? Math.min(...buildTimes) : 0,
      maxBuildTime: buildTimes.length > 0 ? Math.max(...buildTimes) : 0,
      cacheStats: this.getCacheStats(),
    };
  }

  /**
   * Calculate graph metrics
   * @param {string|null} workspacePath - Workspace path
   * @param {object} options - Options
   * @returns {Promise<object>} Graph metrics
   */
  async getMetrics(workspacePath = null, options = {}) {
    const graph = await this.getModuleGraph(workspacePath, options);
    return this.metricsCalculator.calculateAllMetrics(graph, options);
  }

  /**
   * Detect communities in graph
   * @param {string|null} workspacePath - Workspace path
   * @param {object} options - Options
   * @returns {Promise<object>} Community detection results
   */
  async getCommunities(workspacePath = null, options = {}) {
    const graph = await this.getModuleGraph(workspacePath, options);
    return this.communityDetector.detectCommunities(graph, options);
  }

  /**
   * Compare graphs at different times
   * @param {string|null} workspacePath - Workspace path
   * @param {object} options - Options with time1 and time2
   * @returns {Promise<object>} Diff results
   */
  async getDiff(workspacePath = null, options = {}) {
    // For now, compare current graph with previous version
    // TODO: Implement time-based graph retrieval
    const graph1 =
      options.graph1 ||
      (await this.getModuleGraph(workspacePath, { ...options, forceRefresh: true }));
    const graph2 = options.graph2 || (await this.getModuleGraph(workspacePath, options));

    return this.graphDiffer.diff(graph1, graph2, options);
  }

  /**
   * Execute graph query
   * @param {string|null} workspacePath - Workspace path
   * @param {object} query - Query object
   * @returns {Promise<object>} Query results
   */
  async executeQuery(workspacePath = null, query) {
    const graph = await this.getModuleGraph(workspacePath);
    const graphQuery = new GraphQuery(graph);
    return graphQuery.execute(query);
  }

  /**
   * Find paths between nodes
   * @param {string|null} workspacePath - Workspace path
   * @param {string} from - Source node ID
   * @param {string} to - Target node ID
   * @param {object} options - Options
   * @returns {Promise<Array>} Array of paths
   */
  async findPaths(workspacePath = null, from, to, options = {}) {
    const graph = await this.getModuleGraph(workspacePath);
    const graphQuery = new GraphQuery(graph);
    return graphQuery.findPaths(from, to, options);
  }
}

module.exports = ModuleGraphService;
