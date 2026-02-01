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
  });

  describe("health", () => {
    test("returns ok status with timestamp", async () => {
      const req = new Request("http://localhost/api/health");
      const response = health(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeDefined();
      expect(new Date(data.timestamp).getTime()).not.toBeNaN();
    });
  });
});
