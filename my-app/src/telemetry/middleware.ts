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
