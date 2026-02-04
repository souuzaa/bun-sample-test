import { describe, expect, test } from "bun:test";
import routesConfig from "../../routes.json";

describe("Routing Configuration", () => {
  describe("routes.json structure", () => {
    test("has routes array", () => {
      expect(routesConfig.routes).toBeDefined();
      expect(Array.isArray(routesConfig.routes)).toBe(true);
    });

    test("all routes have required fields", () => {
      routesConfig.routes.forEach((route) => {
        expect(route).toHaveProperty("method");
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("handler");
      });
    });

    test("all methods are valid HTTP methods", () => {
      const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      routesConfig.routes.forEach((route) => {
        expect(validMethods).toContain(route.method);
      });
    });

    test("all paths start with /", () => {
      routesConfig.routes.forEach((route) => {
        expect(route.path.startsWith("/")).toBe(true);
      });
    });
  });

  describe("route definitions", () => {
    test("includes home route", () => {
      const homeRoute = routesConfig.routes.find(
        (r) => r.method === "GET" && r.path === "/"
      );
      expect(homeRoute).toBeDefined();
      expect(homeRoute?.handler).toBe("home");
    });

    test("includes health check route", () => {
      const healthRoute = routesConfig.routes.find(
        (r) => r.method === "GET" && r.path === "/api/health"
      );
      expect(healthRoute).toBeDefined();
      expect(healthRoute?.handler).toBe("health");
    });

    test("includes user CRUD routes", () => {
      const getUsersRoute = routesConfig.routes.find(
        (r) => r.method === "GET" && r.path === "/api/users"
      );
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute?.handler).toBe("getUsers");

      const createUserRoute = routesConfig.routes.find(
        (r) => r.method === "POST" && r.path === "/api/users"
      );
      expect(createUserRoute).toBeDefined();
      expect(createUserRoute?.handler).toBe("createUser");

      const getUserByIdRoute = routesConfig.routes.find(
        (r) => r.method === "GET" && r.path === "/api/users/:id"
      );
      expect(getUserByIdRoute).toBeDefined();
      expect(getUserByIdRoute?.handler).toBe("getUserById");

      const updateUserRoute = routesConfig.routes.find(
        (r) => r.method === "PUT" && r.path === "/api/users/:id"
      );
      expect(updateUserRoute).toBeDefined();
      expect(updateUserRoute?.handler).toBe("updateUser");

      const deleteUserRoute = routesConfig.routes.find(
        (r) => r.method === "DELETE" && r.path === "/api/users/:id"
      );
      expect(deleteUserRoute).toBeDefined();
      expect(deleteUserRoute?.handler).toBe("deleteUser");
    });

    test("includes workload routes", () => {
      const hashRoute = routesConfig.routes.find(
        (r) => r.method === "POST" && r.path === "/api/workload/hash"
      );
      expect(hashRoute).toBeDefined();
      expect(hashRoute?.handler).toBe("hashWorkload");

      const payloadRoute = routesConfig.routes.find(
        (r) => r.method === "POST" && r.path === "/api/workload/payload"
      );
      expect(payloadRoute).toBeDefined();
      expect(payloadRoute?.handler).toBe("payloadWorkload");

      const memoryRoute = routesConfig.routes.find(
        (r) => r.method === "POST" && r.path === "/api/workload/memory"
      );
      expect(memoryRoute).toBeDefined();
      expect(memoryRoute?.handler).toBe("memoryWorkload");

      const statusRoute = routesConfig.routes.find(
        (r) => r.method === "GET" && r.path === "/api/workload/status"
      );
      expect(statusRoute).toBeDefined();
      expect(statusRoute?.handler).toBe("workloadStatus");
    });
  });

  describe("route parameters", () => {
    test("identifies parameterized routes", () => {
      const parameterizedRoutes = routesConfig.routes.filter((r) =>
        r.path.includes(":")
      );

      expect(parameterizedRoutes.length).toBeGreaterThan(0);
      parameterizedRoutes.forEach((route) => {
        expect(route.path).toContain(":");
      });
    });

    test("user ID routes use :id parameter", () => {
      const userIdRoutes = routesConfig.routes.filter(
        (r) => r.path === "/api/users/:id"
      );

      expect(userIdRoutes.length).toBe(3); // GET, PUT, DELETE
    });
  });

  describe("route compilation logic", () => {
    test("parameter regex pattern matches word characters", () => {
      const paramPattern = /:(\w+)/g;
      const testPath = "/api/users/:id";

      const matches = testPath.match(paramPattern);
      expect(matches).toEqual([":id"]);
    });

    test("compiled pattern matches numeric IDs", () => {
      const compiledPattern = /^\/api\/users\/(\w+)$/;

      expect(compiledPattern.test("/api/users/1")).toBe(true);
      expect(compiledPattern.test("/api/users/123")).toBe(true);
      expect(compiledPattern.test("/api/users/abc")).toBe(true);
    });

    test("compiled pattern does not match invalid paths", () => {
      const compiledPattern = /^\/api\/users\/(\w+)$/;

      expect(compiledPattern.test("/api/users/")).toBe(false);
      expect(compiledPattern.test("/api/users/1/extra")).toBe(false);
      expect(compiledPattern.test("/api/user/1")).toBe(false);
    });
  });

  describe("route uniqueness", () => {
    test("no duplicate method+path combinations", () => {
      const routeKeys = routesConfig.routes.map((r) => `${r.method} ${r.path}`);
      const uniqueKeys = new Set(routeKeys);

      expect(routeKeys.length).toBe(uniqueKeys.size);
    });

    test("all handler names are defined", () => {
      const handlerNames = routesConfig.routes.map((r) => r.handler);

      handlerNames.forEach((handlerName) => {
        expect(handlerName).toBeTruthy();
        expect(typeof handlerName).toBe("string");
        expect(handlerName.length).toBeGreaterThan(0);
      });
    });
  });

  describe("API versioning and structure", () => {
    test("most routes are under /api prefix", () => {
      const apiRoutes = routesConfig.routes.filter((r) =>
        r.path.startsWith("/api/")
      );

      expect(apiRoutes.length).toBeGreaterThan(0);
    });

    test("routes are organized by resource", () => {
      const userRoutes = routesConfig.routes.filter((r) =>
        r.path.includes("/users")
      );
      const workloadRoutes = routesConfig.routes.filter((r) =>
        r.path.includes("/workload")
      );

      expect(userRoutes.length).toBeGreaterThan(0);
      expect(workloadRoutes.length).toBeGreaterThan(0);
    });
  });
});