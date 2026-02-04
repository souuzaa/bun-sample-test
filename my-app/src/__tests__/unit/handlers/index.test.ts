import { describe, expect, test } from "bun:test";
import { handlers } from "../../../handlers/index";

describe("Handlers Index", () => {
  describe("handler registration", () => {
    test("exports all general handlers", () => {
      expect(handlers.home).toBeDefined();
      expect(handlers.health).toBeDefined();
    });

    test("exports all user handlers", () => {
      expect(handlers.getUsers).toBeDefined();
      expect(handlers.createUser).toBeDefined();
      expect(handlers.getUserById).toBeDefined();
      expect(handlers.updateUser).toBeDefined();
      expect(handlers.deleteUser).toBeDefined();
    });

    test("exports all workload handlers", () => {
      expect(handlers.hashWorkload).toBeDefined();
      expect(handlers.payloadWorkload).toBeDefined();
      expect(handlers.memoryWorkload).toBeDefined();
      expect(handlers.workloadStatus).toBeDefined();
    });

    test("all handlers are functions", () => {
      Object.values(handlers).forEach((handler) => {
        expect(typeof handler).toBe("function");
      });
    });

    test("has exactly 12 handlers", () => {
      const handlerNames = Object.keys(handlers);
      expect(handlerNames.length).toBe(12);
    });

    test("handler names match expected keys", () => {
      const expectedHandlers = [
        "home",
        "health",
        "getUsers",
        "createUser",
        "getUserById",
        "updateUser",
        "deleteUser",
        "hashWorkload",
        "payloadWorkload",
        "memoryWorkload",
        "workloadStatus",
      ];

      expectedHandlers.forEach((handlerName) => {
        expect(handlers).toHaveProperty(handlerName);
      });
    });
  });

  describe("handler functionality", () => {
    test("home handler returns correct response", async () => {
      const req = new Request("http://localhost/");
      const response = handlers.home(req, {});
      const data = await response.json();

      expect(data.message).toBe("Welcome to my app!");
    });

    test("health handler returns response", async () => {
      const req = new Request("http://localhost/api/health");
      const response = await handlers.health(req, {});

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test("getUsers handler returns response", async () => {
      const req = new Request("http://localhost/api/users");
      const response = await handlers.getUsers(req, {});

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });
  });

  describe("handler signature validation", () => {
    test("handlers accept request and params", async () => {
      const req = new Request("http://localhost/");
      const params = { id: "1" };

      // Test that handlers can be called with req and params
      expect(() => handlers.home(req, {})).not.toThrow();
      expect(() => handlers.getUserById(req, params)).not.toThrow();
    });

    test("handlers return Response or Promise<Response>", async () => {
      const req = new Request("http://localhost/");

      const homeResponse = handlers.home(req, {});
      expect(homeResponse).toBeInstanceOf(Response);

      const healthResponse = await handlers.health(req, {});
      expect(healthResponse).toBeInstanceOf(Response);
    });
  });
});