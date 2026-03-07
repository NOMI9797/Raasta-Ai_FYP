import getRedisClient from './redis.js';

/**
 * Redis Cache Utility
 * 
 * Provides clean and consistent caching functionality for the Redis workflow
 */
class RedisCache {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Get cached data by key
   * @param {string} key - Cache key
   * @returns {object|null} - Cached data or null if not found
   */
  async get(key) {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      // Silent error for cache misses
      return null;
    }
  }

  /**
   * Set cached data with expiration
   * @param {string} key - Cache key
   * @param {object} data - Data to cache
   * @param {number} expirySeconds - Expiration time in seconds
   */
  async set(key, data, expirySeconds = 5) {
    try {
      await this.redis.setex(key, expirySeconds, JSON.stringify(data));
    } catch (error) {
      // Silent error for cache set failures
    }
  }

  /**
   * Delete cached data
   * @param {string} key - Cache key
   */
  async del(key) {
    try {
      await this.redis.del(key);
    } catch (error) {
      // Silent error for cache delete failures
    }
  }

  /**
   * Get or set cached data (cache-aside pattern)
   * @param {string} key - Cache key
   * @param {function} fetchFunction - Function to fetch fresh data
   * @param {number} expirySeconds - Expiration time in seconds
   * @returns {object} - Cached or fresh data
   */
  async getOrSet(key, fetchFunction, expirySeconds = 5) {
    // Try to get cached data first
    let data = await this.get(key);
    
    if (data) {
      return data;
    }

    // If no cache, fetch fresh data
    data = await fetchFunction();
    
    // Cache the fresh data
    await this.set(key, data, expirySeconds);
    
    return data;
  }

  /**
   * Generate campaign status cache key
   * @param {string} campaignId - Campaign ID
   * @returns {string} - Cache key
   */
  getCampaignStatusKey(campaignId) {
    return `campaign:${campaignId}:status`;
  }

  /**
   * Invalidate campaign status cache
   * @param {string} campaignId - Campaign ID
   */
  async invalidateCampaignStatus(campaignId) {
    const key = this.getCampaignStatusKey(campaignId);
    await this.del(key);
  }
}

// Export singleton instance
export default new RedisCache();
