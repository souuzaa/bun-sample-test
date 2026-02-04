import type { RouteHandler } from "./types";
import { sql } from "../db/client";

// Worker pool for CPU-intensive hash operations (scaled for higher throughput)
const WORKER_POOL_SIZE = 8;
const workerPool: Worker[] = [];
const workerQueue: Array<{
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  data: string;
  iterations: number;
}> = [];
const busyWorkers = new Set<Worker>();

// Initialize worker pool
for (let i = 0; i < WORKER_POOL_SIZE; i++) {
  const worker = new Worker(
    new URL("../workers/hash-worker.ts", import.meta.url).href,
  );
  workerPool.push(worker);
}

/**
 * Selects the first non-busy worker from the worker pool.
 *
 * @returns The first idle `Worker` from the pool, or `null` if no workers are available.
 */
function getAvailableWorker(): Worker | null {
  for (const worker of workerPool) {
    if (!busyWorkers.has(worker)) {
      return worker;
    }
  }
  return null;
}

/**
 * Assigns pending hash tasks to idle workers and drives their completion callbacks.
 *
 * Processes tasks from the internal queue while workers are available: assigns each task to a worker, marks the worker busy, attaches success and error listeners that resolve or reject the task's promise, remove listeners, mark the worker as free, and continue processing remaining queued tasks.
 */
function processQueue() {
  while (workerQueue.length > 0) {
    const worker = getAvailableWorker();
    if (!worker) break;

    const task = workerQueue.shift()!;
    busyWorkers.add(worker);

    const handler = (event: MessageEvent) => {
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", errorHandler);
      busyWorkers.delete(worker);
      task.resolve(event.data.hash);
      processQueue();
    };

    const errorHandler = (error: ErrorEvent) => {
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", errorHandler);
      busyWorkers.delete(worker);
      task.reject(new Error(error.message));
      processQueue();
    };

    worker.addEventListener("message", handler);
    worker.addEventListener("error", errorHandler);
    worker.postMessage({ data: task.data, iterations: task.iterations });
  }
}

/**
 * Enqueues a hashing task to be processed by the worker pool.
 *
 * @param data - The input string to be hashed
 * @param iterations - The number of hash iterations to perform (will be capped elsewhere)
 * @returns The resulting hash as a hexadecimal string, or rejects if the worker fails to compute the hash
 */
function hashInWorker(data: string, iterations: number): Promise<string> {
  return new Promise((resolve, reject) => {
    workerQueue.push({ resolve, reject, data, iterations });
    processQueue();
  });
}

/**
 * CPU-intensive workload: Hash iterations (runs in worker thread)
 * POST /api/workload/hash
 * Body: { data: string, iterations?: number }
 */
export const hashWorkload: RouteHandler = async (req) => {
  try {
    const body = (await req.json()) as { data?: string; iterations?: number };
    const { data, iterations = 10000 } = body;

    if (!data) {
      return Response.json({ error: "data is required" }, { status: 400 });
    }

    // Cap iterations to prevent extreme CPU usage
    const cappedIterations = Math.min(iterations, 100000);

    const start = performance.now();

    // Run hash computation in worker thread
    const hashResult = await hashInWorker(data, cappedIterations);

    const processingTimeMs = performance.now() - start;

    // Store in database (fire and forget for performance)
    sql`
      INSERT INTO hash_jobs (input_data, hash_result, iterations, processing_time_ms)
      VALUES (${data}, ${hashResult}, ${cappedIterations}, ${processingTimeMs})
    `.catch(() => {});

    return Response.json({
      hash: hashResult,
      iterations: cappedIterations,
      processingTimeMs: Math.round(processingTimeMs * 100) / 100,
    });
  } catch (error) {
    console.error("Error in hash workload:", error);
    return Response.json({ error: "Hash workload failed" }, { status: 500 });
  }
};

/**
 * Bandwidth-intensive workload: Variable payload generation
 * POST /api/workload/payload
 * Body: { size_kb?: number }
 */
