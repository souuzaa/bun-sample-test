import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Gauge } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const errorRate = new Rate("errors");
const requestDuration = new Trend("request_duration", true);

// Use localhost for native k6, host.docker.internal for Docker
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Soak/Endurance test - sustained load over time
// Similar to our Bun sustained load test
// Use shorter duration for CI, longer for real soak tests
export const options = {
  stages: [
    { duration: "30s", target: 30 }, // Ramp up
    { duration: "2m", target: 30 }, // Sustained load (increase for real soak tests)
    { duration: "30s", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<50", "p(99)<100"],
    http_req_failed: ["rate<0.01"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  // Health check
  let res = http.get(`${BASE_URL}/api/health`);
  check(res, { "health ok": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  requestDuration.add(res.timings.duration);

  // Users list
  res = http.get(`${BASE_URL}/api/users`);
  check(res, { "users ok": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  requestDuration.add(res.timings.duration);

  // User detail
  res = http.get(`${BASE_URL}/api/users/1`);
  check(res, { "user detail ok": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  requestDuration.add(res.timings.duration);

  sleep(0.1);
}

export function handleSummary(data) {
  console.log("\n" + "=".repeat(70));
  console.log("SOAK/ENDURANCE TEST RESULTS");
  console.log("=".repeat(70));
  console.log(
    "\nThis test runs sustained load to detect memory leaks and degradation.",
  );
  console.log("-".repeat(70));

  const metrics = data.metrics;
  const duration = data.state?.testRunDurationMs || 0;

  console.log(`\nTest Duration: ${(duration / 1000 / 60).toFixed(2)} minutes`);
  console.log(`Total Requests: ${metrics.http_reqs?.values?.count || 0}`);
  console.log(
    `Failed Requests: ${metrics.http_req_failed?.values?.passes || 0}`,
  );
  console.log(
    `Error Rate: ${((metrics.errors?.values?.rate || 0) * 100).toFixed(4)}%`,
  );
  console.log(
    `Throughput: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)} req/s`,
  );

  console.log("\nLatency Statistics:");
  console.log(
    `  Average: ${metrics.http_req_duration?.values?.avg?.toFixed(2) || 0}ms`,
  );
  console.log(
    `  Median (P50): ${metrics.http_req_duration?.values?.["p(50)"]?.toFixed(2) || 0}ms`,
  );
  console.log(
    `  P90: ${metrics.http_req_duration?.values?.["p(90)"]?.toFixed(2) || 0}ms`,
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
  console.log(
    `  Min: ${metrics.http_req_duration?.values?.min?.toFixed(2) || 0}ms`,
  );

  // Stability check
  const p95 = metrics.http_req_duration?.values?.["p(95)"] || 0;
  const p99 = metrics.http_req_duration?.values?.["p(99)"] || 0;
  const errorRateValue = metrics.errors?.values?.rate || 0;

  console.log("\nStability Assessment:");
  if (p95 < 50 && p99 < 100 && errorRateValue < 0.01) {
    console.log("  Status: STABLE - System maintained good performance");
  } else if (p95 < 100 && errorRateValue < 0.05) {
    console.log("  Status: ACCEPTABLE - Some degradation but within limits");
  } else {
    console.log("  Status: DEGRADED - Performance issues detected");
  }

  console.log(
    "\nNote: For production soak tests, run for 1-4 hours with monitoring.",
  );
  console.log("=".repeat(70) + "\n");

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
