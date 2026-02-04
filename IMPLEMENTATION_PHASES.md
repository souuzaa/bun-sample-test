# Implementation Phases for Multi-Agent Execution

This document reorganizes the implementation plan into phases that can be executed by multiple agents in parallel.

---

## Execution Overview

```
STAGE 1 (Foundation) ─────────────────────────────────────────────────────────
   │
   ├── [Agent A] Infrastructure: Docker services (PostgreSQL, PgBouncer, Redis)
   ├── [Agent B] Database: Schema + init.sql
   └── [Agent C] Dependencies: package.json updates
   │
   └── SYNC POINT: Docker stack must be ready before Stage 2
   
STAGE 2 (Core Implementation) ────────────────────────────────────────────────
   │
   ├── [Agent D] Database Layer: client.ts + repositories
   ├── [Agent E] Cache Layer: L1 + L2 + unified cache
   └── [Agent F] Metrics: New telemetry metrics
   │
   └── SYNC POINT: Core layers ready before Stage 3
   
STAGE 3 (Integration) ────────────────────────────────────────────────────────
   │
   ├── [Agent G] Handler Updates: Integrate DB + cache into handlers
   ├── [Agent H] Kernel Metrics: TCP/kernel metrics collector
   └── [Agent I] Workload Handlers: Hash, payload, memory endpoints
   │
   └── SYNC POINT: All code complete before Stage 4
   
STAGE 4 (Observability & Testing) ────────────────────────────────────────────
   │
   ├── [Agent J] Grafana Dashboard: All new panels
   └── [Agent K] K6 Tests: Workload test scenarios
   │
   └── FINAL: Integration testing
```

---

## STAGE 1: Foundation (No Dependencies - Run All in Parallel)

### Agent A: Infrastructure Setup
**Files to create/modify:** `docker-compose.yml`

**Tasks:**
1. Add PostgreSQL service with optimized config
2. Add PgBouncer service with transaction pooling
3. Add Redis service with cache-optimized config
4. Add kernel sysctls to app service
5. Add ulimits for file descriptors
6. Add volume mounts for kernel metrics

**Deliverable:** Updated `docker-compose.yml` with all infrastructure services

---

### Agent B: Database Schema
**Files to create:** `my-app/init.sql`

**Tasks:**
1. Create `users` table with proper indexes
2. Create `hash_jobs` table for workload simulation
3. Create `payloads` table for bandwidth tests
4. Create covering index on users(email)
5. Create `update_updated_at()` trigger function
6. Add seed data

**Deliverable:** Complete `init.sql` file

---

### Agent C: Dependencies
**Files to modify:** `package.json`

**Tasks:**
1. Add `postgres` ^3.4.0
2. Add `ioredis` ^5.3.0
3. Add `lru-cache` ^10.0.0
4. Add `@noble/hashes` ^1.3.0

**Deliverable:** Updated `package.json` with new dependencies

---

## STAGE 2: Core Implementation (Depends on Stage 1)

### Agent D: Database Layer
**Files to create:**
- `src/db/client.ts`
- `src/db/repositories/users.ts`

**Tasks:**
1. Create PostgreSQL client optimized for PgBouncer
   - Connection settings (max: 5, prepare: false)
   - snake_case to camelCase transform
   - Health check and graceful shutdown
2. Create user repository with:
   - findAll, findById, findByEmail
   - create, update, delete
   - createBatch for bulk operations

**Deliverable:** Complete database layer with repository pattern

---

### Agent E: Cache Layer
**Files to create:**
- `src/cache/l1-cache.ts`
- `src/cache/l2-cache.ts`
- `src/cache/cache.ts`
- `src/cache/strategies.ts`

**Tasks:**
1. L1 Cache (l1-cache.ts):
   - LRU cache with 1000 items max
   - 30s default TTL
   - Pattern invalidation support
2. L2 Cache (l2-cache.ts):
   - Redis client with ioredis
   - Pipelining for batch operations (mget, mset)
   - Pub/Sub for invalidation
