import Redis from 'ioredis';

// Centralized Redis error logger – silences noisy DNS errors like ENOTFOUND
function logRedisError(prefix, error) {
  if (!error) return;
  const message = String(error.message || '');
  const code = error.code || '';

  // Don't spam logs when Redis host is unreachable / misconfigured
  if (code === 'ENOTFOUND' || message.includes('ENOTFOUND')) {
    return;
  }

  console.error(prefix, error);
}

// Redis configuration - Support both URL and individual config
const redisConfig = {
  // For non-URL setups (fallback)
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  // Enable TLS for cloud Redis only when explicitly requested
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
};

// Create Redis instance
let redis = null;

export function getRedisClient() {
  if (!redis) {
    // For URL-based config (Upstash, Redis Cloud, etc.), let the URL decide TLS/host/port
    if (process.env.REDIS_URL) {
      redis = new Redis(process.env.REDIS_URL, {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
      });
    } else {
      redis = new Redis(redisConfig);
    }
    
    // Connection event handlers
    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });
    
    redis.on('error', (error) => {
      logRedisError('❌ Redis error:', error);
    });
  }
  
  return redis;
}

// Test Redis connection
export async function testRedisConnection() {
  try {
    const client = getRedisClient();
    await client.ping();
    console.log('✅ Redis ping successful');
    return true;
  } catch (error) {
    logRedisError('❌ Redis ping failed:', error);
    return false;
  }
}

// Close Redis connection
export async function closeRedisConnection() {
  if (redis) {
    await redis.quit();
    redis = null;
    console.log('🔌 Redis connection closed');
  }
}

// Redis Stream helpers
export class RedisStreamManager {
  constructor() {
    this.redis = getRedisClient();
  }

  // Add lead to stream
  async addLeadToStream(streamName, leadData) {
    try {
      const messageId = await this.redis.xadd(
        streamName,
        '*', // Auto-generate message ID
        ...Object.entries(leadData).flat()
      );
      // Lead added to stream
      return messageId;
    } catch (error) {
      logRedisError('❌ Error adding lead to stream:', error);
      throw error;
    }
  }

  // Create consumer group
  async createConsumerGroup(streamName, groupName) {
    try {
      await this.redis.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
    } catch (error) {
      if (error.message.includes('BUSYGROUP')) {
        // Consumer group already exists
      } else {
        logRedisError('❌ Error creating consumer group:', error);
        throw error;
      }
    }
  }

  // Read from stream
  async readFromStream(streamName, groupName, consumerName, count = 10) {
    try {
      const result = await this.redis.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', count,
        'STREAMS', streamName, '>'
      );
      return result;
    } catch (error) {
      logRedisError('❌ Error reading from stream:', error);
      throw error;
    }
  }

  // Acknowledge message
  async acknowledgeMessage(streamName, groupName, messageId) {
    try {
      await this.redis.xack(streamName, groupName, messageId);
      // Message acknowledged
    } catch (error) {
      logRedisError('❌ Error acknowledging message:', error);
      throw error;
    }
  }

  // Get stream info
  async getStreamInfo(streamName) {
    try {
      const info = await this.redis.xinfo('STREAM', streamName);
      return info;
    } catch (error) {
      logRedisError('❌ Error getting stream info:', error);
      throw error;
    }
  }

  // Get pending count (unacknowledged messages)
  async getPendingCount(streamName, groupName) {
    try {
      const pendingInfo = await this.redis.xpending(streamName, groupName);
      return pendingInfo ? pendingInfo[0] : 0; // First element is pending count
    } catch (error) {
      logRedisError('❌ Error getting pending count:', error);
      return 0; // Return 0 if error (stream might not exist)
    }
  }

  // BATCH PROCESSING METHODS

  // Add batch to stream (for invite sending)
  async addBatchToStream(streamName, batchData) {
    try {
      const messageId = await this.redis.xadd(
        streamName,
        '*', // Auto-generate message ID
        'batch_id', batchData.batch_id,
        'campaign_id', batchData.campaign_id,
        'linkedin_account_id', batchData.linkedin_account_id,
        'custom_message', batchData.custom_message || '',
        'batch_size', batchData.batch_size.toString(),
        'created_at', batchData.created_at,
        'leads', JSON.stringify(batchData.leads) // Serialize leads array
      );
      console.log(`📦 BATCH: Added batch ${batchData.batch_id} to stream ${streamName}`);
      return messageId;
    } catch (error) {
      logRedisError('❌ Error adding batch to stream:', error);
      throw error;
    }
  }

  // Read batch from stream
  async readBatchFromStream(streamName, groupName, consumerName, count = 1) {
    try {
      const result = await this.redis.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', count,
        'STREAMS', streamName, '>'
      );
      return result;
    } catch (error) {
      logRedisError('❌ Error reading batch from stream:', error);
      throw error;
    }
  }

  // Acknowledge batch
  async acknowledgeBatch(streamName, groupName, messageId) {
    try {
      await this.redis.xack(streamName, groupName, messageId);
      console.log(`✅ BATCH: Acknowledged batch ${messageId}`);
    } catch (error) {
      logRedisError('❌ Error acknowledging batch:', error);
      throw error;
    }
  }

  // Get batch info
  async getBatchInfo(streamName) {
    try {
      const info = await this.redis.xinfo('STREAM', streamName);
      return info;
    } catch (error) {
      logRedisError('❌ Error getting batch info:', error);
      throw error;
    }
  }

  // Get batch pending count
  async getBatchPendingCount(streamName, groupName) {
    try {
      const pendingInfo = await this.redis.xpending(streamName, groupName);
      return pendingInfo ? pendingInfo[0] : 0;
    } catch (error) {
      logRedisError('❌ Error getting batch pending count:', error);
      return 0;
    }
  }

  // BATCH PROCESSING LOCK METHODS

  // Acquire batch processing lock
  async acquireBatchLock(lockKey, ttlSeconds = 300) { // 5 minutes default TTL
    try {
      const lockValue = `${Date.now()}-${Math.random()}`;
      const result = await this.redis.set(lockKey, lockValue, 'NX', 'EX', ttlSeconds);
      return result === 'OK' ? lockValue : null;
    } catch (error) {
      logRedisError('❌ Error acquiring batch lock:', error);
      return null;
    }
  }

  // Release batch processing lock
  async releaseBatchLock(lockKey, lockValue) {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await this.redis.eval(script, 1, lockKey, lockValue);
      return result === 1;
    } catch (error) {
      logRedisError('❌ Error releasing batch lock:', error);
      return false;
    }
  }

  // Check if batch processing is locked
  async isBatchLocked(lockKey) {
    try {
      const lockValue = await this.redis.get(lockKey);
      return lockValue !== null;
    } catch (error) {
      logRedisError('❌ Error checking batch lock:', error);
      return false;
    }
  }
}

// Export default and named exports
export default getRedisClient;