export const payloadWorkload: RouteHandler = async (req) => {
  try {
    const body = (await req.json()) as { size_kb?: number };
    const sizeKb = Math.min(body.size_kb || 100, 1000); // Max 1MB for better throughput

    const start = performance.now();

    // Generate random data
    const data = new Uint8Array(sizeKb * 1024);
    crypto.getRandomValues(data);

    const processingTimeMs = performance.now() - start;

    // Store metadata only (fire and forget for performance)
    sql`
      INSERT INTO payloads (size_kb)
      VALUES (${sizeKb})
    `.catch(() => {});

    // Convert to base64 for JSON response
    const base64Data = Buffer.from(data).toString("base64");

    return Response.json({
      size_kb: sizeKb,
      data: base64Data,
      processingTimeMs: Math.round(processingTimeMs * 100) / 100,
    });
  } catch (error) {
    console.error("Error in payload workload:", error);
    return Response.json({ error: "Payload workload failed" }, { status: 500 });
  }
};

/**
 * Memory-intensive workload: Allocation churn
 * POST /api/workload/memory
 * Body: { allocate_mb?: number, duration_ms?: number }
 */
export const memoryWorkload: RouteHandler = async (req) => {
  try {
    const body = (await req.json()) as {
      allocate_mb?: number;
      duration_ms?: number;
    };
    const allocateMb = Math.min(body.allocate_mb || 10, 100); // Max 100MB
    const durationMs = Math.min(body.duration_ms || 100, 5000); // Max 5s

    const start = performance.now();

    // Allocate memory
    const buffers: Uint8Array[] = [];
    for (let i = 0; i < allocateMb; i++) {
      buffers.push(new Uint8Array(1024 * 1024)); // 1MB each
    }

    // Hold for duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));

    // Release (hint to GC)
    buffers.length = 0;

    const processingTimeMs = performance.now() - start;

    return Response.json({
      allocated_mb: allocateMb,
      held_ms: durationMs,
      processingTimeMs: Math.round(processingTimeMs * 100) / 100,
    });
  } catch (error) {
    console.error("Error in memory workload:", error);
    return Response.json({ error: "Memory workload failed" }, { status: 500 });
  }
};

/**
 * Workload status endpoint
 * GET /api/workload/status
 */
export const workloadStatus: RouteHandler = async () => {
  try {
    // Run both queries in parallel
    const [hashStatsResult, payloadStatsResult] = await Promise.all([
      sql`
        SELECT
          COUNT(*) as total_jobs,
          AVG(processing_time_ms) as avg_time_ms,
          MAX(processing_time_ms) as max_time_ms,
          MIN(processing_time_ms) as min_time_ms
        FROM hash_jobs
        WHERE created_at > NOW() - INTERVAL '1 hour'
      `,
      sql`
        SELECT
          COUNT(*) as total_payloads,
          SUM(size_kb) as total_kb,
          AVG(size_kb) as avg_size_kb
        FROM payloads
        WHERE created_at > NOW() - INTERVAL '1 hour'
      `,
    ]);

    const hashStats = hashStatsResult[0];
    const payloadStats = payloadStatsResult[0];

    return Response.json({
      hash_jobs: {
        total_jobs: Number(hashStats.totalJobs) || 0,
        avg_time_ms: hashStats.avgTimeMs
          ? Math.round(Number(hashStats.avgTimeMs) * 100) / 100
          : 0,
        max_time_ms: hashStats.maxTimeMs
          ? Math.round(Number(hashStats.maxTimeMs) * 100) / 100
          : 0,
        min_time_ms: hashStats.minTimeMs
          ? Math.round(Number(hashStats.minTimeMs) * 100) / 100
          : 0,
      },
      payloads: {
        total_payloads: Number(payloadStats.totalPayloads) || 0,
        total_kb: Number(payloadStats.totalKb) || 0,
        avg_size_kb: payloadStats.avgSizeKb
          ? Math.round(Number(payloadStats.avgSizeKb) * 100) / 100
          : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching workload status:", error);
    return Response.json(
      { error: "Failed to fetch workload status" },
      { status: 500 },
    );
  }
};