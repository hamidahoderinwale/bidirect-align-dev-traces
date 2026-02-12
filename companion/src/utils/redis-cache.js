/**
 * Redis Cache Wrapper
 * High-performance caching layer using Redis
 * Falls back to in-memory cache if Redis unavailable
 */

const Redis = require('ioredis');
const NodeCache = require('node-cache');

class RedisCache {
  constructor(options = {}) {
    this.options = {
      ttl: options.ttl || 60, // Default 60 seconds
      prefix: options.prefix || 'cursor:',
      ...options,
    };

    this.redis = null;
    this.fallbackCache = new NodeCache({
      stdTTL: this.options.ttl,
      checkperiod: 120,
      useClones: false,
    });

    this.isRedisAvailable = false;
    this._initPromise = this.init();
  }

  /**
   * Initialize Redis connection
   */
  async init() {
    try {
      // Try to connect to Redis
      const redisUrl =
        process.env.REDIS_URL ||
        process.env.REDIS_PRIVATE_URL ||
        process.env.REDIS_CONNECTION_STRING;

      if (!redisUrl) {
        console.log('[REDIS] No Redis URL configured, using in-memory fallback');
        return;
      }

      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
          if (times > 3) {
            console.warn('[REDIS] Max retries reached, using fallback cache');
            return null; // Stop retrying
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      // Test connection
      await this.redis.ping();
      this.isRedisAvailable = true;

      console.log('[REDIS] ✅ Connected to Redis');
      console.log(`[REDIS]    URL: ${redisUrl.replace(/:[^:]+@/, ':****@')}`);

      // Handle connection errors
      this.redis.on('error', (err) => {
        console.warn('[REDIS] Connection error:', err.message);
        this.isRedisAvailable = false;
      });

      this.redis.on('reconnecting', () => {
        console.log('[REDIS] Reconnecting...');
      });

      this.redis.on('connect', () => {
        console.log('[REDIS] Reconnected!');
        this.isRedisAvailable = true;
      });
    } catch (error) {
      console.warn('[REDIS] Failed to connect:', error.message);
      console.log('[REDIS] Using in-memory fallback cache');
      this.isRedisAvailable = false;
    }
  }

  /**
   * Get value from cache
   */
  async get(key) {
    await this._initPromise;
    const prefixedKey = this.options.prefix + key;

    if (this.isRedisAvailable && this.redis) {
      try {
        const value = await this.redis.get(prefixedKey);
        if (value) {
          return JSON.parse(value);
        }
        return null;
      } catch (error) {
        console.warn('[REDIS] Get failed, using fallback:', error.message);
        return this.fallbackCache.get(key);
      }
    }

    return this.fallbackCache.get(key);
  }

  /**
   * Set value in cache
   */
  async set(key, value, ttl = null) {
    await this._initPromise;
    const prefixedKey = this.options.prefix + key;
    const cacheTTL = ttl || this.options.ttl;

    if (this.isRedisAvailable && this.redis) {
      try {
        const serialized = JSON.stringify(value);
        await this.redis.setex(prefixedKey, cacheTTL, serialized);
        return true;
      } catch (error) {
        console.warn('[REDIS] Set failed, using fallback:', error.message);
        this.fallbackCache.set(key, value, cacheTTL);
        return false;
      }
    }

    this.fallbackCache.set(key, value, cacheTTL);
    return true;
  }

  /**
   * Delete value from cache
   */
  async del(key) {
    await this._initPromise;
    const prefixedKey = this.options.prefix + key;

    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.del(prefixedKey);
      } catch (error) {
        console.warn('[REDIS] Delete failed:', error.message);
      }
    }

    this.fallbackCache.del(key);
  }

  /**
   * Delete keys by pattern
   */
  async delPattern(pattern) {
    await this._initPromise;
    const prefixedPattern = this.options.prefix + pattern;

    if (this.isRedisAvailable && this.redis) {
      try {
        const keys = await this.redis.keys(prefixedPattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        return keys.length;
      } catch (error) {
        console.warn('[REDIS] Delete pattern failed:', error.message);
      }
    }

    // Fallback cache doesn't support pattern deletion efficiently
    // Just clear specific keys if needed
    return 0;
  }

  /**
   * Flush all keys with our prefix
   */
  async flush() {
    await this._initPromise;

    if (this.isRedisAvailable && this.redis) {
      try {
        const keys = await this.redis.keys(this.options.prefix + '*');
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        console.log(`[REDIS] Flushed ${keys.length} keys`);
      } catch (error) {
        console.warn('[REDIS] Flush failed:', error.message);
      }
    }

    this.fallbackCache.flushAll();
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    await this._initPromise;

    const stats = {
      provider: this.isRedisAvailable ? 'redis' : 'memory',
      available: this.isRedisAvailable,
    };

    if (this.isRedisAvailable && this.redis) {
      try {
        const info = await this.redis.info('stats');
        const keyspace = await this.redis.info('keyspace');

        // Parse Redis INFO output
        const keyspaceMatch = keyspace.match(/keys=(\d+)/);
        const totalKeys = keyspaceMatch ? parseInt(keyspaceMatch[1]) : 0;

        stats.keys = totalKeys;
        stats.connected = true;
      } catch (error) {
        stats.error = error.message;
      }
    } else {
      const fallbackStats = this.fallbackCache.getStats();
      stats.keys = fallbackStats.keys;
      stats.hits = fallbackStats.hits;
      stats.misses = fallbackStats.misses;
      stats.hitRate = fallbackStats.hits / (fallbackStats.hits + fallbackStats.misses) || 0;
    }

    return stats;
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

module.exports = RedisCache;
