/**
 * Performance Monitoring Utility
 * Tracks request times, database query performance, and memory usage
 */

class PerformanceMonitor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false; // Default to enabled
    this.logSlowRequests = options.logSlowRequests !== false;
    this.slowRequestThreshold = options.slowRequestThreshold || 1000; // ms
    this.logSlowQueries = options.logSlowQueries !== false;
    this.slowQueryThreshold = options.slowQueryThreshold || 100; // ms
    this.metrics = {
      requests: {
        total: 0,
        slow: 0,
        errors: 0,
        byEndpoint: new Map(),
      },
      queries: {
        total: 0,
        slow: 0,
        byTable: new Map(),
      },
      memory: {
        samples: [],
        maxHeapUsed: 0,
      },
    };

    // Start memory monitoring if enabled
    if (this.enabled && options.monitorMemory !== false) {
      this.startMemoryMonitoring(options.memoryInterval || 60000); // Default 1 minute
    }
  }

  /**
   * Middleware for Express to track request performance
   */
  requestMiddleware() {
    return (req, res, next) => {
      if (!this.enabled) return next();

      const startTime = Date.now();
      const endpoint = `${req.method} ${req.path}`;

      // Track response finish
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.recordRequest(endpoint, duration, res.statusCode);

        if (this.logSlowRequests && duration > this.slowRequestThreshold) {
          console.warn(
            `[PERF] Slow request: ${endpoint} took ${duration}ms (status: ${res.statusCode})`
          );
        }
      });

      next();
    };
  }

  /**
   * Record a request metric
   */
  recordRequest(endpoint, duration, statusCode) {
    this.metrics.requests.total++;

    if (duration > this.slowRequestThreshold) {
      this.metrics.requests.slow++;
    }

    if (statusCode >= 400) {
      this.metrics.requests.errors++;
    }

    // Track by endpoint
    if (!this.metrics.requests.byEndpoint.has(endpoint)) {
      this.metrics.requests.byEndpoint.set(endpoint, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errors: 0,
      });
    }

    const endpointStats = this.metrics.requests.byEndpoint.get(endpoint);
    endpointStats.count++;
    endpointStats.totalDuration += duration;
    endpointStats.minDuration = Math.min(endpointStats.minDuration, duration);
    endpointStats.maxDuration = Math.max(endpointStats.maxDuration, duration);
    if (statusCode >= 400) {
      endpointStats.errors++;
    }
  }

  /**
   * Track database query performance
   */
  trackQuery(table, query, duration) {
    if (!this.enabled) return;

    this.metrics.queries.total++;

    if (duration > this.slowQueryThreshold) {
      this.metrics.queries.slow++;

      if (this.logSlowQueries) {
        console.warn(
          `[PERF] Slow query on ${table}: ${duration}ms - ${query.substring(0, 100)}...`
        );
      }
    }

    // Track by table
    if (!this.metrics.queries.byTable.has(table)) {
      this.metrics.queries.byTable.set(table, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        slowCount: 0,
      });
    }

    const tableStats = this.metrics.queries.byTable.get(table);
    tableStats.count++;
    tableStats.totalDuration += duration;
    tableStats.minDuration = Math.min(tableStats.minDuration, duration);
    tableStats.maxDuration = Math.max(tableStats.maxDuration, duration);
    if (duration > this.slowQueryThreshold) {
      tableStats.slowCount++;
    }
  }

  /**
   * Wrap a database query function to track performance
   */
  wrapQuery(table, queryFn) {
    return async (...args) => {
      const startTime = Date.now();
      try {
        const result = await queryFn(...args);
        const duration = Date.now() - startTime;
        this.trackQuery(table, queryFn.toString(), duration);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        this.trackQuery(table, queryFn.toString(), duration);
        throw error;
      }
    };
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring(interval) {
    setInterval(() => {
      const usage = process.memoryUsage();
      const sample = {
        timestamp: Date.now(),
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
      };

      this.metrics.memory.samples.push(sample);
      this.metrics.memory.maxHeapUsed = Math.max(this.metrics.memory.maxHeapUsed, usage.heapUsed);

      // Keep only last 1000 samples (about 16 hours at 1 minute intervals)
      if (this.metrics.memory.samples.length > 1000) {
        this.metrics.memory.samples.shift();
      }

      // Log if memory usage is high (>500MB heap)
      if (usage.heapUsed > 500 * 1024 * 1024) {
        console.warn(
          `[PERF] High memory usage: ${Math.round(usage.heapUsed / 1024 / 1024)}MB heap used`
        );
      }
    }, interval);
  }

  /**
   * Get performance metrics summary
   */
  getMetrics() {
    const requestStats = {
      total: this.metrics.requests.total,
      slow: this.metrics.requests.slow,
      errors: this.metrics.requests.errors,
      slowRate:
        this.metrics.requests.total > 0
          ? ((this.metrics.requests.slow / this.metrics.requests.total) * 100).toFixed(2) + '%'
          : '0%',
      errorRate:
        this.metrics.requests.total > 0
          ? ((this.metrics.requests.errors / this.metrics.requests.total) * 100).toFixed(2) + '%'
          : '0%',
      byEndpoint: Array.from(this.metrics.requests.byEndpoint.entries())
        .map(([endpoint, stats]) => ({
          endpoint,
          count: stats.count,
          avgDuration: Math.round(stats.totalDuration / stats.count),
          minDuration: stats.minDuration,
          maxDuration: stats.maxDuration,
          errors: stats.errors,
        }))
        .sort((a, b) => b.avgDuration - a.avgDuration), // Sort by avg duration descending
    };

    const queryStats = {
      total: this.metrics.queries.total,
      slow: this.metrics.queries.slow,
      slowRate:
        this.metrics.queries.total > 0
          ? ((this.metrics.queries.slow / this.metrics.queries.total) * 100).toFixed(2) + '%'
          : '0%',
      byTable: Array.from(this.metrics.queries.byTable.entries())
        .map(([table, stats]) => ({
          table,
          count: stats.count,
          avgDuration: Math.round(stats.totalDuration / stats.count),
          minDuration: stats.minDuration,
          maxDuration: stats.maxDuration,
          slowCount: stats.slowCount,
        }))
        .sort((a, b) => b.avgDuration - a.avgDuration), // Sort by avg duration descending
    };

    const memoryStats = {
      current: process.memoryUsage(),
      maxHeapUsed: this.metrics.memory.maxHeapUsed,
      samples: this.metrics.memory.samples.length,
      recent: this.metrics.memory.samples.slice(-10), // Last 10 samples
    };

    return {
      requests: requestStats,
      queries: queryStats,
      memory: memoryStats,
      uptime: process.uptime(),
    };
  }

  /**
   * Get formatted metrics summary for logging
   */
  getSummary() {
    const metrics = this.getMetrics();

    return {
      requests: `${metrics.requests.total} total, ${metrics.requests.slow} slow (${metrics.requests.slowRate}), ${metrics.requests.errors} errors (${metrics.requests.errorRate})`,
      queries: `${metrics.queries.total} total, ${metrics.queries.slow} slow (${metrics.queries.slowRate})`,
      memory: {
        heapUsed: `${Math.round(metrics.memory.current.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(metrics.memory.current.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(metrics.memory.current.rss / 1024 / 1024)}MB`,
        maxHeapUsed: `${Math.round(metrics.memory.maxHeapUsed / 1024 / 1024)}MB`,
      },
      uptime: `${Math.round(metrics.uptime / 60)} minutes`,
    };
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   */
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        slow: 0,
        errors: 0,
        byEndpoint: new Map(),
      },
      queries: {
        total: 0,
        slow: 0,
        byTable: new Map(),
      },
      memory: {
        samples: [],
        maxHeapUsed: 0,
      },
    };
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// Export singleton instance
let instance = null;

function getPerformanceMonitor(options) {
  if (!instance) {
    instance = new PerformanceMonitor(options);
  }
  return instance;
}

module.exports = {
  PerformanceMonitor,
  getPerformanceMonitor,
};
