import { describe, expect, test } from "bun:test";
import type { RouteHandler } from "../../../handlers/types";

describe("RouteHandler Type", () => {
  describe("type definition", () => {
    test("accepts Request and params object", () => {
      const handler: RouteHandler = (req, params) => {
        return Response.json({ success: true });
      };

      const req = new Request("http://localhost/test");
      const params = { id: "123" };

      const response = handler(req, params);
      expect(response).toBeInstanceOf(Response);
    });

    test("can return Response synchronously", () => {
      const handler: RouteHandler = () => {
        return Response.json({ message: "sync response" });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response).toBeInstanceOf(Response);
    });

    test("can return Promise<Response> asynchronously", async () => {
      const handler: RouteHandler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return Response.json({ message: "async response" });
      };

      const req = new Request("http://localhost/test");
      const response = await handler(req, {});

      expect(response).toBeInstanceOf(Response);
    });
  });

  describe("params object", () => {
    test("params can be empty object", () => {
      const handler: RouteHandler = (req, params) => {
        expect(params).toEqual({});
        return Response.json({ params });
      };

      const req = new Request("http://localhost/test");
      handler(req, {});
    });

    test("params can contain string values", () => {
      const handler: RouteHandler = (req, params) => {
        expect(params.id).toBe("123");
        expect(params.name).toBe("test");
        return Response.json({ params });
      };

      const req = new Request("http://localhost/test");
      handler(req, { id: "123", name: "test" });
    });

    test("params keys are strings", () => {
      const handler: RouteHandler = (req, params) => {
        Object.keys(params).forEach((key) => {
          expect(typeof key).toBe("string");
        });
        return Response.json({ params });
      };

      const req = new Request("http://localhost/test");
      handler(req, { userId: "1", postId: "2" });
    });

    test("params values are strings", () => {
      const handler: RouteHandler = (req, params) => {
        Object.values(params).forEach((value) => {
          expect(typeof value).toBe("string");
        });
        return Response.json({ params });
      };

      const req = new Request("http://localhost/test");
      handler(req, { userId: "1", postId: "2" });
    });
  });

  describe("Request object", () => {
    test("can access request URL", () => {
      const handler: RouteHandler = (req) => {
        const url = new URL(req.url);
        expect(url.pathname).toBe("/test");
        return Response.json({ path: url.pathname });
      };

      const req = new Request("http://localhost/test");
      handler(req, {});
    });

    test("can access request method", () => {
      const handler: RouteHandler = (req) => {
        expect(req.method).toBe("POST");
        return Response.json({ method: req.method });
      };

      const req = new Request("http://localhost/test", { method: "POST" });
      handler(req, {});
    });

    test("can read request headers", () => {
      const handler: RouteHandler = (req) => {
        const contentType = req.headers.get("content-type");
        expect(contentType).toBe("application/json");
        return Response.json({ contentType });
      };

      const req = new Request("http://localhost/test", {
        headers: { "content-type": "application/json" },
      });
      handler(req, {});
    });

    test("can read request body", async () => {
      const handler: RouteHandler = async (req) => {
        const body = await req.json();
        expect(body.name).toBe("test");
        return Response.json(body);
      };

      const req = new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });

      await handler(req, {});
    });
  });

  describe("Response object", () => {
    test("can return JSON response", async () => {
      const handler: RouteHandler = () => {
        return Response.json({ success: true });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    test("can set status code", () => {
      const handler: RouteHandler = () => {
        return Response.json({ error: "Not found" }, { status: 404 });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(404);
    });

    test("can set response headers", () => {
      const handler: RouteHandler = () => {
        return Response.json(
          { success: true },
          {
            headers: {
              "X-Custom-Header": "custom-value",
            },
          }
        );
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.headers.get("X-Custom-Header")).toBe("custom-value");
    });

    test("can return text response", async () => {
      const handler: RouteHandler = () => {
        return new Response("Plain text response", {
          headers: { "content-type": "text/plain" },
        });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});
      const text = await response.text();

      expect(text).toBe("Plain text response");
    });
  });

  describe("error handling patterns", () => {
    test("can handle synchronous errors", () => {
      const handler: RouteHandler = () => {
        try {
          throw new Error("Test error");
        } catch (error) {
          return Response.json({ error: "Internal error" }, { status: 500 });
        }
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(500);
    });

    test("can handle asynchronous errors", async () => {
      const handler: RouteHandler = async () => {
        try {
          await Promise.reject(new Error("Async error"));
          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: "Async error caught" }, { status: 500 });
        }
      };

      const req = new Request("http://localhost/test");
      const response = await handler(req, {});

      expect(response.status).toBe(500);
    });

    test("can validate request data", async () => {
      const handler: RouteHandler = async (req) => {
        try {
          const body = await req.json();
          if (!body.name) {
            return Response.json({ error: "Name is required" }, { status: 400 });
          }
          return Response.json({ success: true });
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
      };

      const req1 = new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      const response1 = await handler(req1, {});
      expect(response1.status).toBe(400);

      const req2 = new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "invalid json",
      });

      const response2 = await handler(req2, {});
      expect(response2.status).toBe(400);
    });

    test("can validate params", () => {
      const handler: RouteHandler = (req, params) => {
        const id = parseInt(params.id);
        if (isNaN(id)) {
          return Response.json({ error: "Invalid ID" }, { status: 400 });
        }
        return Response.json({ id });
      };

      const req = new Request("http://localhost/test");

      const response1 = handler(req, { id: "123" });
      expect(response1.status).toBe(200);

      const response2 = handler(req, { id: "abc" });
      expect(response2.status).toBe(400);
    });
  });

  describe("common response patterns", () => {
    test("200 OK with data", async () => {
      const handler: RouteHandler = () => {
        return Response.json({ data: [1, 2, 3] }, { status: 200 });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data).toEqual([1, 2, 3]);
    });

    test("201 Created", () => {
      const handler: RouteHandler = () => {
        return Response.json({ id: 1, name: "New Item" }, { status: 201 });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(201);
    });

    test("400 Bad Request", async () => {
      const handler: RouteHandler = () => {
        return Response.json({ error: "Bad request" }, { status: 400 });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Bad request");
    });

    test("404 Not Found", async () => {
      const handler: RouteHandler = () => {
        return Response.json({ error: "Not found" }, { status: 404 });
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Not found");
    });

    test("500 Internal Server Error", async () => {
      const handler: RouteHandler = () => {
        return Response.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      };

      const req = new Request("http://localhost/test");
      const response = handler(req, {});

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Internal server error");
    });
  });
});