import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type {
  Meter,
  Counter,
  Histogram,
  ObservableGauge,
} from "@opentelemetry/api";

// Prometheus exporter configuration
const prometheusExporter = new PrometheusExporter({
  port: 9464,
  endpoint: "/metrics",
});

// Create meter provider with resource attributes
const meterProvider = new MeterProvider({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "my-app",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  }),
  readers: [prometheusExporter],
});

// Get the meter
const meter: Meter = meterProvider.getMeter("my-app-metrics", "1.0.0");

// HTTP Metrics
export const httpRequestsTotal: Counter = meter.createCounter(
  "http_requests_total",
  {
    description: "Total number of HTTP requests",
    unit: "requests",
  },
);

export const httpRequestDuration: Histogram = meter.createHistogram(
  "http_request_duration_ms",
  {
    description: "HTTP request duration in milliseconds",
    unit: "ms",
    advice: {
      explicitBucketBoundaries: [
        1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
      ],
    },
  },
);

export const httpRequestsInFlight: Counter = meter.createCounter(
  "http_requests_in_flight",
  {
    description: "Number of HTTP requests currently being processed",
    unit: "requests",
  },
);

export const httpResponseSize: Histogram = meter.createHistogram(
  "http_response_size_bytes",
  {
    description: "HTTP response size in bytes",
    unit: "bytes",
    advice: {
      explicitBucketBoundaries: [100, 500, 1000, 5000, 10000, 50000, 100000],
    },
  },
);

// ============================================================
// Extreme Performance Architecture Metrics
// ============================================================

// Request queue time - THE key saturation metric
export const requestQueueTime: Histogram = meter.createHistogram(
  "http_request_queue_time_ms",
  {
    description: "Time between request arrival and handler execution start",
    unit: "ms",
    advice: {
      explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
    },
  },
);

// Cache metrics
export const cacheHitCounter: Counter = meter.createCounter(
  "cache_hits_total",
  {
    description: "Total cache hits",
  },
);

export const cacheMissCounter: Counter = meter.createCounter(
  "cache_misses_total",
  {
    description: "Total cache misses",
  },
);

export const cacheLatency: Histogram = meter.createHistogram(
  "cache_latency_ms",
  {
    description: "Cache operation latency",
    unit: "ms",
    advice: {
      explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    },
  },
);

// Database metrics
export const dbQueryDuration: Histogram = meter.createHistogram(
  "pg_query_duration_ms",
  {
    description: "PostgreSQL query duration",
    unit: "ms",
    advice: {
      explicitBucketBoundaries: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
    },
  },
);

// ============================================================
// Error metrics
// ============================================================
export const httpErrorsTotal: Counter = meter.createCounter(
  "http_errors_total",
  {
    description: "Total number of HTTP errors",
    unit: "errors",
  },
);

// Throughput tracking
let requestCount = 0;
let lastRequestCount = 0;
let lastTimestamp = Date.now();
let currentRps = 0;

export function incrementRequestCount() {
  requestCount++;
}

// Calculate RPS every second
setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastTimestamp) / 1000;
  currentRps = (requestCount - lastRequestCount) / elapsed;
  lastRequestCount = requestCount;
  lastTimestamp = now;
}, 1000);

// System metrics - CPU and Memory
const cpuUsageGauge: ObservableGauge = meter.createObservableGauge(
  "process_cpu_usage_percent",
  {
    description: "Process CPU usage percentage",
    unit: "percent",
  },
);

const memoryHeapUsedGauge: ObservableGauge = meter.createObservableGauge(
  "process_memory_heap_used_bytes",
  {
    description: "Process heap memory used",
    unit: "bytes",
  },
);

const memoryHeapTotalGauge: ObservableGauge = meter.createObservableGauge(
  "process_memory_heap_total_bytes",
  {
    description: "Process heap memory total",
    unit: "bytes",
  },
);

const memoryRssGauge: ObservableGauge = meter.createObservableGauge(
  "process_memory_rss_bytes",
  {
    description: "Process resident set size",
    unit: "bytes",
  },
);

const memoryExternalGauge: ObservableGauge = meter.createObservableGauge(
  "process_memory_external_bytes",
  {
    description: "Process external memory",
    unit: "bytes",
  },
);

const requestsPerSecondGauge: ObservableGauge = meter.createObservableGauge(
  "http_requests_per_second",
  {
    description: "HTTP requests per second",
    unit: "requests/s",
  },
);

const totalRequestsGauge: ObservableGauge = meter.createObservableGauge(
  "http_requests_total_count",
  {
    description: "Total HTTP requests count",
    unit: "requests",
  },
);

// Track CPU usage
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

function getCpuUsagePercent(): number {
  const currentCpuUsage = process.cpuUsage(lastCpuUsage);
  const currentTime = Date.now();
  const elapsedMs = currentTime - lastCpuTime;

  // CPU time is in microseconds
  const totalCpuTime = (currentCpuUsage.user + currentCpuUsage.system) / 1000;
  const cpuPercent = (totalCpuTime / elapsedMs) * 100;

  lastCpuUsage = process.cpuUsage();
  lastCpuTime = currentTime;

  return Math.min(cpuPercent, 100);
}

// Register observable callbacks
cpuUsageGauge.addCallback((result) => {
  result.observe(getCpuUsagePercent());
});

memoryHeapUsedGauge.addCallback((result) => {
  result.observe(process.memoryUsage().heapUsed);
});

memoryHeapTotalGauge.addCallback((result) => {
  result.observe(process.memoryUsage().heapTotal);
});

