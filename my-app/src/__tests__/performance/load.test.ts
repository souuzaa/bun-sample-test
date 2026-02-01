import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";

let server: Server;
const BASE_URL = "http://localhost:3002";

interface LoadTestResult {
  success: number;
  failed: number;
  times: number[];
  avg: string;
  p50: string;
  p95: string;
  p99: string;
  min: string;
  max: string;
  rps: string;
}

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  rss: number;
}

function getMemoryUsage(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

beforeAll(async () => {
  const { handlers } = await import("../../handlers/index");
  const routesConfig = await import("../../routes.json");

  type RouteConfig = {
    method: string;
    path: string;
    handler: string;
  };

  type CompiledRoute = {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: (
      req: Request,
      params: Record<string, string>,
    ) => Response | Promise<Response>;
  };

  function compileRoute(route: RouteConfig): CompiledRoute {
    const paramNames: string[] = [];
    const patternStr = route.path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return "(\\w+)";
    });

    return {
      method: route.method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler: handlers[route.handler],
    };
  }

  const compiledRoutes = routesConfig.routes.map(compileRoute);

  function matchRoute(method: string, path: string) {
    for (const route of compiledRoutes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  server = Bun.serve({
    port: 3002,
    async fetch(req) {
      const url = new URL(req.url);
      const matched = matchRoute(req.method, url.pathname);
      if (matched) {
        return matched.handler(req, matched.params);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop();
});

async function runLoadTest(
  url: string,
  options: {
    concurrency: number;
    totalRequests: number;
    method?: string;
    body?: string;
  },
) {
  const { concurrency, totalRequests, method = "GET", body } = options;
  const results: { success: number; failed: number; times: number[] } = {
    success: 0,
    failed: 0,
    times: [],
  };

  const makeRequest = async () => {
    const start = performance.now();
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const elapsed = performance.now() - start;
      results.times.push(elapsed);
      if (response.ok || response.status === 201) {
        results.success++;
      } else {
        results.failed++;
      }
    } catch {
      results.failed++;
    }
  };

  const batches = Math.ceil(totalRequests / concurrency);
  for (let i = 0; i < batches; i++) {
    const batchSize = Math.min(concurrency, totalRequests - i * concurrency);
    await Promise.all(Array(batchSize).fill(null).map(makeRequest));
  }

  const sortedTimes = results.times.sort((a, b) => a - b);
  const avg = sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length;
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];

  const min = sortedTimes[0];
  const max = sortedTimes[sortedTimes.length - 1];

  return {
    ...results,
    avg: avg.toFixed(2),
    p50: p50.toFixed(2),
    p95: p95.toFixed(2),
    p99: p99.toFixed(2),
    min: min.toFixed(2),
    max: max.toFixed(2),
    rps: (
      results.success /
      (sortedTimes.reduce((a, b) => a + b, 0) / 1000)
    ).toFixed(2),
  };
}

async function runStressTest(
  url: string,
  options: {
    startConcurrency: number;
    maxConcurrency: number;
    step: number;
    requestsPerLevel: number;
    method?: string;
    body?: string;
  },
) {
  const {
    startConcurrency,
    maxConcurrency,
    step,
    requestsPerLevel,
    method,
    body,
  } = options;
  const levels: {
    concurrency: number;
    result: Awaited<ReturnType<typeof runLoadTest>>;
  }[] = [];

  for (
    let concurrency = startConcurrency;
    concurrency <= maxConcurrency;
    concurrency += step
  ) {
    const result = await runLoadTest(url, {
      concurrency,
      totalRequests: requestsPerLevel,
      method,
      body,
    });
    levels.push({ concurrency, result });

    // Stop if failure rate exceeds 5%
    const failureRate = result.failed / (result.success + result.failed);
    if (failureRate > 0.05) {
      break;
    }
  }

  return levels;
}

async function runSustainedLoadTest(
  url: string,
  options: {
    concurrency: number;
    durationMs: number;
    method?: string;
    body?: string;
  },
) {
  const { concurrency, durationMs, method = "GET", body } = options;
  const results: { success: number; failed: number; times: number[] } = {
    success: 0,
    failed: 0,
    times: [],
  };
  const memorySnapshots: MemorySnapshot[] = [];

  const startTime = performance.now();
  const memoryInterval = setInterval(() => {
    memorySnapshots.push(getMemoryUsage());
  }, 100);

  const makeRequest = async () => {
    const start = performance.now();
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const elapsed = performance.now() - start;
      results.times.push(elapsed);
      if (response.ok || response.status === 201) {
        results.success++;
      } else {
        results.failed++;
      }
    } catch {
      results.failed++;
    }
  };

  // Run requests continuously until duration is reached
  while (performance.now() - startTime < durationMs) {
    await Promise.all(Array(concurrency).fill(null).map(makeRequest));
  }

  clearInterval(memoryInterval);

  const sortedTimes = results.times.sort((a, b) => a - b);
  const avg = sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length;
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];

  const heapUsedValues = memorySnapshots.map((s) => s.heapUsed);
  const memoryGrowth =
    heapUsedValues.length > 1
      ? heapUsedValues[heapUsedValues.length - 1] - heapUsedValues[0]
      : 0;

  return {
    ...results,
    totalRequests: results.success + results.failed,
    actualDurationMs: performance.now() - startTime,
    avg: avg.toFixed(2),
    p50: p50.toFixed(2),
    p95: p95.toFixed(2),
    p99: p99.toFixed(2),
    rps: (results.success / ((performance.now() - startTime) / 1000)).toFixed(
      2,
    ),
    memory: {
      initial: memorySnapshots[0],
      final: memorySnapshots[memorySnapshots.length - 1],
      growth: memoryGrowth,
      peak: Math.max(...heapUsedValues),
    },
  };
}

async function runSpikeTest(
  url: string,
  options: {
    baseConcurrency: number;
    spikeConcurrency: number;
    baseRequests: number;
    spikeRequests: number;
    method?: string;
    body?: string;
  },
) {
  const {
    baseConcurrency,
    spikeConcurrency,
    baseRequests,
    spikeRequests,
    method,
    body,
  } = options;

  // Phase 1: Normal load
  const baselineResult = await runLoadTest(url, {
    concurrency: baseConcurrency,
    totalRequests: baseRequests,
    method,
    body,
  });

  // Phase 2: Spike
  const spikeResult = await runLoadTest(url, {
    concurrency: spikeConcurrency,
    totalRequests: spikeRequests,
    method,
    body,
  });

  // Phase 3: Recovery (back to normal)
  const recoveryResult = await runLoadTest(url, {
    concurrency: baseConcurrency,
    totalRequests: baseRequests,
    method,
    body,
  });

  return {
    baseline: baselineResult,
    spike: spikeResult,
    recovery: recoveryResult,
  };
}

describe("Performance Tests", () => {
  const CONCURRENCY = 50;
  const TOTAL_REQUESTS = 500;

  test("GET / - handles concurrent load", async () => {
    const results = await runLoadTest(`${BASE_URL}/`, {
      concurrency: CONCURRENCY,
      totalRequests: TOTAL_REQUESTS,
    });

    console.log(`GET / Performance:
      Total: ${results.success + results.failed} requests
      Success: ${results.success}, Failed: ${results.failed}
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(100);
  });

  test("GET /api/health - handles concurrent load", async () => {
    const results = await runLoadTest(`${BASE_URL}/api/health`, {
      concurrency: CONCURRENCY,
      totalRequests: TOTAL_REQUESTS,
    });

    console.log(`GET /api/health Performance:
      Total: ${results.success + results.failed} requests
      Success: ${results.success}, Failed: ${results.failed}
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(100);
  });

  test("GET /api/users - handles concurrent load", async () => {
    const results = await runLoadTest(`${BASE_URL}/api/users`, {
      concurrency: CONCURRENCY,
      totalRequests: TOTAL_REQUESTS,
    });

    console.log(`GET /api/users Performance:
      Total: ${results.success + results.failed} requests
      Success: ${results.success}, Failed: ${results.failed}
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(100);
  });

  test("GET /api/users/:id - handles concurrent load", async () => {
    const results = await runLoadTest(`${BASE_URL}/api/users/1`, {
      concurrency: CONCURRENCY,
      totalRequests: TOTAL_REQUESTS,
    });

    console.log(`GET /api/users/1 Performance:
      Total: ${results.success + results.failed} requests
      Success: ${results.success}, Failed: ${results.failed}
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(100);
  });

  test("POST /api/users - handles concurrent load", async () => {
    const results = await runLoadTest(`${BASE_URL}/api/users`, {
      concurrency: CONCURRENCY,
      totalRequests: TOTAL_REQUESTS,
      method: "POST",
      body: JSON.stringify({ name: "Perf Test", email: "perf@test.com" }),
    });

    console.log(`POST /api/users Performance:
      Total: ${results.success + results.failed} requests
      Success: ${results.success}, Failed: ${results.failed}
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(100);
  });
});

describe("Stress Tests", () => {
  test("GET /api/users - handles increasing load until breaking point", async () => {
    const levels = await runStressTest(`${BASE_URL}/api/users`, {
      startConcurrency: 10,
      maxConcurrency: 200,
      step: 20,
      requestsPerLevel: 100,
    });

    console.log("Stress Test Results - GET /api/users:");
    console.log("Concurrency | Success | Failed | Avg (ms) | P95 (ms) | RPS");
    console.log("-".repeat(65));
    for (const { concurrency, result } of levels) {
      console.log(
        `${concurrency.toString().padStart(11)} | ${result.success.toString().padStart(7)} | ${result.failed.toString().padStart(6)} | ${result.avg.padStart(8)} | ${result.p95.padStart(8)} | ${result.rps}`,
      );
    }

    // Should handle at least the starting concurrency without failures
    const firstLevel = levels[0];
    expect(firstLevel.result.failed).toBe(0);

    // Check if system degraded gracefully (latency increased but no crashes)
    const lastLevel = levels[levels.length - 1];
    const failureRate =
      lastLevel.result.failed /
      (lastLevel.result.success + lastLevel.result.failed);
    expect(failureRate).toBeLessThan(0.1); // Less than 10% failure rate at highest tested load
  });

  test("POST /api/users - handles increasing write load", async () => {
    const levels = await runStressTest(`${BASE_URL}/api/users`, {
      startConcurrency: 10,
      maxConcurrency: 150,
      step: 20,
      requestsPerLevel: 100,
      method: "POST",
      body: JSON.stringify({ name: "Stress Test", email: "stress@test.com" }),
    });

    console.log("\nStress Test Results - POST /api/users:");
    console.log("Concurrency | Success | Failed | Avg (ms) | P95 (ms) | RPS");
    console.log("-".repeat(65));
    for (const { concurrency, result } of levels) {
      console.log(
        `${concurrency.toString().padStart(11)} | ${result.success.toString().padStart(7)} | ${result.failed.toString().padStart(6)} | ${result.avg.padStart(8)} | ${result.p95.padStart(8)} | ${result.rps}`,
      );
    }

    const firstLevel = levels[0];
    expect(firstLevel.result.failed).toBe(0);
  });
});

describe("Sustained Load Tests (Endurance)", () => {
  test("GET /api/health - sustained load for 3 seconds with memory monitoring", async () => {
    const results = await runSustainedLoadTest(`${BASE_URL}/api/health`, {
      concurrency: 30,
      durationMs: 3000,
    });

    console.log(`\nSustained Load Test - GET /api/health (3s):
      Total Requests: ${results.totalRequests}
      Success: ${results.success}, Failed: ${results.failed}
      Duration: ${(results.actualDurationMs / 1000).toFixed(2)}s
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s
      Memory:
        Initial Heap: ${formatBytes(results.memory.initial?.heapUsed || 0)}
        Final Heap: ${formatBytes(results.memory.final?.heapUsed || 0)}
        Peak Heap: ${formatBytes(results.memory.peak)}
        Growth: ${formatBytes(results.memory.growth)}`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(50);
    // Memory growth should be reasonable (less than 50MB over the test)
    expect(results.memory.growth).toBeLessThan(50 * 1024 * 1024);
  });

  test("GET /api/users - sustained load for 3 seconds", async () => {
    const results = await runSustainedLoadTest(`${BASE_URL}/api/users`, {
      concurrency: 30,
      durationMs: 3000,
    });

    console.log(`\nSustained Load Test - GET /api/users (3s):
      Total Requests: ${results.totalRequests}
      Success: ${results.success}, Failed: ${results.failed}
      Duration: ${(results.actualDurationMs / 1000).toFixed(2)}s
      Avg: ${results.avg}ms, P50: ${results.p50}ms, P95: ${results.p95}ms, P99: ${results.p99}ms
      Throughput: ${results.rps} req/s
      Memory Growth: ${formatBytes(results.memory.growth)}`);

    expect(results.failed).toBe(0);
    expect(Number(results.avg)).toBeLessThan(50);
  });
});

describe("Spike Tests", () => {
  test("GET /api/users - handles sudden traffic spike and recovers", async () => {
    const results = await runSpikeTest(`${BASE_URL}/api/users`, {
      baseConcurrency: 10,
      spikeConcurrency: 100,
      baseRequests: 100,
      spikeRequests: 500,
    });

    console.log(`\nSpike Test - GET /api/users:
      Phase 1 (Baseline):
        Concurrency: 10, Requests: 100
        Avg: ${results.baseline.avg}ms, P95: ${results.baseline.p95}ms
        RPS: ${results.baseline.rps}, Failed: ${results.baseline.failed}

      Phase 2 (Spike - 10x traffic):
        Concurrency: 100, Requests: 500
        Avg: ${results.spike.avg}ms, P95: ${results.spike.p95}ms
        RPS: ${results.spike.rps}, Failed: ${results.spike.failed}

      Phase 3 (Recovery):
        Concurrency: 10, Requests: 100
        Avg: ${results.recovery.avg}ms, P95: ${results.recovery.p95}ms
        RPS: ${results.recovery.rps}, Failed: ${results.recovery.failed}`);

    // Baseline should have no failures
    expect(results.baseline.failed).toBe(0);

    // Spike phase should handle load (allowing some degradation)
    const spikeFailureRate =
      results.spike.failed / (results.spike.success + results.spike.failed);
    expect(spikeFailureRate).toBeLessThan(0.05); // Less than 5% failure during spike

    // Recovery should return to normal performance
    expect(results.recovery.failed).toBe(0);
    // Recovery latency should be within 2x of baseline
    expect(Number(results.recovery.avg)).toBeLessThan(
      Number(results.baseline.avg) * 2 + 10,
    );
  });

  test("POST /api/users - handles write spike and recovers", async () => {
    const results = await runSpikeTest(`${BASE_URL}/api/users`, {
      baseConcurrency: 5,
      spikeConcurrency: 50,
      baseRequests: 50,
      spikeRequests: 200,
      method: "POST",
      body: JSON.stringify({ name: "Spike Test", email: "spike@test.com" }),
    });

    console.log(`\nSpike Test - POST /api/users:
      Phase 1 (Baseline): Avg: ${results.baseline.avg}ms, Failed: ${results.baseline.failed}
      Phase 2 (Spike 10x): Avg: ${results.spike.avg}ms, Failed: ${results.spike.failed}
      Phase 3 (Recovery): Avg: ${results.recovery.avg}ms, Failed: ${results.recovery.failed}`);

    expect(results.baseline.failed).toBe(0);
    expect(results.recovery.failed).toBe(0);
  });
});

describe("Memory Profiling", () => {
  test("detects memory leaks under repeated load", async () => {
    const iterations = 5;
    const memoryReadings: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Force garbage collection if available (run with --expose-gc)
      if (global.gc) {
        global.gc();
      }

      await runLoadTest(`${BASE_URL}/api/users`, {
        concurrency: 50,
        totalRequests: 200,
      });

      const mem = process.memoryUsage();
      memoryReadings.push(mem.heapUsed);
    }

    console.log("\nMemory Profile (heap used after each iteration):");
    memoryReadings.forEach((mem, i) => {
      console.log(`  Iteration ${i + 1}: ${formatBytes(mem)}`);
    });

    const firstReading = memoryReadings[0];
    const lastReading = memoryReadings[memoryReadings.length - 1];
    const totalGrowth = lastReading - firstReading;

    console.log(`  Total Growth: ${formatBytes(totalGrowth)}`);

    // Memory should not grow excessively (less than 50MB over all iterations)
    // Note: Some growth is expected due to user data accumulation from POST tests
    expect(totalGrowth).toBeLessThan(50 * 1024 * 1024);
  });
});
