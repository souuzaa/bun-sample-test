import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

// Configuration
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Custom metrics
const hashProcessingTime = new Trend("hash_processing_time");
const payloadSizeKb = new Trend("payload_size_kb");
const cacheHits = new Counter("cache_hits");
const cacheMisses = new Counter("cache_misses");

// Test configuration optimized for max RPS (read-only)
export const options = {
  scenarios: {
    // Pure read operations for throughput testing
    read_heavy: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
      exec: "readOperations",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<50", "p(99)<100"],
    http_req_failed: ["rate<0.01"],
  },
};

// Read operations - 80% of traffic
/**
 * Execute read-heavy GET requests to /api/users and /api/users/1 and validate their responses to exercise cache hits.
 *
 * Performs two requests:
 * - GET /api/users: checks for HTTP 200 and that the response body is a non-empty array.
 * - GET /api/users/1: checks for HTTP 200 and that the response body contains an `id` field.
 */
export function readOperations() {
  // GET /api/users - should hit L1/L2 cache
  const usersResponse = http.get(`${BASE_URL}/api/users`);
  check(usersResponse, {
    "GET /api/users status is 200": (r) => r.status === 200,
    "GET /api/users has users": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body) && body.length > 0;
      } catch {
        return false;
      }
    },
  });

  // GET /api/users/1 - should hit cache
  const userResponse = http.get(`${BASE_URL}/api/users/1`);
  check(userResponse, {
    "GET /api/users/1 status is 200": (r) => r.status === 200,
    "GET /api/users/1 has user data": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      } catch {
        return false;
      }
    },
  });

  // No sleep for max throughput
}

// Write operations - 15% of traffic
/**
 * Creates a new user by POSTing a unique name and email to /api/users and validates the response.
 *
 * Generates a unique user payload, sends it to the server, asserts the request returned HTTP 201
 * and that the response body contains `id` and `email`. This operation is intended to invalidate
 * cache entries for user data.
 */
export function writeOperations() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const payload = JSON.stringify({
    name: `User ${uniqueId}`,
    email: `user-${uniqueId}@example.com`,
  });

  const response = http.post(`${BASE_URL}/api/users`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(response, {
    "POST /api/users status is 201": (r) => r.status === 201,
    "POST /api/users returns user": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined && body.email !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(0.05);
}

// CPU intensive operations - 5% of traffic
/**
 * Exercises CPU-like workloads by posting hash and payload requests and recording corresponding metrics.
 *
 * Posts a hash workload with a randomized iteration count and records the reported processing time to
 * the `hashProcessingTime` metric; posts a payload workload with a randomized size and records the
 * requested size to the `payloadSizeKb` metric. Sleeps briefly to pace the scenario.
 */
export function cpuOperations() {
  // POST /api/workload/hash with random iterations (100-500) - kept low for throughput
  const iterations = Math.floor(Math.random() * 400) + 100;
  const hashPayload = JSON.stringify({
    data: `benchmark-data-${Date.now()}`,
    iterations: iterations,
  });

  const hashResponse = http.post(`${BASE_URL}/api/workload/hash`, hashPayload, {
    headers: { "Content-Type": "application/json" },
  });

  check(hashResponse, {
    "POST /api/workload/hash status is 200": (r) => r.status === 200,
    "POST /api/workload/hash returns hash": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.hash !== undefined && body.processingTimeMs !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Record hash processing time from response
  if (hashResponse.status === 200) {
    try {
      const hashData = JSON.parse(hashResponse.body);
      if (hashData.processingTimeMs) {
        hashProcessingTime.add(hashData.processingTimeMs);
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // POST /api/workload/payload with random size (10-100KB)
  const sizeKb = Math.floor(Math.random() * 90) + 10;
  const payloadPayload = JSON.stringify({
    size_kb: sizeKb,
  });

  const payloadResponse = http.post(
    `${BASE_URL}/api/workload/payload`,
    payloadPayload,
    {
      headers: { "Content-Type": "application/json" },
    },
  );

  check(payloadResponse, {
    "POST /api/workload/payload status is 200": (r) => r.status === 200,
    "POST /api/workload/payload returns data": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.size_kb !== undefined && body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Record payload size
  if (payloadResponse.status === 200) {
    payloadSizeKb.add(sizeKb);
  }

  sleep(0.1);
}

/**
 * Verify the target server is healthy and provide setup data for the test run.
 *
 * Performs a health check against `${BASE_URL}/api/health`; if the check succeeds, returns
 * an object with the `baseUrl` to be used by tests.
 *
 * @returns {{ baseUrl: string }} An object containing `baseUrl`, the target base URL.
 * @throws {Error} If the health check does not return HTTP 200.
 */
export function setup() {
  const healthResponse = http.get(`${BASE_URL}/api/health`);
  check(healthResponse, {
    "Health check passed": (r) => r.status === 200,
  });

  if (healthResponse.status !== 200) {
    throw new Error(`Server not ready at ${BASE_URL}`);
  }

  console.log(`Running workload test against ${BASE_URL}`);
  return { baseUrl: BASE_URL };
}

/**
 * Perform teardown actions after the workload test finishes and log the target base URL.
 * @param {{baseUrl: string}} data - Setup return object containing the `baseUrl` used for the test.
 */
export function teardown(data) {
  console.log(`Workload test completed against ${data.baseUrl}`);
}