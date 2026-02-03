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
│   │       Latency: nanoseconds | TTL: 30s              │    │
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

| Layer | Technology       | Latency     | TTL  | Purpose      |
| ----- | ---------------- | ----------- | ---- | ------------ |
| L1    | LRU (in-process) | Nanoseconds | 30s  | Hot data     |
| L2    | Redis            | <1ms        | 5min | Shared cache |

Cache-aside pattern: L1 → L2 → Database, with automatic L1 population on L2 hits and Pub/Sub invalidation across instances.

### Connection Pooling (PgBouncer)

| Setting                 | Value       |
| ----------------------- | ----------- |
| Pool Mode               | Transaction |
| Default Pool Size       | 10          |
| Max Client Connections  | 10,000      |
| Max DB Connections      | 20          |

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

| Service   | CPU Limit  | Memory Limit |
| --------- | ---------- | ------------ |
| app       | 4.0 cores  | 1024 MB      |
| postgres  | 2.0 cores  | 1024 MB      |
| pgbouncer | 0.5 core   | 128 MB       |
| redis     | 1.0 core   | 512 MB       |
| prometheus| 0.5 core   | 256 MB       |
| grafana   | 0.5 core   | 256 MB       |

## Local Development

```bash
cd my-app
bun install

# Start dependencies
docker compose up -d postgres pgbouncer redis

# Run dev server
bun run dev
```

## License

MIT
