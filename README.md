# my-app

A high-performance Bun API server featuring two-tier caching, connection pooling, and OpenTelemetry observability.

## Quick Start

```bash
cd my-app
docker compose up -d
```

| Service    | URL                              | Description              |
| ---------- | -------------------------------- | ------------------------ |
| API        | http://localhost:3000            | Main application         |
| Metrics    | http://localhost:9464/metrics    | Prometheus metrics       |
| Prometheus | http://localhost:9090            | Metrics storage          |
| Grafana    | http://localhost:3030            | Dashboards (admin/admin) |
| PostgreSQL | localhost:5432 (via PgBouncer)   | Database                 |
| Redis      | localhost:6379                   | L2 Cache                 |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Bun Application                         │
│                                                              │
│   ┌────────────────────────────────────────────────────┐    │
│   │          L1 Cache (LRU, in-process)                │    │
│   │       Latency: nanoseconds | TTL: 60s              │    │
│   └────────────────────────┬───────────────────────────┘    │
│                            │ miss                            │
│                            ▼                                 │
│   ┌────────────────────────────────────────────────────┐    │
│   │           L2 Cache (Redis via ioredis)             │    │
│   │            Latency: <1ms | TTL: 5min               │    │
│   └────────────────────────┬───────────────────────────┘    │
│                            │ miss                            │
│                            ▼                                 │
│   ┌────────────────────────────────────────────────────┐    │
│   │            Database (via PgBouncer)                │    │
│   │            Transaction pooling mode                │    │
│   └────────────────────────┬───────────────────────────┘    │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   ┌─────────┐         ┌──────────┐         ┌────────────┐
   │  Redis  │         │ PgBouncer│         │ Prometheus │
   │ 256MB   │         │ 10 conn  │         │            │
   └─────────┘         └────┬─────┘         └────────────┘
                            ▼
                      ┌──────────┐
                      │ PostgreSQL│
                      │ 16-alpine │
                      └──────────┘
```

## API Reference

### Users

```bash
# List all users (cached)
curl http://localhost:3000/api/users

# Get user by ID (cached)
curl http://localhost:3000/api/users/1

# Create user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John", "email": "john@example.com"}'

# Update user
curl -X PUT http://localhost:3000/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "John Updated"}'

# Delete user
curl -X DELETE http://localhost:3000/api/users/1
```

### Workload Simulation

```bash
# CPU-intensive hash workload
curl -X POST http://localhost:3000/api/workload/hash \
  -H "Content-Type: application/json" \
  -d '{"data": "test", "iterations": 10000}'

# Bandwidth-intensive payload generation
curl -X POST http://localhost:3000/api/workload/payload \
  -H "Content-Type: application/json" \
  -d '{"size_kb": 100}'

# Workload statistics
curl http://localhost:3000/api/workload/status
```

### System

```bash
# Health check
curl http://localhost:3000/api/health

# Welcome message
curl http://localhost:3000/
```

## Performance

### Caching Strategy

| Layer | Technology       | Latency     | TTL  | Max Items | Purpose      |
| ----- | ---------------- | ----------- | ---- | --------- | ------------ |
| L1    | LRU (in-process) | Nanoseconds | 60s  | 50,000    | Hot data     |
| L2    | Redis            | <1ms        | 5min | 256MB     | Shared cache |

Cache-aside pattern: L1 → L2 → Database, with automatic L1 population on L2 hits and Pub/Sub invalidation across instances.

### Connection Pooling (PgBouncer)

| Setting                 | Value       |
| ----------------------- | ----------- |
| Pool Mode               | Transaction |
| Default Pool Size       | 50          |
| Min Pool Size           | 20          |
| Reserve Pool Size       | 20          |
| Max Client Connections  | 20,000      |
| Max DB Connections      | 80          |

### Database Client (Application)

| Setting          | Value |
| ---------------- | ----- |
| Max Connections  | 100   |
| Idle Timeout     | 20s   |
| Connect Timeout  | 5s    |

### Performance Targets

| Metric                  | Target   |
| ----------------------- | -------- |
| Throughput              | >50K RPS |
| p99 Latency             | <10ms    |
| p95 Latency             | <5ms     |
| L1 Cache Hit Rate       | >80%     |
| Combined Cache Hit Rate | >95%     |

## Load Testing

```bash
# Quick test (10s, 50 VUs)
bun run k6:docker:quick

# Stress test (ramp 10-190 VUs)
bun run k6:docker:stress

