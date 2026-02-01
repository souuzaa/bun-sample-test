import type { RouteHandler } from "./types";

export const home: RouteHandler = () =>
  Response.json({ message: "Welcome to my app!" });

export const health: RouteHandler = () =>
  Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
