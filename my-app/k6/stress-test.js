import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const errorRate = new Rate("errors");
const requestDuration = new Trend("request_duration", true);

// Use localhost for native k6, host.docker.internal for Docker
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Stress test - ramping up load to find breaking point
// Similar to our Bun stress test with increasing concurrency
export const options = {
  stages: [
    { duration: "10s", target: 10 }, // Warm up
    { duration: "10s", target: 30 }, // Ramp up
    { duration: "10s", target: 50 }, // Continue ramping
    { duration: "10s", target: 70 }, // More load
    { duration: "10s", target: 90 }, // Even more
    { duration: "10s", target: 110 }, // High load
    { duration: "10s", target: 130 }, // Very high
    { duration: "10s", target: 150 }, // Near breaking point
    { duration: "10s", target: 170 }, // Push further
    { duration: "10s", target: 190 }, // Maximum
    { duration: "20s", target: 0 }, // Cool down
  ],
  thresholds: {
    http_req_failed: ["rate<0.10"], // Allow up to 10% failure at peak
    errors: ["rate<0.10"],
  },
};

export default function () {
  const endpoints = [
    { method: "GET", path: "/api/users" },
    { method: "GET", path: "/api/users/1" },
    { method: "GET", path: "/api/health" },
    { method: "GET", path: "/" },
  ];

  // Randomly select an endpoint
  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];

  const res = http.get(`${BASE_URL}${ep.path}`, {
    tags: { endpoint: ep.path },
  });

  requestDuration.add(res.timings.duration);

  const success = res.status >= 200 && res.status < 300;
  errorRate.add(!success);

  check(res, {
    "status is 2xx": (r) => r.status >= 200 && r.status < 300,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  sleep(0.05);
}

export function handleSummary(data) {
  console.log("\n" + "=".repeat(70));
  console.log("STRESS TEST RESULTS");
  console.log("=".repeat(70));
  console.log(
    "\nThis test ramps VUs from 10 to 190 to find the breaking point.",
  );
  console.log("-".repeat(70));

  const metrics = data.metrics;

  console.log("\nOverall Results:");
  console.log(`  Total Requests: ${metrics.http_reqs?.values?.count || 0}`);
  console.log(
    `  Failed Requests: ${metrics.http_req_failed?.values?.passes || 0}`,
  );
  console.log(
    `  Error Rate: ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Throughput: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)} req/s`,
  );

  console.log("\nLatency:");
  console.log(
    `  Average: ${metrics.http_req_duration?.values?.avg?.toFixed(2) || 0}ms`,
  );
  console.log(
    `  P50: ${metrics.http_req_duration?.values?.["p(50)"]?.toFixed(2) || 0}ms`,
  );
  console.log(
    `  P95: ${metrics.http_req_duration?.values?.["p(95)"]?.toFixed(2) || 0}ms`,
  );
  console.log(
    `  P99: ${metrics.http_req_duration?.values?.["p(99)"]?.toFixed(2) || 0}ms`,
  );
  console.log(
    `  Max: ${metrics.http_req_duration?.values?.max?.toFixed(2) || 0}ms`,
  );

  console.log("=".repeat(70) + "\n");

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
