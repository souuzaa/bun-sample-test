import type { RouteHandler } from "./types";
import { healthCheck } from "../db/client";
import { redis } from "../cache/l2-cache";

export const home: RouteHandler = () =>
  Response.json({ message: "Welcome to my app!" });

export const health: RouteHandler = async () => {
  const checks = {
    database: { status: "unhealthy" as "healthy" | "unhealthy", latencyMs: 0 },
    redis: { status: "unhealthy" as "healthy" | "unhealthy", latencyMs: 0 },
  };

  // Check database
  const dbStart = performance.now();
  try {
    await healthCheck();
    checks.database.status = "healthy";
    checks.database.latencyMs =
      Math.round((performance.now() - dbStart) * 100) / 100;
  } catch {
    checks.database.latencyMs =
      Math.round((performance.now() - dbStart) * 100) / 100;
  }

  // Check Redis
  const redisStart = performance.now();
  try {
    await redis.ping();
    checks.redis.status = "healthy";
    checks.redis.latencyMs =
      Math.round((performance.now() - redisStart) * 100) / 100;
  } catch {
    checks.redis.latencyMs =
      Math.round((performance.now() - redisStart) * 100) / 100;
  }

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