3. Unified Cache (cache.ts):
   - Two-tier lookup (L1 → L2)
   - Automatic L1 population on L2 hit
   - Invalidation propagation
4. Strategies (strategies.ts):
   - Cache key patterns
   - TTL configurations per entity type
   - Invalidation helpers

**Deliverable:** Complete two-tier caching system

---

### Agent F: Metrics Layer
**Files to modify:** `src/telemetry/metrics.ts`

**Tasks:**
1. Add request queue time histogram
   - Buckets: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500]
2. Add cache metrics:
   - cache_hits_total (counter with layer label)
   - cache_misses_total (counter)
   - cache_latency_ms (histogram)
3. Add database metrics:
   - pg_query_duration_ms (histogram)

**Deliverable:** Extended metrics.ts with all new metrics

---

## STAGE 3: Integration (Depends on Stage 2)

### Agent G: Handler Updates
**Files to modify:**
- `src/handlers/users.ts`
- `src/index.ts`
- `src/routes.json`

**Tasks:**
1. Update user handlers to use:
   - userRepository instead of in-memory array
   - cache layer with proper strategies
   - Cache invalidation on mutations
2. Update server to record queue time:
   - Capture arrival time at request start
   - Record queue time before handler execution
3. Add workload routes to routes.json

**Deliverable:** Handlers integrated with DB and cache

---

### Agent H: Kernel Metrics
**Files to create:** `src/telemetry/kernel-metrics.ts`

**Tasks:**
1. Parse /proc/net/tcp for connection states
   - Map hex states to names (ESTABLISHED, TIME_WAIT, etc.)
   - Create observable gauge
2. Parse /proc/net/snmp for TCP stats
   - Retransmits counter
   - Segments sent counter
3. Parse /proc/net/netstat for listen overflows
4. Register all metrics with batch callback

**Deliverable:** Complete kernel metrics collector

---

### Agent I: Workload Handlers
**Files to create:** `src/handlers/workload.ts`

**Tasks:**
1. Hash workload handler:
   - Configurable iterations (default 10000)
   - Use @noble/hashes for performance
   - Store results in hash_jobs table
2. Payload workload handler:
   - Variable size generation (10KB - 10MB)
   - Store small payloads in database
3. Memory workload handler:
   - Configurable allocation size
   - Configurable hold duration
4. Status endpoint:
   - Aggregate stats from hash_jobs and payloads

**Deliverable:** Complete workload simulation endpoints

---

## STAGE 4: Observability & Testing (Depends on Stage 3)

### Agent J: Grafana Dashboard
**Files to create/modify:** `monitoring/grafana/provisioning/dashboards/my-app-dashboard.json`

**Tasks:**
1. Latency Analysis Panel:
   - p99/p95 waiting time
   - p99/p95 duration
   - Interpretation guide in description
2. Connection Capacity Panel:
   - Active connections gauge
   - Requests in flight
   - Backlog calculation
3. Saturation Heatmap:
   - Queue time distribution
4. TCP Metrics Panel:
   - Retransmit rate
   - TIME_WAIT count
   - Listen overflows
5. Cache Performance Panel:
   - L1/L2 hit rates
   - Cache latency by layer
   - Miss rate
6. PgBouncer Pool Panel:
   - Active/idle connections
   - Waiting clients

**Deliverable:** Complete enhanced Grafana dashboard

---

### Agent K: K6 Tests
**Files to create:** `k6/workload-test.js`

**Tasks:**
1. Define test scenarios:
   - read_heavy: 40 VUs, 80% of traffic
   - write_moderate: 10 VUs, 15% of traffic
   - cpu_intensive: 5 VUs, 5% of traffic
2. Implement test functions:
   - readOperations: list + get user (cached)
   - writeOperations: create user
   - cpuOperations: hash + payload workloads
3. Add custom metrics:
   - hash_processing_time trend
   - payload_size_kb trend
