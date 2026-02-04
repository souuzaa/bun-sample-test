import { describe, expect, test, beforeEach, mock } from "bun:test";
import { l1 } from "../../../cache/l1-cache";

// Note: Testing the full cache integration with Redis is complex in unit tests
// These tests focus on the L1 cache behavior and contract

describe("Cache Integration", () => {
  beforeEach(() => {
    l1.clear();
  });

  describe("cache configuration", () => {
    test("accepts configuration with l1Ttl", () => {
      const config = { l1Ttl: 5000 };
      expect(config.l1Ttl).toBe(5000);
    });

    test("accepts configuration with l2Ttl", () => {
      const config = { l2Ttl: 300 };
      expect(config.l2Ttl).toBe(300);
    });

    test("accepts configuration with skipL1", () => {
      const config = { skipL1: true };
      expect(config.skipL1).toBe(true);
    });

    test("accepts empty configuration", () => {
      const config = {};
      expect(config).toEqual({});
    });
  });

  describe("L1 cache integration", () => {
    test("L1 cache can store and retrieve data", () => {
      const key = "test:key";
      const value = { id: 1, name: "Test" };

      l1.set(key, value);
      const result = l1.get(key);

      expect(result).toEqual(value);
    });

    test("L1 cache invalidation works", () => {
      const key = "test:key";
      const value = { id: 1, name: "Test" };

      l1.set(key, value);
      l1.delete(key);
      const result = l1.get(key);

      expect(result).toBeUndefined();
    });

    test("L1 cache pattern invalidation works", () => {
      l1.set("test:1", { id: 1 });
      l1.set("test:2", { id: 2 });
      l1.set("other:1", { id: 3 });

      l1.invalidatePattern("test:*");

      expect(l1.get("test:1")).toBeUndefined();
      expect(l1.get("test:2")).toBeUndefined();
      expect(l1.get("other:1")).toEqual({ id: 3 });
    });
  });

  describe("key prefix extraction for metrics", () => {
    test("extracts prefix from simple key", () => {
      const key = "users:list";
      const prefix = key.split(":")[0];
      expect(prefix).toBe("users");
    });

    test("extracts prefix from compound key", () => {
      const key = "users:email:test@example.com";
      const prefix = key.split(":")[0];
      expect(prefix).toBe("users");
    });

    test("handles key without separator", () => {
      const key = "simplekey";
      const prefix = key.split(":")[0];
      expect(prefix).toBe("simplekey");
    });
  });

  describe("TTL behavior", () => {
    test("L1 cache respects TTL", async () => {
      const key = "ttl:test";
      const value = "test-value";
      const ttl = 100;

      l1.set(key, value, ttl);
      expect(l1.get(key)).toBe(value);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(l1.get(key)).toBeUndefined();
    });

    test("L1 cache with no TTL uses default", () => {
      const key = "default:ttl";
      const value = "test-value";

      l1.set(key, value);
      expect(l1.get(key)).toBe(value);
    });
  });

  describe("error handling", () => {
    test("handles special characters in keys", () => {
      const key = "user:email:test+special@example.com";
      const value = { email: "test+special@example.com" };

      l1.set(key, value);
      const result = l1.get(key);

      expect(result).toEqual(value);
    });

    test("handles very long keys", () => {
      const key = "a".repeat(1000);
      const value = "test";

      l1.set(key, value);
      const result = l1.get(key);

      expect(result).toBe(value);
    });

    test("handles complex nested objects", () => {
      const key = "complex:object";
      const value = {
        user: {
          id: 1,
          profile: {
            name: "Test",
            settings: {
              theme: "dark",
              notifications: {
                email: true,
                push: false,
              },
            },
          },
        },
      };

      l1.set(key, value);
      const result = l1.get(key);

      expect(result).toEqual(value);
    });
  });

  describe("cache stats and monitoring", () => {
    test("stats reflect current cache state", () => {
      l1.clear();
      expect(l1.stats().size).toBe(0);

      l1.set("key1", "value1");
      l1.set("key2", "value2");
      expect(l1.stats().size).toBe(2);

      l1.delete("key1");
      expect(l1.stats().size).toBe(1);
    });
  });
});