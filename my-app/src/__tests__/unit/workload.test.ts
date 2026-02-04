import { describe, expect, test } from "bun:test";
import {
  hashWorkload,
  payloadWorkload,
  memoryWorkload,
  workloadStatus,
} from "../../handlers/workload";

describe("Workload Handlers", () => {
  describe("hashWorkload", () => {
    test("returns error when data is missing", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await hashWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("data is required");
    });

    test("processes hash with default iterations", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data" }),
      });

      const response = await hashWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hash).toBeDefined();
      expect(data.iterations).toBe(10000);
      expect(data.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("processes hash with custom iterations", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data", iterations: 5000 }),
      });

      const response = await hashWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hash).toBeDefined();
      expect(data.iterations).toBe(5000);
      expect(data.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("caps iterations at 100000", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data", iterations: 200000 }),
      });

      const response = await hashWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.iterations).toBe(100000);
    });

    test("returns different hashes for different inputs", async () => {
      const req1 = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data-1", iterations: 100 }),
      });

      const req2 = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data-2", iterations: 100 }),
      });

      const response1 = await hashWorkload(req1, {});
      const response2 = await hashWorkload(req2, {});
      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.hash).not.toBe(data2.hash);
    });

    test("processing time is positive", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test", iterations: 100 }),
      });

      const response = await hashWorkload(req, {});
      const data = await response.json();

      expect(data.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("payloadWorkload", () => {
    test("generates payload with default size", async () => {
      const req = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await payloadWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.size_kb).toBe(100);
      expect(data.data).toBeDefined();
      expect(data.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("generates payload with custom size", async () => {
      const req = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_kb: 50 }),
      });

      const response = await payloadWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.size_kb).toBe(50);
      expect(data.data).toBeDefined();
    });

    test("caps payload size at 1000KB", async () => {
      const req = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_kb: 2000 }),
      });

      const response = await payloadWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.size_kb).toBe(1000);
    });

    test("returns base64 encoded data", async () => {
      const req = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_kb: 1 }),
      });

      const response = await payloadWorkload(req, {});
      const data = await response.json();

      expect(data.data).toBeDefined();
      expect(typeof data.data).toBe("string");
      // Base64 string should be decodable
      expect(() => Buffer.from(data.data, "base64")).not.toThrow();
    });

    test("generates different data each time", async () => {
      const req1 = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_kb: 1 }),
      });

      const req2 = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_kb: 1 }),
      });

      const response1 = await payloadWorkload(req1, {});
      const response2 = await payloadWorkload(req2, {});
      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.data).not.toBe(data2.data);
    });
  });

  describe("memoryWorkload", () => {
    test("allocates memory with default parameters", async () => {
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await memoryWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.allocated_mb).toBe(10);
      expect(data.held_ms).toBe(100);
      expect(data.processingTimeMs).toBeGreaterThanOrEqual(100);
    });

    test("allocates custom amount of memory", async () => {
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocate_mb: 20, duration_ms: 50 }),
      });

      const response = await memoryWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.allocated_mb).toBe(20);
      expect(data.held_ms).toBe(50);
      expect(data.processingTimeMs).toBeGreaterThanOrEqual(50);
    });

    test("caps memory allocation at 100MB", async () => {
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocate_mb: 200 }),
      });

      const response = await memoryWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.allocated_mb).toBe(100);
    });

    test("caps duration at 5000ms", async () => {
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_ms: 10000 }),
      });

      const response = await memoryWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.held_ms).toBe(5000);
    });

    test("processing time includes hold duration", async () => {
      const holdDuration = 100;
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocate_mb: 1, duration_ms: holdDuration }),
      });

      const response = await memoryWorkload(req, {});
      const data = await response.json();

      expect(data.processingTimeMs).toBeGreaterThanOrEqual(holdDuration);
    });
  });

  describe("workloadStatus", () => {
    test("returns workload statistics", async () => {
      const req = new Request("http://localhost/api/workload/status");
      const response = await workloadStatus(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hash_jobs).toBeDefined();
      expect(data.payloads).toBeDefined();
    });

    test("hash_jobs stats have correct structure", async () => {
      const req = new Request("http://localhost/api/workload/status");
      const response = await workloadStatus(req, {});
      const data = await response.json();

      expect(data.hash_jobs).toHaveProperty("total_jobs");
      expect(data.hash_jobs).toHaveProperty("avg_time_ms");
      expect(data.hash_jobs).toHaveProperty("max_time_ms");
      expect(data.hash_jobs).toHaveProperty("min_time_ms");
    });

    test("payloads stats have correct structure", async () => {
      const req = new Request("http://localhost/api/workload/status");
      const response = await workloadStatus(req, {});
      const data = await response.json();

      expect(data.payloads).toHaveProperty("total_payloads");
      expect(data.payloads).toHaveProperty("total_kb");
      expect(data.payloads).toHaveProperty("avg_size_kb");
    });

    test("stats are non-negative numbers", async () => {
      const req = new Request("http://localhost/api/workload/status");
      const response = await workloadStatus(req, {});
      const data = await response.json();

      expect(data.hash_jobs.total_jobs).toBeGreaterThanOrEqual(0);
      expect(data.hash_jobs.avg_time_ms).toBeGreaterThanOrEqual(0);
      expect(data.payloads.total_payloads).toBeGreaterThanOrEqual(0);
      expect(data.payloads.total_kb).toBeGreaterThanOrEqual(0);
    });
  });

  describe("error handling", () => {
    test("hashWorkload handles malformed JSON gracefully", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await hashWorkload(req, {});

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("payloadWorkload handles malformed JSON gracefully", async () => {
      const req = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await payloadWorkload(req, {});

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("memoryWorkload handles malformed JSON gracefully", async () => {
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await memoryWorkload(req, {});

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("boundary conditions", () => {
    test("hashWorkload accepts zero iterations (capped to 0)", async () => {
      const req = new Request("http://localhost/api/workload/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test", iterations: 0 }),
      });

      const response = await hashWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.iterations).toBe(0);
    });

    test("payloadWorkload accepts 1KB size", async () => {
      const req = new Request("http://localhost/api/workload/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_kb: 1 }),
      });

      const response = await payloadWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.size_kb).toBe(1);
    });

    test("memoryWorkload accepts 1MB and 1ms", async () => {
      const req = new Request("http://localhost/api/workload/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocate_mb: 1, duration_ms: 1 }),
      });

      const response = await memoryWorkload(req, {});
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.allocated_mb).toBe(1);
      expect(data.held_ms).toBe(1);
    });
  });
});