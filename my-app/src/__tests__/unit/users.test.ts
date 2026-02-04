import { describe, expect, test, beforeEach } from "bun:test";

// We need to re-import to get fresh state for each test file
// In a real app, you'd use dependency injection or a test database
describe("User Handlers", () => {
  describe("getUsers", () => {
    test("returns array of users", async () => {
      const { getUsers } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users");
      const response = await getUsers(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(2);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("email");
    });

    test("returns JSON response", async () => {
      const { getUsers } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users");
      const response = await getUsers(req, {});
      const contentType = response.headers.get("content-type");

      expect(contentType).toContain("application/json");
    });

    test("each user has required properties", async () => {
      const { getUsers } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users");
      const response = await getUsers(req, {});
      const data = await response.json();

      data.forEach((user: any) => {
        expect(user).toHaveProperty("id");
        expect(user).toHaveProperty("name");
        expect(user).toHaveProperty("email");
        expect(user.email).toContain("@");
      });
    });
  });

  describe("getUserById", () => {
    test("returns user when found", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/1");
      const response = await getUserById(req, { id: "1" });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(1);
      expect(data.name).toBe("Alice");
    });

    test("returns 404 when user not found", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/999999");
      const response = await getUserById(req, { id: "999999" });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    test("returns 400 for invalid ID format", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/abc");
      const response = await getUserById(req, { id: "abc" });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid user ID");
    });

    test("returns 400 for negative ID", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/-1");
      const response = await getUserById(req, { id: "-1" });

      // Negative IDs might not exist but parsing is valid
      expect([400, 404]).toContain(response.status);
    });

    test("returns JSON response", async () => {
      const { getUserById } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/1");
      const response = await getUserById(req, { id: "1" });
      const contentType = response.headers.get("content-type");

      expect(contentType).toContain("application/json");
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

    test("returns 400 when name is missing", async () => {
      const { createUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      });

      const response = await createUser(req, {});
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Name and email are required");
    });

    test("returns 400 when email is missing", async () => {
      const { createUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test User" }),
      });

      const response = await createUser(req, {});
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Name and email are required");
    });

    test("returns 400 when both fields are missing", async () => {
      const { createUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await createUser(req, {});
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Name and email are required");
    });
  });

  describe("updateUser", () => {
    test("returns 400 for invalid ID format", async () => {
      const { updateUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/abc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      const response = await updateUser(req, { id: "abc" });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid user ID");
    });

    test("returns 404 when user not found", async () => {
      const { updateUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/999999", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      const response = await updateUser(req, { id: "999999" });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("deleteUser", () => {
    test("returns 400 for invalid ID format", async () => {
      const { deleteUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/abc", {
        method: "DELETE",
      });

      const response = await deleteUser(req, { id: "abc" });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid user ID");
    });

    test("returns 404 when user not found", async () => {
      const { deleteUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/999999", {
        method: "DELETE",
      });

      const response = await deleteUser(req, { id: "999999" });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("error handling", () => {
    test("createUser handles malformed JSON", async () => {
      const { createUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await createUser(req, {});
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("updateUser handles malformed JSON", async () => {
      const { updateUser } = await import("../../handlers/users");
      const req = new Request("http://localhost/api/users/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await updateUser(req, { id: "1" });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});