import { handlers, type RouteHandler } from "./handlers/index";
import routesConfig from "./routes.json";
import { withMetrics } from "./telemetry";
import { requestQueueTime } from "./telemetry/metrics";
import { registerKernelMetrics } from "./telemetry/kernel-metrics";

// Initialize telemetry (imports will start the metrics server)
import "./telemetry/metrics";

// Register kernel metrics (TCP states, retransmits, etc.)
registerKernelMetrics();

type RouteConfig = {
  method: string;
  path: string;
  handler: string;
};

type CompiledRoute = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  routeName: string;
};

function compileRoute(route: RouteConfig): CompiledRoute {
  const paramNames: string[] = [];
  const patternStr = route.path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "(\\w+)";
  });

  const handler = handlers[route.handler];
  if (!handler) {
    throw new Error(
      `Handler "${route.handler}" not found for route ${route.method} ${route.path}`,
    );
  }

  return {
    method: route.method,
    pattern: new RegExp(`^${patternStr}$`),
    paramNames,
    handler: withMetrics(handler),
    routeName: route.path,
  };
}

const compiledRoutes = routesConfig.routes.map(compileRoute);

function matchRoute(
  method: string,
  path: string,
): {
  handler: RouteHandler;
  params: Record<string, string>;
  routeName: string;
} | null {
  for (const route of compiledRoutes) {
    if (route.method !== method) continue;

    const match = path.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { handler: route.handler, params, routeName: route.routeName };
    }
  }
  return null;
}

const server = Bun.serve({
  port: 3000,
  reusePort: true,
  async fetch(req) {
    // Record arrival time immediately for queue time metric
    const arrivalTime = performance.now();

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    const matched = matchRoute(method, path);
    if (matched) {
      // Record queue time (time from arrival to handler start)
      const handlerStartTime = performance.now();
      const queueTime = handlerStartTime - arrivalTime;
      requestQueueTime.record(queueTime, {
        route: matched.routeName,
        method: method,
      });

      return matched.handler(req, matched.params);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`API server running at http://localhost:${server.port}`);
