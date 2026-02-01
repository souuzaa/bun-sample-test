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
  params: Record<string, string>
) => Response | Promise<Response>;

export function withMetrics(handler: MiddlewareHandler): MiddlewareHandler {
  return async (req: Request, params: Record<string, string>) => {
    const startTime = performance.now();
    const url = new URL(req.url);
    const route = url.pathname;
    const method = req.method;

    incrementActiveConnections();
    incrementRequestCount();

    try {
      const response = await handler(req, params);
      const duration = performance.now() - startTime;
      const status = response.status.toString();
      const statusClass = `${Math.floor(response.status / 100)}xx`;

      // Record metrics
      httpRequestsTotal.add(1, {
        method,
        route,
        status,
        status_class: statusClass,
      });

      httpRequestDuration.record(duration, {
        method,
        route,
        status,
      });

      // Try to get response size from Content-Length header
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        httpResponseSize.record(parseInt(contentLength, 10), {
          method,
          route,
        });
      }

      // Track errors (4xx and 5xx)
      if (response.status >= 400) {
        httpErrorsTotal.add(1, {
          method,
          route,
          status,
          status_class: statusClass,
        });
      }

      decrementActiveConnections();
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;

      httpRequestsTotal.add(1, {
        method,
        route,
        status: "500",
        status_class: "5xx",
      });

      httpRequestDuration.record(duration, {
        method,
        route,
        status: "500",
      });

      httpErrorsTotal.add(1, {
        method,
        route,
        status: "500",
        status_class: "5xx",
      });

      decrementActiveConnections();
      throw error;
    }
  };
}
