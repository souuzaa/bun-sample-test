import { l1 } from './l1-cache';
import { l2 } from './l2-cache';
import { cacheHitCounter, cacheMissCounter, cacheLatency } from '../telemetry/metrics';

export interface CacheConfig {
  l1Ttl?: number;   // L1 TTL in ms (default: 30000)
  l2Ttl?: number;   // L2 TTL in seconds (default: 300)
  skipL1?: boolean; // Skip L1 for this request
}

// Initialize L1 invalidation listener
l2.onInvalidation((pattern) => {
  if (pattern.includes('*')) {
    l1.invalidatePattern(pattern);
  } else {
    l1.delete(pattern);
  }
});

export const cache = {
  async get<T>(key: string, config: CacheConfig = {}): Promise<T | null> {
    const start = performance.now();

    // Try L1 first (nanoseconds)
    if (!config.skipL1) {
      const l1Result = l1.get<T>(key);
      if (l1Result !== undefined) {
        cacheHitCounter.add(1, { layer: 'l1', key_prefix: key.split(':')[0] });
        cacheLatency.record(performance.now() - start, { layer: 'l1' });
        return l1Result;
      }
    }

    // Try L2 (sub-millisecond)
    try {
      const l2Result = await l2.get<T>(key);
      const duration = performance.now() - start;

      if (l2Result !== null) {
        // Populate L1 for next request
        if (!config.skipL1) {
          l1.set(key, l2Result, config.l1Ttl || 30000);
        }
        cacheHitCounter.add(1, { layer: 'l2', key_prefix: key.split(':')[0] });
        cacheLatency.record(duration, { layer: 'l2' });
        return l2Result;
      }

      cacheMissCounter.add(1, { key_prefix: key.split(':')[0] });
      cacheLatency.record(duration, { layer: 'miss' });
    } catch (error) {
      console.error('L2 cache error:', error);
      cacheMissCounter.add(1, { key_prefix: key.split(':')[0] });
    }

    return null;
  },

  async set<T>(key: string, value: T, config: CacheConfig = {}): Promise<void> {
    // Set in both layers
    if (!config.skipL1) {
      l1.set(key, value, config.l1Ttl || 30000);
    }

    try {
      await l2.set(key, value, config.l2Ttl || 300);
    } catch (error) {
      console.error('L2 cache set error:', error);
    }
  },

  async invalidate(key: string): Promise<void> {
    l1.delete(key);
    try {
      await l2.delete(key);
      // Notify other instances
      await l2.publishInvalidation(key);
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  },

  async invalidatePattern(pattern: string): Promise<void> {
    l1.invalidatePattern(pattern);
    try {
      // Publish pattern for other instances to invalidate their L1
      await l2.publishInvalidation(pattern);
    } catch (error) {
      console.error('Cache pattern invalidation error:', error);
    }
  },
};