memoryRssGauge.addCallback((result) => {
  result.observe(process.memoryUsage().rss);
});

memoryExternalGauge.addCallback((result) => {
  result.observe(process.memoryUsage().external);
});

requestsPerSecondGauge.addCallback((result) => {
  result.observe(currentRps);
});

totalRequestsGauge.addCallback((result) => {
  result.observe(requestCount);
});

// Active connections tracking
let activeConnections = 0;

const activeConnectionsGauge: ObservableGauge = meter.createObservableGauge(
  "http_active_connections",
  {
    description: "Number of active HTTP connections",
    unit: "connections",
  },
);

activeConnectionsGauge.addCallback((result) => {
  result.observe(activeConnections);
});

export function incrementActiveConnections() {
  activeConnections++;
}

export function decrementActiveConnections() {
  activeConnections--;
}

// Container Resource Limits (read from cgroups v2 or environment)
const MEMORY_LIMIT_BYTES = getMemoryLimit();
const CPU_LIMIT_CORES = getCpuLimit();
const MEMORY_REQUEST_BYTES = getMemoryRequest();
const CPU_REQUEST_CORES = getCpuRequest();

function getMemoryLimit(): number {
  // Try cgroups v2 first, then v1, then default to 512MB (docker-compose limit)
  try {
    const cgroupV2 = Bun.file("/sys/fs/cgroup/memory.max");
    const content = require("fs")
      .readFileSync("/sys/fs/cgroup/memory.max", "utf8")
      .trim();
    if (content !== "max") {
      return parseInt(content, 10);
    }
  } catch {}
  try {
    const content = require("fs")
      .readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8")
      .trim();
    const limit = parseInt(content, 10);
    if (limit < 9223372036854771712) {
      // Not unlimited
      return limit;
    }
  } catch {}
  // Default from docker-compose.yml
  return 1024 * 1024 * 1024; // 1024MB
}

function getCpuLimit(): number {
  // Try cgroups v2
  try {
    const content = require("fs")
      .readFileSync("/sys/fs/cgroup/cpu.max", "utf8")
      .trim();
    const [quota, period] = content
      .split(" ")
      .map((s: string) => parseInt(s, 10));
    if (quota > 0 && period > 0) {
      return quota / period;
    }
  } catch {}
  // Try cgroups v1
  try {
    const quota = parseInt(
      require("fs")
        .readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "utf8")
        .trim(),
      10,
    );
    const period = parseInt(
      require("fs")
        .readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_period_us", "utf8")
        .trim(),
      10,
    );
    if (quota > 0 && period > 0) {
      return quota / period;
    }
  } catch {}
  // Default from docker-compose.yml
  return 4.0; // 4 CPU cores
}

function getMemoryRequest(): number {
  // Reservations are typically set via orchestrator, default to docker-compose value
  return 256 * 1024 * 1024; // 256MB
}

function getCpuRequest(): number {
  // Reservations are typically set via orchestrator, default to docker-compose value
  return 1.0; // 1.0 CPU cores
}

// Resource limit gauges
const memoryLimitGauge: ObservableGauge = meter.createObservableGauge(
  "container_memory_limit_bytes",
  {
    description: "Container memory limit in bytes",
    unit: "bytes",
  },
);

const memoryRequestGauge: ObservableGauge = meter.createObservableGauge(
  "container_memory_request_bytes",
  {
    description: "Container memory request/reservation in bytes",
    unit: "bytes",
  },
);

const cpuLimitGauge: ObservableGauge = meter.createObservableGauge(
  "container_cpu_limit_cores",
  {
    description: "Container CPU limit in cores",
    unit: "cores",
  },
);

const cpuRequestGauge: ObservableGauge = meter.createObservableGauge(
  "container_cpu_request_cores",
  {
    description: "Container CPU request/reservation in cores",
    unit: "cores",
  },
);

const memoryUsagePercentGauge: ObservableGauge = meter.createObservableGauge(
  "container_memory_usage_percent",
  {
    description: "Container memory usage as percentage of limit",
    unit: "percent",
  },
);

const cpuUsageLimitPercentGauge: ObservableGauge = meter.createObservableGauge(
  "container_cpu_usage_limit_percent",
  {
    description: "Container CPU usage as percentage of limit",
    unit: "percent",
  },
);

memoryLimitGauge.addCallback((result) => {
  result.observe(MEMORY_LIMIT_BYTES);
});

memoryRequestGauge.addCallback((result) => {
  result.observe(MEMORY_REQUEST_BYTES);
});

cpuLimitGauge.addCallback((result) => {
  result.observe(CPU_LIMIT_CORES);
});

cpuRequestGauge.addCallback((result) => {
  result.observe(CPU_REQUEST_CORES);
});

memoryUsagePercentGauge.addCallback((result) => {
  const used = process.memoryUsage().rss;
  const percent = (used / MEMORY_LIMIT_BYTES) * 100;
  result.observe(Math.min(percent, 100));
});

cpuUsageLimitPercentGauge.addCallback((result) => {
  const cpuPercent = getCpuUsagePercent();
  // Convert to percentage of limit (e.g., if limit is 1 core, 50% usage = 50% of limit)
  const percentOfLimit = (cpuPercent / 100 / CPU_LIMIT_CORES) * 100;
  result.observe(Math.min(percentOfLimit, 100));
});

// Export the meter provider for shutdown
export { meterProvider, prometheusExporter, meter };

console.log(
  "Prometheus metrics server running at http://localhost:9464/metrics",
);
