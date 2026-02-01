import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";

let server: Server;
const BASE_URL = "http://localhost:3001";

beforeAll(async () => {
  // Start server on a different port for integration tests
  const { handlers } = await import("../../handlers/index");
  const routesConfig = await import("../../routes.json");

  type RouteConfig = {
    method: string;
    path: string;
    handler: string;
  };

  type CompiledRoute = {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: (req: Request, params: Record<string, string>) => Response | Promise<Response>;
  };

  function compileRoute(route: RouteConfig): CompiledRoute {
    const paramNames: string[] = [];
    const patternStr = route.path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return "(\\w+)";
    });

    return {
      method: route.method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler: handlers[route.handler],
    };
  }

  const compiledRoutes = routesConfig.routes.map(compileRoute);

  function matchRoute(method: string, path: string) {
    for (const route of compiledRoutes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  server = Bun.serve({
    port: 3001,
    async fetch(req) {
      const url = new URL(req.url);
      const matched = matchRoute(req.method, url.pathname);
      if (matched) {
        return matched.handler(req, matched.params);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop();
});

describe("API Integration Tests", () => {
  describe("GET /", () => {
    test("returns welcome message", async () => {
      const response = await fetch(`${BASE_URL}/`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe("Welcome to my app!");
    });
  });

  describe("GET /api/health", () => {
    test("returns health status", async () => {
      const response = await fetch(`${BASE_URL}/api/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("GET /api/users", () => {
    test("returns list of users", async () => {
      const response = await fetch(`${BASE_URL}/api/users`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("GET /api/users/:id", () => {
    test("returns user by id", async () => {
      const response = await fetch(`${BASE_URL}/api/users/1`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(1);
      expect(data.name).toBe("Alice");
    });

    test("returns 404 for non-existent user", async () => {
      const response = await fetch(`${BASE_URL}/api/users/9999`);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("POST /api/users", () => {
    test("creates a new user", async () => {
      const response = await fetch(`${BASE_URL}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Integration Test", email: "integration@test.com" }),
      });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.name).toBe("Integration Test");
      expect(data.email).toBe("integration@test.com");
      expect(data.id).toBeDefined();
    });
  });

  describe("404 handling", () => {
    test("returns 404 for unknown routes", async () => {
      const response = await fetch(`${BASE_URL}/unknown/path`);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Not found");
    });
  });
});
