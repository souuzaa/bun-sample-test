import { LRUCache } from "lru-cache";

export interface CacheOptions {
  max?: number;
  ttl?: number;
}

// L1 cache - in-process, nanosecond access
const l1Cache = new LRUCache<string, unknown>({
  max: 50000, // Max 50000 items for higher cache hit rate
  ttl: 1000 * 60, // 60 second TTL for better cache utilization
  updateAgeOnGet: true, // Reset TTL on access
  allowStale: true, // Return stale while revalidating
});

export const l1 = {
  get<T>(key: string): T | undefined {
    return l1Cache.get(key) as T | undefined;
  },

  set<T>(key: string, value: T, ttlMs?: number): void {
    l1Cache.set(key, value, { ttl: ttlMs });
  },

  delete(key: string): void {
    l1Cache.delete(key);
  },

  // Invalidate all keys matching a pattern (optimized)
  invalidatePattern(pattern: string): void {
    // For simple prefix patterns like "users:*", use startsWith for speed
    if (pattern.endsWith("*") && !pattern.slice(0, -1).includes("*")) {
      const prefix = pattern.slice(0, -1);
      for (const key of l1Cache.keys()) {
        if (key.startsWith(prefix)) {
          l1Cache.delete(key);
        }
      }
    } else {
      // Fall back to regex for complex patterns
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      for (const key of l1Cache.keys()) {
        if (regex.test(key)) {
          l1Cache.delete(key);
        }
      }
    }
  },

  clear(): void {
    l1Cache.clear();
  },

  stats() {
    return {
      size: l1Cache.size,
      max: l1Cache.max,
    };
  },
};
