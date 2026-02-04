import { cache } from "./cache";
import type { CacheConfig } from "./cache";

export const CACHE_KEYS = {
  userList: () => "users:list",
  userById: (id: number) => `users:${id}`,
  userByEmail: (email: string) => `users:email:${email}`,
} as const;

export const CACHE_CONFIG: Record<string, CacheConfig> = {
  // User list - moderate TTL, frequently accessed
  userList: {
    l1Ttl: 30000, // 30s in L1
    l2Ttl: 300, // 5min in L2
  },

  // Individual user - longer TTL, less volatile
  userById: {
    l1Ttl: 60000, // 1min in L1
    l2Ttl: 600, // 10min in L2
  },

  // Skip cache for write-heavy or real-time data
  noCache: {
    skipL1: true,
    l2Ttl: 0,
  },
} as const;

// Invalidation helper for user cache (parallel, non-blocking)
export const invalidateUserCache = (userId?: number, email?: string) => {
  const invalidations: Promise<void>[] = [
    cache.invalidate(CACHE_KEYS.userList()),
  ];

  if (userId !== undefined) {
    invalidations.push(cache.invalidate(CACHE_KEYS.userById(userId)));
  }

  if (email !== undefined) {
    invalidations.push(cache.invalidate(CACHE_KEYS.userByEmail(email)));
  }

  // Fire and forget - don't block response
  Promise.all(invalidations).catch(() => {});
};
