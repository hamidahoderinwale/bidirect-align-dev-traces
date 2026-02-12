/**
 * Cache Invalidation Utility
 * Provides tag-based cache invalidation for better cache management
 */

class CacheInvalidationManager {
  constructor(queryCache) {
    this.queryCache = queryCache;
    this.cacheTags = new Map(); // tag -> Set of cache keys
    this.keyTags = new Map(); // cache key -> Set of tags
  }

  /**
   * Tag a cache key with one or more tags
   * @param {string} key - Cache key
   * @param {...string} tags - Tags to associate with key
   */
  tag(key, ...tags) {
    if (!this.keyTags.has(key)) {
      this.keyTags.set(key, new Set());
    }

    const keyTagSet = this.keyTags.get(key);

    tags.forEach((tag) => {
      keyTagSet.add(tag);

      if (!this.cacheTags.has(tag)) {
        this.cacheTags.set(tag, new Set());
      }

      this.cacheTags.get(tag).add(key);
    });
  }

  /**
   * Invalidate cache by tag
   * @param {string} tag - Tag to invalidate
   * @returns {number} Number of keys invalidated
   */
  invalidateByTag(tag) {
    const keys = this.cacheTags.get(tag);
    if (!keys || keys.size === 0) {
      return 0;
    }

    let count = 0;
    keys.forEach((key) => {
      if (this.queryCache.del(key)) {
        count++;
      }
      // Remove from keyTags
      this.keyTags.delete(key);
    });

    // Remove tag
    this.cacheTags.delete(tag);

    return count;
  }

  /**
   * Invalidate cache by pattern
   * @param {string} pattern - Pattern to match (uses includes)
   * @returns {number} Number of keys invalidated
   */
  invalidateByPattern(pattern) {
    const allKeys = this.queryCache.keys();
    let count = 0;

    allKeys.forEach((key) => {
      if (key.includes(pattern)) {
        if (this.queryCache.del(key)) {
          count++;
        }
        // Clean up tags
        this.keyTags.delete(key);
      }
    });

    // Clean up empty tags
    this.cacheTags.forEach((keys, tag) => {
      if (keys.size === 0) {
        this.cacheTags.delete(tag);
      }
    });

    return count;
  }

  /**
   * Invalidate multiple tags at once
   * @param {...string} tags - Tags to invalidate
   * @returns {number} Total number of keys invalidated
   */
  invalidateTags(...tags) {
    let totalCount = 0;
    tags.forEach((tag) => {
      totalCount += this.invalidateByTag(tag);
    });
    return totalCount;
  }

  /**
   * Clear all cache
   */
  clearAll() {
    this.queryCache.flushAll();
    this.cacheTags.clear();
    this.keyTags.clear();
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats
   */
  getStats() {
    return {
      totalKeys: this.queryCache.keys().length,
      totalTags: this.cacheTags.size,
      tags: Array.from(this.cacheTags.entries()).map(([tag, keys]) => ({
        tag,
        keyCount: keys.size,
      })),
    };
  }
}

module.exports = CacheInvalidationManager;
