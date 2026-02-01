import { describe, expect, test, beforeEach } from "bun:test";

// We need to re-import to get fresh state for each test file
// In a real app, you'd use dependency injection or a test database
describe("User Handlers", () => {
  describe("getUsers", () => {
    test("returns array of users", async () => {
      const { getUsers } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users");
      const response = getUsers(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(2);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("email");
    });
  });

  describe("getUserById", () => {
    test("returns user when found", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/1");
      const response = getUserById(req, { id: "1" });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(1);
      expect(data.name).toBe("Alice");
    });

    test("returns 404 when user not found", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/999999");
      const response = getUserById(req, { id: "999999" });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("createUser", () => {
    test("creates a new user", async () => {
      const { createUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Charlie", email: "charlie@example.com" }),
      });

      const response = await createUser(req, {});
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.name).toBe("Charlie");
      expect(data.email).toBe("charlie@example.com");
      expect(data.id).toBeDefined();
    });
  });
});
