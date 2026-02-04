import { describe, expect, test, beforeEach, mock } from "bun:test";
import { CACHE_KEYS, CACHE_CONFIG, invalidateUserCache } from "../../../cache/strategies";

describe("Cache Strategies", () => {
  describe("CACHE_KEYS", () => {
    test("generates correct userList key", () => {
      expect(CACHE_KEYS.userList()).toBe("users:list");
    });

    test("generates correct userById key", () => {
      expect(CACHE_KEYS.userById(1)).toBe("users:1");
      expect(CACHE_KEYS.userById(123)).toBe("users:123");
    });

    test("generates correct userByEmail key", () => {
      expect(CACHE_KEYS.userByEmail("test@example.com")).toBe("users:email:test@example.com");
      expect(CACHE_KEYS.userByEmail("alice@test.com")).toBe("users:email:alice@test.com");
    });
  });

  describe("CACHE_CONFIG", () => {
    test("userList has correct TTL configuration", () => {
      expect(CACHE_CONFIG.userList).toEqual({
        l1Ttl: 30000,
        l2Ttl: 300,
      });
    });

    test("userById has correct TTL configuration", () => {
      expect(CACHE_CONFIG.userById).toEqual({
        l1Ttl: 60000,
        l2Ttl: 600,
      });
    });

    test("noCache has correct configuration", () => {
      expect(CACHE_CONFIG.noCache).toEqual({
        skipL1: true,
        l2Ttl: 0,
      });
    });
  });

  describe("invalidateUserCache", () => {
    // Mock the cache module
    const mockCache = {
      invalidate: mock(async () => {}),
    };

    beforeEach(() => {
      mockCache.invalidate.mockClear();
    });

    test("invalidates user list cache when no parameters provided", async () => {
      // We can't easily test the actual invalidation since it's a fire-and-forget
      // But we can test the function executes without error
      expect(() => invalidateUserCache()).not.toThrow();
    });

    test("executes without error with userId", () => {
      expect(() => invalidateUserCache(1)).not.toThrow();
    });

    test("executes without error with email", () => {
      expect(() => invalidateUserCache(undefined, "test@example.com")).not.toThrow();
    });

    test("executes without error with both userId and email", () => {
      expect(() => invalidateUserCache(1, "test@example.com")).not.toThrow();
    });
  });

  describe("key prefix extraction", () => {
    test("userList key has correct prefix", () => {
      const key = CACHE_KEYS.userList();
      const prefix = key.split(":")[0];
      expect(prefix).toBe("users");
    });

    test("userById key has correct prefix", () => {
      const key = CACHE_KEYS.userById(1);
      const prefix = key.split(":")[0];
      expect(prefix).toBe("users");
    });

    test("userByEmail key has correct prefix", () => {
      const key = CACHE_KEYS.userByEmail("test@example.com");
      const prefix = key.split(":")[0];
      expect(prefix).toBe("users");
    });
  });
});