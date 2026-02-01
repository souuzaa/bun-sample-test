import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

// Custom metrics
const errorRate = new Rate("errors");
const homeDuration = new Trend("home_duration", true);
const healthDuration = new Trend("health_duration", true);
const usersDuration = new Trend("users_duration", true);
const userByIdDuration = new Trend("user_by_id_duration", true);
const createUserDuration = new Trend("create_user_duration", true);

// Use localhost for native k6, host.docker.internal for Docker
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Quick test configuration - similar to our basic Performance Tests
export const options = {
  vus: 50,
  duration: "10s",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.05"],
    errors: ["rate<0.05"],
  },
};

// HTTP request params with timeout
const httpParams = {
  timeout: "30s",
};

export default function () {
  // GET /
  let res = http.get(`${BASE_URL}/`, httpParams);
  homeDuration.add(res.timings.duration);
  check(res, { "GET / status 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);

  // GET /api/health
  res = http.get(`${BASE_URL}/api/health`, httpParams);
  healthDuration.add(res.timings.duration);
  check(res, { "GET /api/health status 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);

  // GET /api/users
  res = http.get(`${BASE_URL}/api/users`, httpParams);
  usersDuration.add(res.timings.duration);
  check(res, { "GET /api/users status 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);

  // GET /api/users/1
  res = http.get(`${BASE_URL}/api/users/1`, httpParams);
  userByIdDuration.add(res.timings.duration);
  check(res, { "GET /api/users/1 status 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);

  // POST /api/users
  res = http.post(
    `${BASE_URL}/api/users`,
    JSON.stringify({ name: "K6 Test", email: `k6-${Date.now()}@test.com` }),
    { headers: { "Content-Type": "application/json" }, timeout: "30s" },
  );
  createUserDuration.add(res.timings.duration);
  check(res, { "POST /api/users status 201": (r) => r.status === 201 });
  errorRate.add(res.status !== 201);

  sleep(0.1);
}

export function handleSummary(data) {
  console.log("\n" + "=".repeat(70));
  console.log("QUICK PERFORMANCE TEST RESULTS");
  console.log("=".repeat(70));

  const endpoints = [
    { name: "GET /", metric: "home_duration" },
    { name: "GET /api/health", metric: "health_duration" },
    { name: "GET /api/users", metric: "users_duration" },
    { name: "GET /api/users/:id", metric: "user_by_id_duration" },
    { name: "POST /api/users", metric: "create_user_duration" },
  ];

  console.log("\nEndpoint Performance:");
  console.log("-".repeat(70));
  console.log(
    "Endpoint".padEnd(25) +
      "Avg (ms)".padStart(12) +
      "P50 (ms)".padStart(12) +
      "P95 (ms)".padStart(12) +
      "P99 (ms)".padStart(12),
  );
  console.log("-".repeat(70));

  for (const ep of endpoints) {
    const m = data.metrics[ep.metric];
    if (m) {
      console.log(
        ep.name.padEnd(25) +
          (m.values.avg?.toFixed(2) || "N/A").padStart(12) +
          (m.values["p(50)"]?.toFixed(2) || "N/A").padStart(12) +
          (m.values["p(95)"]?.toFixed(2) || "N/A").padStart(12) +
          (m.values["p(99)"]?.toFixed(2) || "N/A").padStart(12),
      );
    }
  }

  console.log("-".repeat(70));
  console.log(
    `\nTotal Requests: ${data.metrics.http_reqs?.values?.count || 0}`,
  );
  console.log(
    `Error Rate: ${((data.metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
  );
  console.log(
    `Throughput: ${(data.metrics.http_reqs?.values?.rate || 0).toFixed(2)} req/s`,
  );
  console.log("=".repeat(70) + "\n");

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
