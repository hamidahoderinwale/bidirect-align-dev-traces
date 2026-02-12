/**
 * Database Connection Pool
 * Optimizes PostgreSQL connections for better performance
 */

const { Pool } = require('pg');

class ConnectionPool {
  constructor(connectionString, options = {}) {
    this.connectionString = connectionString;
    this.pool = null;
    this.options = {
      max: options.max || 20, // Maximum pool size
      min: options.min || 2, // Minimum pool size
      idleTimeoutMillis: options.idleTimeout || 30000, // Close idle connections after 30s
      connectionTimeoutMillis: options.connectionTimeout || 2000, // Connection timeout
      ...options,
    };
  }

  /**
   * Initialize the connection pool
   */
  async init() {
    if (this.pool) {
      return this.pool;
    }

    this.pool = new Pool({
      connectionString: this.connectionString,
      max: this.options.max,
      min: this.options.min,
      idleTimeoutMillis: this.options.idleTimeoutMillis,
      connectionTimeoutMillis: this.options.connectionTimeoutMillis,
    });

    // Error handling
    this.pool.on('error', (err) => {
      console.error('[POOL] Unexpected error on idle client', err);
    });

    this.pool.on('connect', () => {
      console.log('[POOL] New client connected');
    });

    this.pool.on('remove', () => {
      console.log('[POOL] Client removed');
    });

    // Test the connection
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      console.log(`[POOL]    Max connections: ${this.options.max}`);
      console.log(`[POOL]    Min connections: ${this.options.min}`);
    } catch (error) {
      console.error('[POOL] Failed to initialize pool:', error);
      throw error;
    }

    return this.pool;
  }

  /**
   * Execute a query
   */
  async query(text, params) {
    if (!this.pool) {
      await this.init();
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        console.warn(`[POOL] Slow query (${duration}ms): ${text.substring(0, 100)}...`);
      }

      return result;
    } catch (error) {
      console.error('[POOL] Query error:', error);
      throw error;
    }
  }

  /**
   * Get a client from the pool for transactions
   */
  async getClient() {
    if (!this.pool) {
      await this.init();
    }
    return await this.pool.connect();
  }

  /**
   * Get pool statistics
   */
  getStats() {
    if (!this.pool) {
      return { initialized: false };
    }

    return {
      initialized: true,
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      max: this.options.max,
      min: this.options.min,
    };
  }

  /**
   * Close the pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('[POOL] Connection pool closed');
    }
  }
}

module.exports = ConnectionPool;
