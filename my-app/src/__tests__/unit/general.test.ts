import { describe, expect, test } from "bun:test";
import { home, health } from "../../handlers/general";

describe("General Handlers", () => {
  describe("home", () => {
    test("returns welcome message", async () => {
      const req = new Request("http://localhost/");
      const response = home(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe("Welcome to my app!");
    });

    test("returns JSON response", async () => {
      const req = new Request("http://localhost/");
      const response = home(req, {});
      const contentType = response.headers.get("content-type");

      expect(contentType).toContain("application/json");
    });

    test("ignores request parameters", async () => {
      const req = new Request("http://localhost/");
      const response1 = home(req, {});
      const response2 = home(req, { param: "value" });
      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1).toEqual(data2);
    });
  });

  describe("health", () => {
    test("returns status with timestamp and services", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(data.status).toBeDefined();
      expect(data.timestamp).toBeDefined();
      expect(data.services).toBeDefined();
    });

    test("timestamp is valid ISO 8601 format", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });

    test("includes database health check", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(data.services.database).toBeDefined();
      expect(data.services.database.status).toBeDefined();
      expect(data.services.database.latencyMs).toBeDefined();
    });

    test("includes redis health check", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(data.services.redis).toBeDefined();
      expect(data.services.redis.status).toBeDefined();
      expect(data.services.redis.latencyMs).toBeDefined();
    });

    test("database status is either healthy or unhealthy", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(["healthy", "unhealthy"]).toContain(
        data.services.database.status
      );
    });

    test("redis status is either healthy or unhealthy", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(["healthy", "unhealthy"]).toContain(data.services.redis.status);
    });

    test("latency is a positive number", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      expect(data.services.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(data.services.redis.latencyMs).toBeGreaterThanOrEqual(0);
    });

    test("returns ok status when all services are healthy", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      if (
        data.services.database.status === "healthy" &&
        data.services.redis.status === "healthy"
      ) {
        expect(data.status).toBe("ok");
        expect(response.status).toBe(200);
      }
    });

    test("returns degraded status when a service is unhealthy", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const data = await response.json();

      if (
        data.services.database.status === "unhealthy" ||
        data.services.redis.status === "unhealthy"
      ) {
        expect(data.status).toBe("degraded");
        expect(response.status).toBe(503);
      }
    });

    test("response is JSON", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await health(req, {});
      const contentType = response.headers.get("content-type");

      expect(contentType).toContain("application/json");
    });
  });
});