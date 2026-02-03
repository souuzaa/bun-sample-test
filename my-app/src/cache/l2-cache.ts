import Redis from 'ioredis';

// Connection pool via ioredis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),

  // Connection pool settings
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,

  // Performance settings
  enableReadyCheck: true,
  enableOfflineQueue: true,
  connectTimeout: 10000,

  // Keep-alive
  keepAlive: 30000,
  lazyConnect: true,
});

// Pub/Sub client for cache invalidation
const subscriber = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  lazyConnect: true,
});

const CACHE_CHANNEL = 'cache:invalidate';

export const l2 = {
  async get<T>(key: string): Promise<T | null> {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  },

  async delete(key: string): Promise<void> {
    await redis.del(key);
  },

  // Batch operations with pipelining (50-100x faster)
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();

    return results?.map(([err, data]) =>
      err ? null : (data ? JSON.parse(data as string) : null)
    ) || [];
  },

  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    const pipeline = redis.pipeline();
    entries.forEach(({ key, value, ttl = 300 }) => {
      pipeline.setex(key, ttl, JSON.stringify(value));
    });
    await pipeline.exec();
  },

  // Publish invalidation message to all instances
  async publishInvalidation(pattern: string): Promise<void> {
    await redis.publish(CACHE_CHANNEL, pattern);
  },

  // Subscribe to invalidation messages
  onInvalidation(callback: (pattern: string) => void): void {
    subscriber.subscribe(CACHE_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel === CACHE_CHANNEL) {
        callback(message);
      }
    });
  },
};

// Cleanup
export const closeRedis = async () => {
  await redis.quit();
  await subscriber.quit();
};

export { redis, CACHE_CHANNEL };
