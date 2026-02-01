import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

const errorRate = new Rate("errors");
const baselineDuration = new Trend("baseline_duration", true);
const spikeDuration = new Trend("spike_duration", true);
const recoveryDuration = new Trend("recovery_duration", true);

// Use localhost for native k6, host.docker.internal for Docker
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Spike test - sudden traffic burst and recovery
// Similar to our Bun spike test: baseline -> 10x spike -> recovery
export const options = {
  stages: [
    { duration: "15s", target: 10 }, // Phase 1: Baseline (10 VUs)
    { duration: "5s", target: 100 }, // Spike up to 100 VUs
    { duration: "30s", target: 100 }, // Phase 2: Spike (stay at 100)
    { duration: "5s", target: 10 }, // Recover back to 10 VUs
    { duration: "15s", target: 10 }, // Phase 3: Recovery (10 VUs)
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // Less than 5% failure during spike
    errors: ["rate<0.05"],
  },
};

// Track which phase we're in based on VU count
function getPhase(vus) {
  if (vus <= 15) return "baseline";
  if (vus >= 90) return "spike";
  return "transition";
}

export default function () {
  const currentVUs = __VU;
  const phase = getPhase(currentVUs);

  // Mix of read (80%) and write (20%) operations
  const isWrite = Math.random() < 0.2;

  let res;
  if (isWrite) {
    res = http.post(
      `${BASE_URL}/api/users`,
      JSON.stringify({
        name: `Spike ${phase} ${Date.now()}`,
        email: `spike-${Date.now()}@test.com`,
      }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { phase: phase, operation: "write" },
      },
    );

    check(res, {
      "POST status is 201": (r) => r.status === 201,
    });
    errorRate.add(res.status !== 201);
  } else {
    const readEndpoints = ["/", "/api/health", "/api/users", "/api/users/1"];
    const endpoint =
      readEndpoints[Math.floor(Math.random() * readEndpoints.length)];

    res = http.get(`${BASE_URL}${endpoint}`, {
      tags: { phase: phase, operation: "read", endpoint: endpoint },
    });

    check(res, {
      "GET status is 200": (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
  }

  // Track duration by phase
  if (phase === "baseline") {
    baselineDuration.add(res.timings.duration);
  } else if (phase === "spike") {
    spikeDuration.add(res.timings.duration);
  } else {
    recoveryDuration.add(res.timings.duration);
  }

  sleep(0.05);
}

export function handleSummary(data) {
  console.log("\n" + "=".repeat(70));
  console.log("SPIKE TEST RESULTS");
  console.log("=".repeat(70));
  console.log("\nTest Phases:");
  console.log("  Phase 1 (Baseline): 10 VUs for 15s");
  console.log("  Phase 2 (Spike): 100 VUs for 30s (10x traffic)");
  console.log("  Phase 3 (Recovery): Back to 10 VUs for 15s");
  console.log("-".repeat(70));

  const metrics = data.metrics;

  console.log("\nPhase Comparison:");
  console.log("-".repeat(70));
  console.log(
    "Phase".padEnd(15) +
      "Avg (ms)".padStart(12) +
      "P50 (ms)".padStart(12) +
      "P95 (ms)".padStart(12) +
      "P99 (ms)".padStart(12),
  );
  console.log("-".repeat(70));

  const phases = [
    { name: "Baseline", metric: "baseline_duration" },
    { name: "Spike", metric: "spike_duration" },
    { name: "Recovery", metric: "recovery_duration" },
  ];

  for (const phase of phases) {
    const m = metrics[phase.metric];
    if (m && m.values.count > 0) {
      console.log(
        phase.name.padEnd(15) +
          (m.values.avg?.toFixed(2) || "N/A").padStart(12) +
          (m.values["p(50)"]?.toFixed(2) || "N/A").padStart(12) +
          (m.values["p(95)"]?.toFixed(2) || "N/A").padStart(12) +
          (m.values["p(99)"]?.toFixed(2) || "N/A").padStart(12),
      );
    }
  }

  console.log("-".repeat(70));
  console.log(`\nOverall Results:`);
  console.log(`  Total Requests: ${metrics.http_reqs?.values?.count || 0}`);
  console.log(
    `  Error Rate: ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
  );
  console.log(
    `  Throughput: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)} req/s`,
  );

  // Check if system recovered properly
  const baselineAvg = metrics.baseline_duration?.values?.avg || 0;
  const recoveryAvg = metrics.recovery_duration?.values?.avg || 0;
  const recoveryRatio = recoveryAvg / baselineAvg;

  console.log(`\nRecovery Analysis:`);
  console.log(`  Baseline Avg: ${baselineAvg.toFixed(2)}ms`);
  console.log(`  Recovery Avg: ${recoveryAvg.toFixed(2)}ms`);
  console.log(`  Recovery Ratio: ${recoveryRatio.toFixed(2)}x`);

  if (recoveryRatio <= 2) {
    console.log(`  Status: GOOD - System recovered well`);
  } else {
    console.log(
      `  Status: WARNING - Recovery latency is ${recoveryRatio.toFixed(1)}x baseline`,
    );
  }

  console.log("=".repeat(70) + "\n");

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
