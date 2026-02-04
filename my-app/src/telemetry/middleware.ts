import {
  httpRequestsTotal,
  httpRequestDuration,
  incrementRequestCount,
  incrementActiveConnections,
  decrementActiveConnections,
} from "./metrics";

export type MiddlewareHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

/**
 * Wraps a request handler to record active connections and HTTP request metrics.
 *
 * The returned handler increments and decrements active connection counts, records total requests and request duration, and otherwise forwards the original handler's response (rethrowing any errors).
 *
 * @param handler - The request handler to wrap
 * @returns A handler that records metrics for each invocation and returns the original handler's response
 */
export function withMetrics(handler: MiddlewareHandler): MiddlewareHandler {
  return async (req: Request, params: Record<string, string>) => {
    const startTime = performance.now();

    incrementActiveConnections();
    incrementRequestCount();

    try {
      const response = await handler(req, params);

      // Record minimal metrics
      httpRequestsTotal.add(1, { status: response.status.toString() });
      httpRequestDuration.record(performance.now() - startTime, {});

      decrementActiveConnections();
      return response;
    } catch (error) {
      httpRequestsTotal.add(1, { status: "500" });
      httpRequestDuration.record(performance.now() - startTime, {});
      decrementActiveConnections();
      throw error;
    }
  };
}