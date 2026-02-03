import type { RouteHandler } from "./types";
import { healthCheck } from "../db/client";
import { redis } from "../cache/l2-cache";

export const home: RouteHandler = () =>
  Response.json({ message: "Welcome to my app!" });

export const health: RouteHandler = async () => {
  const start = performance.now();

  // Run health checks in parallel
  const [dbResult, redisResult] = await Promise.allSettled([
    healthCheck(),
    redis.ping(),
  ]);

  const dbLatency = performance.now() - start;
  const checks = {
    database: {
      status: dbResult.status === "fulfilled" ? "healthy" : "unhealthy",
      latencyMs: Math.round(dbLatency * 100) / 100,
    },
    redis: {
      status: redisResult.status === "fulfilled" ? "healthy" : "unhealthy",
      latencyMs: Math.round(dbLatency * 100) / 100,
    },
  };

  const allHealthy =
    checks.database.status === "healthy" && checks.redis.status === "healthy";

  return Response.json(
    {
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: checks,
    },
    { status: allHealthy ? 200 : 503 },
  );
};