# Spike test (10x traffic burst)
bun run k6:docker:spike

# Soak test (3 min sustained)
bun run k6:docker:soak

# Full test suite
bun run k6:docker:full

# Realistic workload (80% reads, 15% writes, 5% CPU-intensive)
docker run --rm -i --add-host=host.docker.internal:host-gateway \
  -e BASE_URL=http://host.docker.internal:3000 \
  -v ./k6:/scripts grafana/k6 run /scripts/workload-test.js
```

## Observability

### Key Metrics

| Metric                       | Type      | Description               |
| ---------------------------- | --------- | ------------------------- |
| `http_request_duration_ms`   | Histogram | Request latency           |
| `http_request_queue_time_ms` | Histogram | Queue/saturation time     |
| `cache_hits_total`           | Counter   | Cache hits by layer       |
| `cache_misses_total`         | Counter   | Cache misses              |
| `pg_query_duration_ms`       | Histogram | Database query duration   |
| `tcp_connection_states`      | Gauge     | TCP connections by state  |

### Grafana Dashboard

Pre-configured panels for latency analysis, connection capacity, TCP metrics, cache performance, database metrics, and resource usage.

## Project Structure

```
my-app/
├── src/
│   ├── index.ts          # API server entry point
│   ├── routes.json       # Route configuration
│   ├── handlers/         # Request handlers
│   ├── db/               # Database layer
│   ├── cache/            # Two-tier caching
│   └── telemetry/        # Observability
├── k6/                   # Load testing scripts
├── monitoring/           # Prometheus & Grafana config
├── init.sql              # Database schema
├── Dockerfile
└── docker-compose.yml
```

## Container Resources

| Service    | CPU Limit  | CPU Reserved | Memory Limit | Memory Reserved |
| ---------- | ---------- | ------------ | ------------ | --------------- |
| app        | 8.0 cores  | 4.0 cores    | 4096 MB      | 1024 MB         |
| postgres   | 2.0 cores  | -            | 1024 MB      | -               |
| pgbouncer  | 1.0 core   | -            | 256 MB       | -               |
| redis      | 1.0 core   | -            | 512 MB       | -               |
| prometheus | 0.5 core   | 0.1 core     | 256 MB       | 64 MB           |
| grafana    | 0.5 core   | 0.1 core     | 256 MB       | 64 MB           |

## Performance Tuning

### Bun Runtime Configuration

| Setting                  | Value      | Description                     |
| ------------------------ | ---------- | ------------------------------- |
| BUN_JSC_forceRAMSize     | 2GB        | JIT compiler memory allocation  |
| BUN_JSC_useJIT           | 1          | Enable JIT compilation          |
| BUN_JSC_useDFGJIT        | 1          | Enable DFG JIT tier             |
| BUN_JSC_useFTLJIT        | 1          | Enable FTL JIT tier             |
| UV_THREADPOOL_SIZE       | 16         | libuv thread pool size          |

### Worker Pool Configuration

| Setting          | Value | Description                          |
| ---------------- | ----- | ------------------------------------ |
| Worker Pool Size | 8     | Parallel workers for CPU-intensive hash operations |

### System-Level Tuning (Docker)

| Setting                        | Value       | Description                    |
| ------------------------------ | ----------- | ------------------------------ |
| net.core.somaxconn             | 65535       | Max pending connections        |
| net.ipv4.tcp_max_syn_backlog   | 65535       | SYN backlog queue size         |
| net.ipv4.tcp_tw_reuse          | 1           | Reuse TIME_WAIT sockets        |
| net.ipv4.tcp_fastopen          | 3           | TCP Fast Open enabled          |
| net.ipv4.ip_local_port_range   | 1024-65535  | Ephemeral port range           |
| net.ipv4.tcp_keepalive_time    | 30          | Keep-alive timeout (seconds)   |
| net.ipv4.tcp_fin_timeout       | 10          | FIN timeout (seconds)          |
| ulimits.nofile                 | 1,000,000   | Max open file descriptors      |
| ulimits.nproc                  | 65,535      | Max processes                  |

## Local Development

```bash
cd my-app
bun install

# Start dependencies
docker compose up -d postgres pgbouncer redis

# Run dev server
bun run dev
```

## Deployment

```bash
cd my-app

# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f app

# Check resource usage
docker stats

# Restart after configuration changes
docker compose down && docker compose up -d --build
```

## License

MIT
