import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const requestDuration = new Trend("request_duration", true);
const requestsPerSecond = new Counter("requests_per_second");

// Configuration
// Use localhost for native k6, host.docker.internal for Docker
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Test scenarios matching our Bun performance tests
export const options = {
  scenarios: {
    // Basic load test - similar to our Performance Tests
    load_test: {
      executor: "constant-vus",
      vus: 50,
      duration: "30s",
      exec: "loadTest",
      tags: { test_type: "load" },
    },

    // Stress test - similar to our Stress Tests (increasing load)
    stress_test: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "10s", target: 50 },
        { duration: "10s", target: 100 },
        { duration: "10s", target: 150 },
        { duration: "10s", target: 200 },
        { duration: "10s", target: 100 },
        { duration: "10s", target: 0 },
      ],
      exec: "stressTest",
      startTime: "35s",
      tags: { test_type: "stress" },
    },

    // Spike test - similar to our Spike Tests
    spike_test: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "10s", target: 10 }, // Baseline
        { duration: "5s", target: 100 }, // Spike up
        { duration: "20s", target: 100 }, // Stay at spike
        { duration: "5s", target: 10 }, // Recover
        { duration: "10s", target: 10 }, // Baseline again
      ],
      exec: "spikeTest",
      startTime: "100s",
      tags: { test_type: "spike" },
    },

    // Soak/Endurance test - similar to our Sustained Load Tests
    soak_test: {
      executor: "constant-vus",
      vus: 30,
      duration: "60s",
      exec: "soakTest",
      startTime: "155s",
      tags: { test_type: "soak" },
    },
  },

  thresholds: {
    http_req_duration: ["p(95)<100", "p(99)<200"],
    http_req_failed: ["rate<0.01"],
    errors: ["rate<0.05"],
  },
};

// Helper function to make requests and track metrics
function makeRequest(method, endpoint, body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const params = {
    headers: {
      "Content-Type": "application/json",
    },
    tags: { endpoint: endpoint },
  };

  let response;
  const start = Date.now();

  if (method === "GET") {
    response = http.get(url, params);
  } else if (method === "POST") {
    response = http.post(url, JSON.stringify(body), params);
  }

  const duration = Date.now() - start;
  requestDuration.add(duration);
  requestsPerSecond.add(1);

  const success = response.status >= 200 && response.status < 300;
  errorRate.add(!success);

  return { response, success, duration };
}

// Load Test - tests all endpoints with consistent load
export function loadTest() {
  group("GET /", () => {
    const { response, success } = makeRequest("GET", "/");
    check(response, {
      "status is 200": (r) => r.status === 200,
      "has welcome message": (r) => r.json("message") === "Welcome to my app!",
    });
  });

  group("GET /api/health", () => {
    const { response, success } = makeRequest("GET", "/api/health");
    check(response, {
      "status is 200": (r) => r.status === 200,
      "has ok status": (r) => r.json("status") === "ok",
      "has timestamp": (r) => r.json("timestamp") !== undefined,
    });
  });

  group("GET /api/users", () => {
    const { response, success } = makeRequest("GET", "/api/users");
    check(response, {
      "status is 200": (r) => r.status === 200,
      "returns array": (r) => Array.isArray(r.json()),
    });
  });

  group("GET /api/users/:id", () => {
    const { response, success } = makeRequest("GET", "/api/users/1");
    check(response, {
      "status is 200": (r) => r.status === 200,
      "has user id": (r) => r.json("id") === 1,
      "has user name": (r) => r.json("name") === "Alice",
    });
  });

  group("POST /api/users", () => {
    const { response, success } = makeRequest("POST", "/api/users", {
      name: `LoadTest User ${Date.now()}`,
      email: `loadtest-${Date.now()}@test.com`,
    });
    check(response, {
      "status is 201": (r) => r.status === 201,
      "has user id": (r) => r.json("id") !== undefined,
    });
  });

  sleep(0.1);
}

// Stress Test - focuses on GET endpoints under increasing load
export function stressTest() {
  const endpoints = [
    { method: "GET", path: "/" },
    { method: "GET", path: "/api/health" },
    { method: "GET", path: "/api/users" },
    { method: "GET", path: "/api/users/1" },
  ];

  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const { response } = makeRequest(endpoint.method, endpoint.path);

  check(response, {
    "status is 2xx": (r) => r.status >= 200 && r.status < 300,
  });

  sleep(0.05);
}

// Spike Test - alternates between read and write operations
export function spikeTest() {
  // 80% reads, 20% writes to simulate realistic traffic
  if (Math.random() < 0.8) {
    const readEndpoints = ["/", "/api/health", "/api/users", "/api/users/1"];
    const endpoint =
      readEndpoints[Math.floor(Math.random() * readEndpoints.length)];
    const { response } = makeRequest("GET", endpoint);

    check(response, {
      "read status is 2xx": (r) => r.status >= 200 && r.status < 300,
    });
  } else {
    const { response } = makeRequest("POST", "/api/users", {
      name: `SpikeTest User ${Date.now()}`,
      email: `spiketest-${Date.now()}@test.com`,
    });

    check(response, {
      "write status is 201": (r) => r.status === 201,
    });
  }

  sleep(0.05);
}

// Soak Test - sustained load over time to detect memory leaks
export function soakTest() {
  group("Soak - Health Check", () => {
    const { response } = makeRequest("GET", "/api/health");
    check(response, {
      "health check ok": (r) => r.status === 200,
    });
  });

  group("Soak - Users List", () => {
    const { response } = makeRequest("GET", "/api/users");
    check(response, {
      "users list ok": (r) => r.status === 200,
    });
  });

  group("Soak - User Detail", () => {
    const { response } = makeRequest("GET", "/api/users/1");
    check(response, {
      "user detail ok": (r) => r.status === 200,
    });
  });

  sleep(0.1);
}

// Summary handler for custom output
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    scenarios: {},
    overall: {
      totalRequests: data.metrics.http_reqs?.values?.count || 0,
      failedRequests: data.metrics.http_req_failed?.values?.passes || 0,
      avgDuration: data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 0,
      p50Duration:
        data.metrics.http_req_duration?.values?.["p(50)"]?.toFixed(2) || 0,
      p95Duration:
        data.metrics.http_req_duration?.values?.["p(95)"]?.toFixed(2) || 0,
      p99Duration:
        data.metrics.http_req_duration?.values?.["p(99)"]?.toFixed(2) || 0,
      maxDuration: data.metrics.http_req_duration?.values?.max?.toFixed(2) || 0,
      errorRate:
        ((data.metrics.errors?.values?.rate || 0) * 100).toFixed(2) + "%",
    },
  };

  console.log("\n" + "=".repeat(60));
  console.log("PERFORMANCE TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`Timestamp: ${summary.timestamp}`);
  console.log(`Total Requests: ${summary.overall.totalRequests}`);
  console.log(`Failed Requests: ${summary.overall.failedRequests}`);
  console.log(`Error Rate: ${summary.overall.errorRate}`);
  console.log("-".repeat(60));
  console.log("Latency:");
  console.log(`  Average: ${summary.overall.avgDuration}ms`);
  console.log(`  P50: ${summary.overall.p50Duration}ms`);
  console.log(`  P95: ${summary.overall.p95Duration}ms`);
  console.log(`  P99: ${summary.overall.p99Duration}ms`);
  console.log(`  Max: ${summary.overall.maxDuration}ms`);
  console.log("=".repeat(60) + "\n");

  return {
    "k6/summary.json": JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";
