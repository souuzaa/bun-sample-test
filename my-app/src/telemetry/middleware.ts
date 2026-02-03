import {
  httpRequestsTotal,
  httpRequestDuration,
  httpErrorsTotal,
  httpResponseSize,
  incrementRequestCount,
  incrementActiveConnections,
  decrementActiveConnections,
} from "./metrics";

export type MiddlewareHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

// Pre-computed status class lookup
const STATUS_CLASS = ["", "1xx", "2xx", "3xx", "4xx", "5xx"];

export function withMetrics(handler: MiddlewareHandler): MiddlewareHandler {
  return async (req: Request, params: Record<string, string>) => {
    const startTime = performance.now();
    const method = req.method;

    incrementActiveConnections();

    try {
      const response = await handler(req, params);
      const duration = performance.now() - startTime;
      const status = response.status;
      const statusStr = status.toString();
      const statusClass = STATUS_CLASS[Math.floor(status / 100)] || "5xx";

      // Record metrics (batched)
      httpRequestsTotal.add(1, {
        method,
        status: statusStr,
        status_class: statusClass,
      });
      httpRequestDuration.record(duration, { method, status: statusStr });

      // Track errors (4xx and 5xx) only
      if (status >= 400) {
        httpErrorsTotal.add(1, {
          method,
          status: statusStr,
          status_class: statusClass,
        });
      }

      decrementActiveConnections();
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;

      httpRequestsTotal.add(1, { method, status: "500", status_class: "5xx" });
      httpRequestDuration.record(duration, { method, status: "500" });
      httpErrorsTotal.add(1, { method, status: "500", status_class: "5xx" });

      decrementActiveConnections();
      throw error;
    }
  };
}
