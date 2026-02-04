import { describe, expect, test, beforeEach } from "bun:test";
import { l1 } from "../../../cache/l1-cache";

describe("L1 Cache", () => {
  beforeEach(() => {
    l1.clear();
  });

  describe("get and set", () => {
    test("returns undefined for non-existent key", () => {
      const result = l1.get("nonexistent");
      expect(result).toBeUndefined();
    });

    test("stores and retrieves string values", () => {
      l1.set("key1", "value1");
      const result = l1.get<string>("key1");
      expect(result).toBe("value1");
    });

    test("stores and retrieves object values", () => {
      const obj = { id: 1, name: "Test" };
      l1.set("key2", obj);
      const result = l1.get<typeof obj>("key2");
      expect(result).toEqual(obj);
    });

    test("stores and retrieves array values", () => {
      const arr = [1, 2, 3];
      l1.set("key3", arr);
      const result = l1.get<typeof arr>("key3");
      expect(result).toEqual(arr);
    });

    test("overwrites existing values", () => {
      l1.set("key4", "value1");
      l1.set("key4", "value2");
      const result = l1.get<string>("key4");
      expect(result).toBe("value2");
    });

    test("respects custom TTL", async () => {
      l1.set("key5", "value", 100);
      expect(l1.get("key5")).toBe("value");

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = l1.get("key5");
      expect(result).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("removes existing key", () => {
      l1.set("key6", "value");
      expect(l1.get("key6")).toBe("value");

      l1.delete("key6");
      expect(l1.get("key6")).toBeUndefined();
    });

    test("handles deletion of non-existent key", () => {
      l1.delete("nonexistent");
      expect(l1.get("nonexistent")).toBeUndefined();
    });
  });

  describe("invalidatePattern", () => {
    test("invalidates keys with simple prefix pattern", () => {
      l1.set("users:1", { id: 1 });
      l1.set("users:2", { id: 2 });
      l1.set("posts:1", { id: 1 });

      l1.invalidatePattern("users:*");

      expect(l1.get("users:1")).toBeUndefined();
      expect(l1.get("users:2")).toBeUndefined();
      expect(l1.get("posts:1")).toEqual({ id: 1 });
    });

    test("invalidates keys with complex pattern", () => {
      l1.set("user:1:profile", { name: "Alice" });
      l1.set("user:2:profile", { name: "Bob" });
      l1.set("user:1:settings", { theme: "dark" });

      l1.invalidatePattern("user:*:profile");

      expect(l1.get("user:1:profile")).toBeUndefined();
      expect(l1.get("user:2:profile")).toBeUndefined();
      expect(l1.get("user:1:settings")).toEqual({ theme: "dark" });
    });

    test("handles pattern with no matches", () => {
      l1.set("users:1", { id: 1 });

      l1.invalidatePattern("posts:*");

      expect(l1.get("users:1")).toEqual({ id: 1 });
    });
  });

  describe("clear", () => {
    test("removes all cached items", () => {
      l1.set("key1", "value1");
      l1.set("key2", "value2");
      l1.set("key3", "value3");

      l1.clear();

      expect(l1.get("key1")).toBeUndefined();
      expect(l1.get("key2")).toBeUndefined();
      expect(l1.get("key3")).toBeUndefined();
    });
  });

  describe("stats", () => {
    test("returns correct size and max", () => {
      l1.clear();
      const initialStats = l1.stats();
      expect(initialStats.size).toBe(0);
      expect(initialStats.max).toBe(50000);

      l1.set("key1", "value1");
      l1.set("key2", "value2");

      const stats = l1.stats();
      expect(stats.size).toBe(2);
      expect(stats.max).toBe(50000);
    });
  });

  describe("edge cases", () => {
    test("handles null values", () => {
      l1.set("key7", null);
      const result = l1.get("key7");
      expect(result).toBe(null);
    });

    test("handles undefined values", () => {
      l1.set("key8", undefined);
      const result = l1.get("key8");
      expect(result).toBe(undefined);
    });

    test("handles numeric values", () => {
      l1.set("key9", 42);
      const result = l1.get<number>("key9");
      expect(result).toBe(42);
    });

    test("handles boolean values", () => {
      l1.set("key10", true);
      const result = l1.get<boolean>("key10");
      expect(result).toBe(true);
    });
  });
});