4. Define thresholds:
   - p95 < 100ms, p99 < 200ms
   - Error rate < 1%

**Deliverable:** Complete K6 workload test suite

---

## Agent Assignment Summary

| Stage | Agent | Focus Area | Files | Parallel? |
|-------|-------|------------|-------|-----------|
| 1 | A | Infrastructure | docker-compose.yml | Yes |
| 1 | B | Database Schema | init.sql | Yes |
| 1 | C | Dependencies | package.json | Yes |
| 2 | D | Database Layer | src/db/* | Yes |
| 2 | E | Cache Layer | src/cache/* | Yes |
| 2 | F | Metrics | src/telemetry/metrics.ts | Yes |
| 3 | G | Handler Integration | src/handlers/*, src/index.ts | Yes |
| 3 | H | Kernel Metrics | src/telemetry/kernel-metrics.ts | Yes |
| 3 | I | Workload Handlers | src/handlers/workload.ts | Yes |
| 4 | J | Grafana Dashboard | monitoring/grafana/* | Yes |
| 4 | K | K6 Tests | k6/workload-test.js | Yes |

---

## Sync Points & Dependencies

```
Stage 1 Complete
    ↓
    ├── Docker services running
    ├── Database schema created
    └── Dependencies installed
    ↓
Stage 2 Complete
    ↓
    ├── DB client can connect to PgBouncer
    ├── Cache can connect to Redis
    └── Metrics exported to Prometheus
    ↓
Stage 3 Complete
    ↓
    ├── Handlers use repository + cache
    ├── Kernel metrics being collected
    └── Workload endpoints functional
    ↓
Stage 4 Complete
    ↓
    ├── Dashboard shows all metrics
    └── K6 tests pass thresholds
```

---

## Execution Commands

### Stage 1 (Run all 3 agents in parallel)
```bash
# Agent A, B, C can run simultaneously
claude --agent infrastructure "Update docker-compose.yml per IMPLEMENTATION_PLAN.md Phase 1 & 2 Docker sections"
claude --agent database "Create init.sql per IMPLEMENTATION_PLAN.md Phase 1.3"
claude --agent dependencies "Update package.json with postgres, ioredis, lru-cache, @noble/hashes"
```

### Stage 2 (Run all 3 agents in parallel after Stage 1)
```bash
# Agent D, E, F can run simultaneously
claude --agent db-layer "Create src/db/client.ts and src/db/repositories/users.ts per IMPLEMENTATION_PLAN.md"
claude --agent cache-layer "Create src/cache/*.ts files per IMPLEMENTATION_PLAN.md Phase 2"
claude --agent metrics "Add new metrics to src/telemetry/metrics.ts per IMPLEMENTATION_PLAN.md Phase 6"
```

### Stage 3 (Run all 3 agents in parallel after Stage 2)
```bash
# Agent G, H, I can run simultaneously
claude --agent handlers "Update handlers to use repository and cache layers"
claude --agent kernel-metrics "Create src/telemetry/kernel-metrics.ts per IMPLEMENTATION_PLAN.md Phase 4"
claude --agent workload "Create src/handlers/workload.ts per IMPLEMENTATION_PLAN.md Phase 5"
```

### Stage 4 (Run both agents in parallel after Stage 3)
```bash
# Agent J, K can run simultaneously
claude --agent grafana "Create enhanced Grafana dashboard per IMPLEMENTATION_PLAN.md Phase 3"
claude --agent k6-tests "Create k6/workload-test.js per IMPLEMENTATION_PLAN.md Phase 5.3"
```

---

## Maximum Parallelism Per Stage

| Stage | Max Parallel Agents | Total Tasks |
|-------|---------------------|-------------|
| 1 | 3 | 3 |
| 2 | 3 | 3 |
| 3 | 3 | 3 |
| 4 | 2 | 2 |

**Total: 11 agent tasks across 4 stages**

With maximum parallelism, this can complete in **4 sequential batches** rather than 11 sequential tasks.
