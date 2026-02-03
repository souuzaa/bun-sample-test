import type { RouteHandler } from "./types";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { sql } from "../db/client";

/**
 * CPU-intensive workload: Hash iterations
 * POST /api/workload/hash
 * Body: { data: string, iterations?: number }
 */
export const hashWorkload: RouteHandler = async (req) => {
  try {
    const body = await req.json() as { data?: string; iterations?: number };
    const { data, iterations = 10000 } = body;

    if (!data) {
      return Response.json({ error: "data is required" }, { status: 400 });
    }

    const start = performance.now();

    // Use @noble/hashes for better performance than Bun's native crypto
    let hash = new TextEncoder().encode(data);
    for (let i = 0; i < iterations; i++) {
      hash = sha256(hash);
    }
    const hashResult = bytesToHex(hash);

    const processingTimeMs = performance.now() - start;

    // Store in database
    await sql`
      INSERT INTO hash_jobs (input_data, hash_result, iterations, processing_time_ms)
      VALUES (${data}, ${hashResult}, ${iterations}, ${processingTimeMs})
    `;

    return Response.json({
      hash: hashResult,
      iterations,
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
    const body = await req.json() as { size_kb?: number };
    const sizeKb = Math.min(body.size_kb || 100, 10000); // Max 10MB

    const start = performance.now();

    // Generate random data
    const data = new Uint8Array(sizeKb * 1024);
    crypto.getRandomValues(data);

    const processingTimeMs = performance.now() - start;

    // Store metadata (not the full payload for large sizes)
    if (sizeKb <= 100) {
      await sql`
        INSERT INTO payloads (size_kb, data)
        VALUES (${sizeKb}, ${Buffer.from(data)})
      `;
    } else {
      // Just store metadata for large payloads
      await sql`
        INSERT INTO payloads (size_kb)
        VALUES (${sizeKb})
      `;
    }

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
    const body = await req.json() as { allocate_mb?: number; duration_ms?: number };
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
    const [hashStats] = await sql`
      SELECT
        COUNT(*) as total_jobs,
        AVG(processing_time_ms) as avg_time_ms,
        MAX(processing_time_ms) as max_time_ms,
        MIN(processing_time_ms) as min_time_ms
      FROM hash_jobs
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `;

    const [payloadStats] = await sql`
      SELECT
        COUNT(*) as total_payloads,
        SUM(size_kb) as total_kb,
        AVG(size_kb) as avg_size_kb
      FROM payloads
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `;

    return Response.json({
      hash_jobs: {
        total_jobs: Number(hashStats.totalJobs) || 0,
        avg_time_ms: hashStats.avgTimeMs ? Math.round(Number(hashStats.avgTimeMs) * 100) / 100 : 0,
        max_time_ms: hashStats.maxTimeMs ? Math.round(Number(hashStats.maxTimeMs) * 100) / 100 : 0,
        min_time_ms: hashStats.minTimeMs ? Math.round(Number(hashStats.minTimeMs) * 100) / 100 : 0,
      },
      payloads: {
        total_payloads: Number(payloadStats.totalPayloads) || 0,
        total_kb: Number(payloadStats.totalKb) || 0,
        avg_size_kb: payloadStats.avgSizeKb ? Math.round(Number(payloadStats.avgSizeKb) * 100) / 100 : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching workload status:", error);
    return Response.json({ error: "Failed to fetch workload status" }, { status: 500 });
  }
};
