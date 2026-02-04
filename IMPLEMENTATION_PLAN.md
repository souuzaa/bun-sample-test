# Implementation Plan: Extreme Performance Architecture

## Design Philosophy

**Target**: Maximum throughput, minimum latency, predictable performance under load.

**Principles**:
1. Eliminate network round-trips where possible (L1 cache)
2. Pool and reuse connections aggressively (PgBouncer)
3. Batch operations (Redis pipelining)
4. Tune at every layer (kernel, TCP, application)
5. Measure everything (saturation, not just utilization)

---

## Architecture Overview

```
                              ┌──────────────────────────────────────────────────────┐
                              │                  Bun Application                     │
                              │                                                      │
                              │   ┌────────────────────────────────────────────┐    │
                              │   │        L1 Cache (LRU, in-process)          │    │
                              │   │     Latency: nanoseconds | TTL: 30s        │    │
                              │   │          Max: 1000 items                   │    │
                              │   └─────────────────────┬──────────────────────┘    │
                              │                         │ miss                       │
                              │                         ▼                            │
                              │   ┌────────────────────────────────────────────┐    │
                              │   │     L2 Cache (Redis via ioredis pool)      │    │
                              │   │     Latency: <1ms | TTL: 5min              │    │
                              │   │     Pipelining for batch ops               │    │
                              │   └─────────────────────┬──────────────────────┘    │
                              │                         │ miss                       │
                              │                         ▼                            │
                              │   ┌────────────────────────────────────────────┐    │
                              │   │      Database (via PgBouncer)              │    │
                              │   │      Transaction pooling mode              │    │
                              │   └─────────────────────┬──────────────────────┘    │
                              │                         │                            │
                              └─────────────────────────┼────────────────────────────┘
                                                        │
                 ┌──────────────────────────────────────┼──────────────────────────────────────┐
                 │                                      │                                      │
                 ▼                                      ▼                                      ▼
       ┌─────────────────┐                   ┌─────────────────┐                   ┌─────────────────┐
       │      Redis      │◄─────Pub/Sub─────►│    PgBouncer    │                   │   Prometheus    │
       │   (L2 Cache)    │    Invalidation   │                 │                   │                 │
       │                 │                   │  Pool: 10 conn  │                   │                 │
       │  maxmem: 256MB  │                   │  Clients: 10K+  │                   │                 │
       └─────────────────┘                   └────────┬────────┘                   └─────────────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────┐
                                            │   PostgreSQL    │
                                            │    16-alpine    │
                                            │                 │
                                            │  shared_buffers │
                                            │  = 256MB        │
                                            └─────────────────┘
```

---

## Current State Summary

- **Runtime**: Bun 1.1 with TypeScript
- **Data**: In-memory mocked arrays (users reset on restart)
- **Observability**: OpenTelemetry + Prometheus + Grafana (basic metrics)
- **Testing**: K6 load tests with 5 scenarios
- **Docker**: Multi-stage builds with resource limits

---

## Phase 1: PostgreSQL + PgBouncer (Connection Pooling)

### Why PgBouncer?

| Aspect | Direct Connection | PgBouncer |
|--------|-------------------|-----------|
| Memory per connection | ~10MB | ~2KB |
| Max client connections | ~100 | 10,000+ |
| Connection storm handling | Poor | Excellent |
| Latency | Baseline | ~18% faster |
| Prepared statements | Full support | With transaction mode config |

### 1.1 Add PostgreSQL + PgBouncer to Docker Stack

**File**: `docker-compose.yml`

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: myapp
    POSTGRES_PASSWORD: myapp_secret
    POSTGRES_DB: myapp
  volumes:
    - postgres-data:/var/lib/postgresql/data
    - ./init.sql:/docker-entrypoint-initdb.d/init.sql
  # No external port - only PgBouncer connects
  networks:
    - monitoring
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U myapp"]
    interval: 5s
    timeout: 5s
    retries: 5
  command:
    - "postgres"
    - "-c" 
    - "shared_buffers=256MB"
    - "-c"
    - "effective_cache_size=512MB"
    - "-c"
    - "max_connections=50"
    - "-c"
    - "work_mem=16MB"
  deploy:
    resources:
      limits:
        cpus: "2.0"
        memory: 1024M

pgbouncer:
  image: edoburu/pgbouncer:1.21.0
  environment:
    DATABASE_URL: postgres://myapp:myapp_secret@postgres:5432/myapp
    POOL_MODE: transaction
    DEFAULT_POOL_SIZE: 10
    MIN_POOL_SIZE: 5
    RESERVE_POOL_SIZE: 5
    MAX_CLIENT_CONN: 10000
    MAX_DB_CONNECTIONS: 20
    SERVER_IDLE_TIMEOUT: 600
    SERVER_LIFETIME: 3600
    SERVER_CONNECT_TIMEOUT: 5
    QUERY_WAIT_TIMEOUT: 120
    LOG_CONNECTIONS: 0
    LOG_DISCONNECTIONS: 0
    LOG_POOLER_ERRORS: 1
  ports:
    - "5432:5432"
  networks:
    - monitoring
  depends_on:
    postgres:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "pg_isready", "-h", "localhost", "-p", "5432"]
    interval: 5s
    timeout: 3s
    retries: 5
  deploy:
    resources:
      limits:
        cpus: "0.5"
        memory: 128M
```

### 1.2 Pool Sizing Formula

```
optimal_pool_size = (CPU_cores * 2) + effective_spindle_count
```

For a 4-core server with SSD:
- `(4 * 2) + 0` = **8-10 connections** to PostgreSQL
- PgBouncer handles 10,000+ client connections → 10 DB connections

**Why this works**: PostgreSQL connections are expensive (~10MB each). With transaction pooling, a connection is released after each transaction, so 10 connections can serve thousands of requests.

### 1.3 Database Schema

**File**: `my-app/init.sql`

```sql
-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Users table with proper indexes
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Covering index for common query pattern
CREATE INDEX idx_users_email ON users(email) INCLUDE (name);

-- Seed data
INSERT INTO users (name, email) VALUES
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com');

-- Workload simulation tables
CREATE TABLE hash_jobs (
  id SERIAL PRIMARY KEY,
  input_data TEXT NOT NULL,
  hash_result VARCHAR(128),
  iterations INTEGER DEFAULT 1000,
  processing_time_ms FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partitioned by month for large payload storage
CREATE TABLE payloads (
  id SERIAL PRIMARY KEY,
  size_kb INTEGER NOT NULL,
  data BYTEA,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for workload status queries
CREATE INDEX idx_hash_jobs_created ON hash_jobs(created_at DESC);
CREATE INDEX idx_payloads_created ON payloads(created_at DESC);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 1.4 Database Client (Optimized for PgBouncer)

**File**: `src/db/client.ts`

```typescript
import postgres from 'postgres';

// Connection to PgBouncer (not directly to PostgreSQL)
const sql = postgres({
  host: process.env.DB_HOST || 'pgbouncer',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'myapp',
  username: process.env.DB_USER || 'myapp',
  password: process.env.DB_PASSWORD || 'myapp_secret',
  
  // Connection pool settings (application-level)
  // Keep small since PgBouncer does the heavy lifting
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,
  
  // CRITICAL for PgBouncer transaction mode
  prepare: false,  // Disable prepared statements (or use max_prepared_statements in PgBouncer)
  
  // Performance optimizations
  fetch_types: false,  // Skip type fetching on startup
  
  // Transform snake_case to camelCase
  transform: {
    column: (col) => col.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
  },
});

// Health check query
export const healthCheck = () => sql`SELECT 1 as ok`;

// Graceful shutdown
export const closeDb = () => sql.end();

export { sql };
```

### 1.5 Repository Pattern with Prepared Queries

**File**: `src/db/repositories/users.ts`

```typescript
import { sql } from '../client';

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
}

export const userRepository = {
  // Use SQL template literals for automatic parameterization
  async findAll(limit = 100, offset = 0): Promise<User[]> {
    return sql<User[]>`
      SELECT id, name, email, created_at, updated_at
      FROM users
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `;
  },

  async findById(id: number): Promise<User | null> {
    const [user] = await sql<User[]>`
      SELECT id, name, email, created_at, updated_at
      FROM users
      WHERE id = ${id}
    `;
    return user || null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await sql<User[]>`
      SELECT id, name, email, created_at, updated_at
      FROM users
      WHERE email = ${email}
    `;
    return user || null;
  },

  async create(input: CreateUserInput): Promise<User> {
    const [user] = await sql<User[]>`
      INSERT INTO users (name, email)
      VALUES (${input.name}, ${input.email})
      RETURNING id, name, email, created_at, updated_at
    `;
    return user;
  },

  async update(id: number, input: Partial<CreateUserInput>): Promise<User | null> {
    const [user] = await sql<User[]>`
      UPDATE users
      SET 
        name = COALESCE(${input.name ?? null}, name),
        email = COALESCE(${input.email ?? null}, email)
      WHERE id = ${id}
      RETURNING id, name, email, created_at, updated_at
    `;
    return user || null;
  },

  async delete(id: number): Promise<boolean> {
    const result = await sql`
      DELETE FROM users WHERE id = ${id}
    `;
    return result.count > 0;
  },

  // Batch insert for high-throughput scenarios
  async createBatch(users: CreateUserInput[]): Promise<User[]> {
    return sql<User[]>`
      INSERT INTO users ${sql(users, 'name', 'email')}
      RETURNING id, name, email, created_at, updated_at
    `;
  },
};
```

---

## Phase 2: Two-Tier Caching (L1 + L2)

### Why Two Tiers?

| Layer | Technology | Latency | Scope | TTL |
|-------|------------|---------|-------|-----|
| L1 | LRU (in-process) | Nanoseconds | Per-instance | 30s (short for consistency) |
| L2 | Redis | <1ms | Shared | 5min |

**Benefits**:
- L1 eliminates 90%+ of Redis calls for hot data
- L2 provides cross-instance consistency
- Pub/Sub invalidation keeps L1 fresh

### 2.1 Add Redis to Docker Stack (Optimized)

**File**: `docker-compose.yml`

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --appendonly no
    --save ""
    --maxmemory 256mb
    --maxmemory-policy allkeys-lru
    --tcp-keepalive 300
    --tcp-backlog 511
    --timeout 0
    --activedefrag yes
  ports:
    - "6379:6379"
  networks:
    - monitoring
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 5
  sysctls:
    - net.core.somaxconn=511
  deploy:
    resources:
      limits:
        cpus: "1.0"
        memory: 512M
```

**Key optimizations**:
- `appendonly no`, `save ""` - Disable persistence (it's a cache)
- `maxmemory-policy allkeys-lru` - Evict least recently used
- `activedefrag yes` - Automatic memory defragmentation
- `tcp-keepalive 300` - Keep connections alive

### 2.2 L1 Cache (In-Process LRU)

**File**: `src/cache/l1-cache.ts`

```typescript
import { LRUCache } from 'lru-cache';

export interface CacheOptions {
  max?: number;
  ttl?: number;
}

// L1 cache - in-process, nanosecond access
const l1Cache = new LRUCache<string, any>({
  max: 1000,              // Max 1000 items
  ttl: 1000 * 30,         // 30 second TTL (short for consistency)
  updateAgeOnGet: true,   // Reset TTL on access
  allowStale: false,      // Don't return stale data
});

export const l1 = {
  get<T>(key: string): T | undefined {
    return l1Cache.get(key) as T | undefined;
  },

  set<T>(key: string, value: T, ttlMs?: number): void {
    l1Cache.set(key, value, { ttl: ttlMs });
  },

  delete(key: string): void {
    l1Cache.delete(key);
  },

  // Invalidate all keys matching a pattern
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern.replace('*', '.*'));
    for (const key of l1Cache.keys()) {
      if (regex.test(key)) {
        l1Cache.delete(key);
      }
    }
  },

  clear(): void {
    l1Cache.clear();
  },

  stats() {
    return {
      size: l1Cache.size,
      max: l1Cache.max,
    };
  },
};
```

### 2.3 L2 Cache (Redis with Pipelining)

**File**: `src/cache/l2-cache.ts`

```typescript
import Redis from 'ioredis';

// Connection pool via ioredis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  
  // Connection pool settings
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  
  // Performance settings
  enableReadyCheck: true,
  enableOfflineQueue: true,
  connectTimeout: 10000,
  
  // Keep-alive
  keepAlive: 30000,
});

// Pub/Sub client for cache invalidation
const subscriber = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const CACHE_CHANNEL = 'cache:invalidate';

export const l2 = {
  async get<T>(key: string): Promise<T | null> {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  },

  async delete(key: string): Promise<void> {
    await redis.del(key);
  },

  // Batch operations with pipelining (50-100x faster)
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    
    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();
    
    return results?.map(([err, data]) => 
      err ? null : (data ? JSON.parse(data as string) : null)
    ) || [];
  },

  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;
    
    const pipeline = redis.pipeline();
    entries.forEach(({ key, value, ttl = 300 }) => {
      pipeline.setex(key, ttl, JSON.stringify(value));
    });
    await pipeline.exec();
  },

  // Publish invalidation message to all instances
  async publishInvalidation(pattern: string): Promise<void> {
    await redis.publish(CACHE_CHANNEL, pattern);
  },

  // Subscribe to invalidation messages
  onInvalidation(callback: (pattern: string) => void): void {
    subscriber.subscribe(CACHE_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel === CACHE_CHANNEL) {
        callback(message);
      }
    });
  },
};

// Cleanup
export const closeRedis = async () => {
  await redis.quit();
  await subscriber.quit();
};

export { redis };
```

### 2.4 Unified Cache Layer

**File**: `src/cache/cache.ts`

```typescript
import { l1 } from './l1-cache';
import { l2 } from './l2-cache';
import { cacheHitCounter, cacheMissCounter, cacheLatency } from '../telemetry/metrics';

export interface CacheConfig {
  l1Ttl?: number;   // L1 TTL in ms (default: 30000)
  l2Ttl?: number;   // L2 TTL in seconds (default: 300)
  skipL1?: boolean; // Skip L1 for this request
}

// Initialize L1 invalidation listener
l2.onInvalidation((pattern) => {
  l1.invalidatePattern(pattern);
});

export const cache = {
  async get<T>(key: string, config: CacheConfig = {}): Promise<T | null> {
    const start = performance.now();
    
    // Try L1 first (nanoseconds)
    if (!config.skipL1) {
      const l1Result = l1.get<T>(key);
      if (l1Result !== undefined) {
        cacheHitCounter.add(1, { layer: 'l1', key_prefix: key.split(':')[0] });
        cacheLatency.record(performance.now() - start, { layer: 'l1' });
        return l1Result;
      }
    }
    
    // Try L2 (sub-millisecond)
    const l2Result = await l2.get<T>(key);
    const duration = performance.now() - start;
    
    if (l2Result !== null) {
      // Populate L1 for next request
      if (!config.skipL1) {
        l1.set(key, l2Result, config.l1Ttl || 30000);
      }
      cacheHitCounter.add(1, { layer: 'l2', key_prefix: key.split(':')[0] });
      cacheLatency.record(duration, { layer: 'l2' });
      return l2Result;
    }
    
    cacheMissCounter.add(1, { key_prefix: key.split(':')[0] });
    cacheLatency.record(duration, { layer: 'miss' });
    return null;
  },

  async set<T>(key: string, value: T, config: CacheConfig = {}): Promise<void> {
    // Set in both layers
    if (!config.skipL1) {
      l1.set(key, value, config.l1Ttl || 30000);
    }
    await l2.set(key, value, config.l2Ttl || 300);
  },

  async invalidate(key: string): Promise<void> {
    l1.delete(key);
    await l2.delete(key);
    // Notify other instances
    await l2.publishInvalidation(key);
  },

  async invalidatePattern(pattern: string): Promise<void> {
    l1.invalidatePattern(pattern);
    // For Redis, we'd need SCAN - simplified here
    await l2.publishInvalidation(pattern);
  },
};
```

### 2.5 Cache Strategies per Endpoint

**File**: `src/cache/strategies.ts`

```typescript
export const CACHE_KEYS = {
  userList: () => 'users:list',
  userById: (id: number) => `users:${id}`,
  userByEmail: (email: string) => `users:email:${email}`,
} as const;

export const CACHE_CONFIG = {
  // User list - moderate TTL, frequently accessed
  userList: {
    l1Ttl: 30000,    // 30s in L1
    l2Ttl: 300,      // 5min in L2
  },
  
  // Individual user - longer TTL, less volatile
  userById: {
    l1Ttl: 60000,    // 1min in L1
    l2Ttl: 600,      // 10min in L2
  },
  
  // Skip cache for write-heavy or real-time data
  noCache: {
    skipL1: true,
    l2Ttl: 0,
  },
} as const;

// Invalidation patterns
export const invalidateUserCache = async (userId?: number) => {
  const { cache } = await import('./cache');
  
  // Always invalidate user list
  await cache.invalidate(CACHE_KEYS.userList());
  
  // Invalidate specific user if provided
  if (userId) {
    await cache.invalidate(CACHE_KEYS.userById(userId));
  }
};
```

---

## Phase 3: Enhanced Grafana Dashboard

### 3.1 Latency Panel (Two Columns) - THE KEY DIAGNOSTIC

**Panel**: "Request Latency Analysis (p99/p95)"

| Column | Metric | What It Measures |
|--------|--------|------------------|
| **Request Waiting** | `http_request_queue_time_ms` | Time from TCP accept to handler start |
| **Request Duration** | `http_request_duration_ms` | Handler execution time |

```promql
# Request Waiting p99/p95
histogram_quantile(0.99, rate(http_request_queue_time_ms_bucket{job="my-app"}[1m]))
histogram_quantile(0.95, rate(http_request_queue_time_ms_bucket{job="my-app"}[1m]))

# Request Duration p99/p95
histogram_quantile(0.99, rate(http_request_duration_ms_bucket{job="my-app"}[1m]))
histogram_quantile(0.95, rate(http_request_duration_ms_bucket{job="my-app"}[1m]))
```

**Interpretation Guide** (add as panel description):

| Waiting | Duration | Diagnosis | Action |
|---------|----------|-----------|--------|
| ↑ High | ↑ High | Server overloaded | Scale horizontally, optimize handlers |
| ↑ High | Normal | Network/TLS/backlog | Check TCP settings, connection limits |
| Normal | ↑ High | Handler bottleneck | Profile code, check DB/cache |
| Normal | Normal | Healthy | Monitor for changes |

### 3.2 Connection Capacity Panel

**Panel**: "Connection & Request Capacity"

```promql
# Active TCP connections
http_active_connections{job="my-app"}

# Requests currently being processed
http_requests_in_flight{job="my-app"}

# Request backlog (connections - in_flight = queued)
http_active_connections{job="my-app"} - http_requests_in_flight{job="my-app"}

# Connection utilization (requires setting http_max_connections gauge)
(http_active_connections{job="my-app"} / http_max_connections{job="my-app"}) * 100
```

**Alert thresholds**:
- Warning: Connections > 70% of limit
- Critical: Connections > 90% of limit (socket exhaustion imminent)

### 3.3 Saturation Heatmap

**Panel**: "Request Queue Time Distribution (Saturation)"

Visualization: **Heatmap** showing queue time buckets over time

```promql
# Heatmap data
sum(rate(http_request_queue_time_ms_bucket{job="my-app"}[1m])) by (le)
```

**What to look for**:
- Healthy: Most requests in <1ms buckets
- Saturated: Distribution shifting to higher buckets
- Critical: Many requests in >100ms buckets

### 3.4 Kernel/TCP Metrics Panel

**Panel**: "Network Health (TCP Metrics)"

| Metric | Query | Alert Threshold |
|--------|-------|-----------------|
| Retransmit Rate | `rate(tcp_retransmits_total[1m]) / rate(tcp_segments_sent_total[1m]) * 100` | > 1% = problem |
| TIME_WAIT Count | `tcp_connection_states{state="TIME_WAIT"}` | > 10000 = tune `tcp_tw_reuse` |
| Listen Overflows | `rate(tcp_listen_overflows_total[1m])` | > 0 = increase backlog |
| SYN Queue | `tcp_connection_states{state="SYN_RECV"}` | Sudden spike = SYN flood |

### 3.5 Cache Performance Panel

**Panel**: "Cache Performance (L1 + L2)"

```promql
# L1 vs L2 hit rate
sum(rate(cache_hits_total{layer="l1"}[5m])) / 
  (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m]))) * 100

sum(rate(cache_hits_total{layer="l2"}[5m])) / 
  (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m]))) * 100

# Cache latency by layer
histogram_quantile(0.95, rate(cache_latency_ms_bucket{layer="l1"}[1m]))
histogram_quantile(0.95, rate(cache_latency_ms_bucket{layer="l2"}[1m]))

# Overall miss rate
sum(rate(cache_misses_total[5m])) / 
  (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m]))) * 100
```

**Target metrics**:
- L1 hit rate: > 80% for hot data
- L2 hit rate: > 95% combined
- L1 latency: < 0.1ms
- L2 latency: < 1ms

### 3.6 PgBouncer Pool Panel

**Panel**: "Database Connection Pool (PgBouncer)"

```promql
# Active connections (doing work)
pgbouncer_pools_server_active

# Idle connections (available)
pgbouncer_pools_server_idle

# Waiting clients (queued)
pgbouncer_pools_client_waiting

# Pool utilization
pgbouncer_pools_server_active / (pgbouncer_pools_server_active + pgbouncer_pools_server_idle) * 100
```

**Alert**: `pgbouncer_pools_client_waiting > 10` = need more pool connections

---

## Phase 4: Kernel Tuning in Docker

### 4.1 Application Container Tuning

**File**: `docker-compose.yml` (app service)

```yaml
app:
  # ... existing config ...
  
  # Kernel tuning for high performance
  sysctls:
    # Increase connection backlog
    - net.core.somaxconn=65535
    - net.ipv4.tcp_max_syn_backlog=65535
    
    # Reuse sockets faster
    - net.ipv4.tcp_tw_reuse=1
    
    # Enable TCP Fast Open
    - net.ipv4.tcp_fastopen=3
    
    # Increase local port range
    - net.ipv4.ip_local_port_range=1024 65535
    
    # Faster keepalive detection
    - net.ipv4.tcp_keepalive_time=60
    - net.ipv4.tcp_keepalive_intvl=10
    - net.ipv4.tcp_keepalive_probes=6
    
  # File descriptor limits
  ulimits:
    nofile:
      soft: 1000000
      hard: 1000000
    nproc:
      soft: 65535
      hard: 65535
  
  # For kernel metrics access
  volumes:
    - /proc/net:/host/proc/net:ro
```

### 4.2 Kernel Metrics Collector

**File**: `src/telemetry/kernel-metrics.ts`

```typescript
import { readFileSync } from 'fs';
import { meter } from './metrics';

// TCP connection states mapping
const TCP_STATES: Record<string, string> = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
};

// Gauges for TCP states
const tcpConnectionStates = meter.createObservableGauge('tcp_connection_states', {
  description: 'Number of TCP connections by state',
});

const tcpRetransmits = meter.createObservableCounter('tcp_retransmits_total', {
  description: 'Total TCP retransmissions',
});

const tcpSegmentsSent = meter.createObservableCounter('tcp_segments_sent_total', {
  description: 'Total TCP segments sent',
});

const tcpListenOverflows = meter.createObservableCounter('tcp_listen_overflows_total', {
  description: 'Times the listen queue overflowed',
});

// Parse /proc/net/tcp for connection states
function getTcpConnectionStates(): Record<string, number> {
  const states: Record<string, number> = {};
  Object.values(TCP_STATES).forEach(s => states[s] = 0);
  
  try {
    // Try host proc first (mounted), then container proc
    const procPath = '/host/proc/net/tcp';
    const content = readFileSync(procPath, 'utf8');
    const lines = content.trim().split('\n').slice(1); // Skip header
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const stateHex = parts[3]?.toUpperCase();
      const stateName = TCP_STATES[stateHex] || 'UNKNOWN';
      states[stateName] = (states[stateName] || 0) + 1;
    }
  } catch (e) {
    // Fallback - try container's own /proc
    try {
      const content = readFileSync('/proc/net/tcp', 'utf8');
      const lines = content.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const stateHex = parts[3]?.toUpperCase();
        const stateName = TCP_STATES[stateHex] || 'UNKNOWN';
        states[stateName] = (states[stateName] || 0) + 1;
      }
    } catch {
      // Ignore if not accessible
    }
  }
  
  return states;
}

// Parse /proc/net/snmp for TCP statistics
function getTcpStats(): { retransmits: number; segmentsSent: number } {
  try {
    const content = readFileSync('/host/proc/net/snmp', 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Tcp:') && lines[i + 1]?.startsWith('Tcp:')) {
        const headers = lines[i].split(/\s+/);
        const values = lines[i + 1].split(/\s+/);
        
        const retransIdx = headers.indexOf('RetransSegs');
        const outSegsIdx = headers.indexOf('OutSegs');
        
        return {
          retransmits: parseInt(values[retransIdx]) || 0,
          segmentsSent: parseInt(values[outSegsIdx]) || 0,
        };
      }
    }
  } catch {
    // Ignore
  }
  
  return { retransmits: 0, segmentsSent: 0 };
}

// Parse /proc/net/netstat for listen overflows
function getListenOverflows(): number {
  try {
    const content = readFileSync('/host/proc/net/netstat', 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('TcpExt:') && lines[i + 1]?.startsWith('TcpExt:')) {
        const headers = lines[i].split(/\s+/);
        const values = lines[i + 1].split(/\s+/);
        
        const overflowIdx = headers.indexOf('ListenOverflows');
        return parseInt(values[overflowIdx]) || 0;
      }
    }
  } catch {
    // Ignore
  }
  
  return 0;
}

// Register observable callbacks
let lastRetransmits = 0;
let lastSegmentsSent = 0;
let lastOverflows = 0;

export function registerKernelMetrics() {
  meter.addBatchObservableCallback(
    (observer) => {
      // TCP connection states
      const states = getTcpConnectionStates();
      for (const [state, count] of Object.entries(states)) {
        observer.observe(tcpConnectionStates, count, { state });
      }
      
      // TCP stats
      const tcpStats = getTcpStats();
      observer.observe(tcpRetransmits, tcpStats.retransmits);
      observer.observe(tcpSegmentsSent, tcpStats.segmentsSent);
      
      // Listen overflows
      observer.observe(tcpListenOverflows, getListenOverflows());
    },
    [tcpConnectionStates, tcpRetransmits, tcpSegmentsSent, tcpListenOverflows]
  );
}
```

---

## Phase 5: Realistic Workload Simulation

### 5.1 Critical: Use Optimized Crypto

**Bun's native crypto is ~10x slower than Node.js**. For extreme performance:

**Option A**: Use `@noble/hashes` (pure JS, optimized)
```bash
bun add @noble/hashes
```

**Option B**: Use `hash-wasm` (WASM-based, faster)
```bash
bun add hash-wasm
```

### 5.2 Workload Handlers

**File**: `src/handlers/workload.ts`

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { sql } from '../db/client';
import type { RouteHandler } from './types';

// CPU-intensive: Hash iterations
export const hashWorkload: RouteHandler = async (req) => {
  const body = await req.json() as { 
    data: string; 
    iterations?: number;
  };
  
  const { data, iterations = 10000 } = body;
  
  if (!data) {
    return Response.json({ error: 'data is required' }, { status: 400 });
  }
  
  const start = performance.now();
  
  // Use @noble/hashes for better performance
  let hash = new TextEncoder().encode(data);
  for (let i = 0; i < iterations; i++) {
    hash = sha256(hash);
  }
  const hashResult = bytesToHex(hash);
  
  const processingTimeMs = performance.now() - start;
  
  // Store in database
  await sql`
    INSERT INTO hash_jobs (input_data, hash_result, iterations, processing_time_ms)
    VALUES (${data}, ${hashResult}, ${iterations}, ${processingTimeMs})
  `;
  
  return Response.json({
    hash: hashResult,
    iterations,
    processingTimeMs: Math.round(processingTimeMs * 100) / 100,
  });
};

// Bandwidth-intensive: Variable payload
export const payloadWorkload: RouteHandler = async (req) => {
  const body = await req.json() as { size_kb?: number };
  const sizeKb = Math.min(body.size_kb || 100, 10000); // Max 10MB
  
  const start = performance.now();
  
  // Generate random data
  const data = Buffer.alloc(sizeKb * 1024);
  crypto.getRandomValues(data);
  
  const processingTimeMs = performance.now() - start;
  
  // Store metadata (not the full payload for large sizes)
  if (sizeKb <= 100) {
    await sql`
      INSERT INTO payloads (size_kb, data)
      VALUES (${sizeKb}, ${data})
    `;
  }
  
  return Response.json({
    size_kb: sizeKb,
    data: data.toString('base64'),
    processingTimeMs: Math.round(processingTimeMs * 100) / 100,
  });
};

// Memory-intensive: Allocation churn
export const memoryWorkload: RouteHandler = async (req) => {
  const body = await req.json() as { 
    allocate_mb?: number; 
    duration_ms?: number;
  };
  
  const allocateMb = Math.min(body.allocate_mb || 10, 100); // Max 100MB
  const durationMs = Math.min(body.duration_ms || 100, 5000); // Max 5s
  
  const start = performance.now();
  
  // Allocate memory
  const buffers: Buffer[] = [];
  for (let i = 0; i < allocateMb; i++) {
    buffers.push(Buffer.alloc(1024 * 1024)); // 1MB each
  }
  
  // Hold for duration
  await new Promise(resolve => setTimeout(resolve, durationMs));
  
  // Release (hint to GC)
  buffers.length = 0;
  
  const processingTimeMs = performance.now() - start;
  
  return Response.json({
    allocated_mb: allocateMb,
    held_ms: durationMs,
    processingTimeMs: Math.round(processingTimeMs * 100) / 100,
  });
};

// Status endpoint
export const workloadStatus: RouteHandler = async () => {
  const [hashStats] = await sql`
    SELECT 
      COUNT(*) as total_jobs,
      AVG(processing_time_ms) as avg_time_ms,
      MAX(processing_time_ms) as max_time_ms
    FROM hash_jobs
    WHERE created_at > NOW() - INTERVAL '1 hour'
  `;
  
  const [payloadStats] = await sql`
    SELECT 
      COUNT(*) as total_payloads,
      SUM(size_kb) as total_kb
    FROM payloads
    WHERE created_at > NOW() - INTERVAL '1 hour'
  `;
  
  return Response.json({
    hash_jobs: hashStats,
    payloads: payloadStats,
  });
};
```

### 5.3 K6 Workload Test

**File**: `k6/workload-test.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Custom metrics
const hashDuration = new Trend('hash_processing_time');
const payloadSize = new Trend('payload_size_kb');
const memoryAllocated = new Trend('memory_allocated_mb');

export const options = {
  scenarios: {
    // 80% read traffic (cached)
    read_heavy: {
      executor: 'constant-vus',
      vus: 40,
      duration: '2m',
      exec: 'readOperations',
    },
    // 15% write traffic
    write_moderate: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'writeOperations',
      startTime: '5s',
    },
    // 5% CPU-intensive
    cpu_intensive: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'cpuOperations',
      startTime: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<100', 'p(99)<200'],
    http_req_failed: ['rate<0.01'],
    hash_processing_time: ['p(95)<500'],
  },
};

export function readOperations() {
  // List users (should hit L1/L2 cache)
  const listRes = http.get(`${BASE_URL}/api/users`);
  check(listRes, {
    'list status 200': (r) => r.status === 200,
  });
  
  // Get specific user (should hit cache)
  const userRes = http.get(`${BASE_URL}/api/users/1`);
  check(userRes, {
    'user status 200': (r) => r.status === 200,
  });
  
  sleep(0.1);
}

export function writeOperations() {
  const payload = JSON.stringify({
    name: `User ${Date.now()}`,
    email: `user${Date.now()}@example.com`,
  });
  
  const res = http.post(`${BASE_URL}/api/users`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  
  check(res, {
    'create status 201': (r) => r.status === 201,
  });
  
  sleep(0.5);
}

export function cpuOperations() {
  // Variable hash iterations
  const iterations = Math.floor(Math.random() * 50000) + 10000;
  
  const hashRes = http.post(
    `${BASE_URL}/api/workload/hash`,
    JSON.stringify({ data: 'benchmark-data', iterations }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  if (hashRes.status === 200) {
    const body = JSON.parse(hashRes.body);
    hashDuration.add(body.processingTimeMs);
  }
  
  // Variable payload sizes
  const sizeKb = Math.floor(Math.random() * 500) + 10;
  
  const payloadRes = http.post(
    `${BASE_URL}/api/workload/payload`,
    JSON.stringify({ size_kb: sizeKb }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  if (payloadRes.status === 200) {
    payloadSize.add(sizeKb);
  }
  
  sleep(1);
}
```

---

## Phase 6: New Metrics

### 6.1 Request Queue Time (Saturation Metric)

**File**: `src/telemetry/metrics.ts` (additions)

```typescript
// Request queue time - THE key saturation metric
export const requestQueueTime = meter.createHistogram('http_request_queue_time_ms', {
  description: 'Time between request arrival and handler execution start',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
  },
});

// Cache metrics
export const cacheHitCounter = meter.createCounter('cache_hits_total', {
  description: 'Total cache hits',
});

export const cacheMissCounter = meter.createCounter('cache_misses_total', {
  description: 'Total cache misses',
});

export const cacheLatency = meter.createHistogram('cache_latency_ms', {
  description: 'Cache operation latency',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
});

// Database metrics
export const dbQueryDuration = meter.createHistogram('pg_query_duration_ms', {
  description: 'PostgreSQL query duration',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
  },
});
```

### 6.2 Server Middleware Update

**File**: `src/index.ts` (fetch handler)

```typescript
const server = Bun.serve({
  port: 3000,
  
  async fetch(req) {
    // Record arrival time immediately
    const arrivalTime = performance.now();
    
    // ... routing logic ...
    
    // In handler wrapper, record queue time
    const handlerStartTime = performance.now();
    const queueTime = handlerStartTime - arrivalTime;
    requestQueueTime.record(queueTime, {
      route: matchedRoute,
      method: req.method,
    });
    
    // ... execute handler ...
  },
});
```

---

## Implementation Order (Optimized)

### Week 1: Database + PgBouncer
1. Add PostgreSQL + PgBouncer to docker-compose
2. Create optimized database schema
3. Implement database client (PgBouncer-compatible)
4. Create user repository with prepared queries
5. Migrate user handlers
6. Add database metrics

### Week 2: Two-Tier Caching
1. Add Redis to docker-compose (optimized config)
2. Implement L1 cache (LRU)
3. Implement L2 cache (Redis with pipelining)
4. Create unified cache layer with Pub/Sub invalidation
5. Apply caching to user handlers
6. Add cache metrics (L1/L2 hit rates, latency)

### Week 3: Observability + Kernel Tuning
1. Add kernel sysctls to docker-compose
2. Implement kernel metrics collector
3. Add request queue time metric
4. Update Grafana dashboard:
   - p99/p95 waiting vs duration panel
   - Connection capacity panel
   - Saturation heatmap
   - TCP metrics panel
   - Cache performance panel
   - PgBouncer pool panel

### Week 4: Workload + Testing
1. Add @noble/hashes dependency
2. Create workload handlers (hash, payload, memory)
3. Add workload routes
4. Create K6 workload test
5. Run full performance characterization
6. Document baseline metrics

---

## Files Summary

### New Files
```
my-app/
├── init.sql                           # Database schema
├── src/
│   ├── db/
│   │   ├── client.ts                  # PostgreSQL client (PgBouncer)
│   │   └── repositories/
│   │       └── users.ts               # User repository
│   ├── cache/
│   │   ├── l1-cache.ts                # In-process LRU
│   │   ├── l2-cache.ts                # Redis with pipelining
│   │   ├── cache.ts                   # Unified cache layer
│   │   └── strategies.ts              # Cache configuration
│   ├── handlers/
│   │   └── workload.ts                # Workload simulation
│   └── telemetry/
│       └── kernel-metrics.ts          # TCP/kernel metrics
├── k6/
│   └── workload-test.js               # Realistic workload test
└── monitoring/
    └── grafana/
        └── provisioning/
            └── dashboards/
                └── my-app-dashboard.json  # Enhanced dashboard
```

### Modified Files
```
docker-compose.yml          # Add PostgreSQL, PgBouncer, Redis, sysctls
src/handlers/users.ts       # Use repository + cache
src/telemetry/metrics.ts    # Add queue time, cache, DB metrics
src/routes.json             # Add workload routes
package.json                # Add dependencies
```

### New Dependencies
```json
{
  "dependencies": {
    "postgres": "^3.4.0",
    "ioredis": "^5.3.0",
    "lru-cache": "^10.0.0",
    "@noble/hashes": "^1.3.0"
  }
}
```

---

## Success Criteria (Extreme Performance)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Throughput** | >50K RPS | K6 constant-vus test |
| **p99 Latency** | <10ms | Grafana histogram |
| **p95 Latency** | <5ms | Grafana histogram |
| **L1 Cache Hit Rate** | >80% | `cache_hits_total{layer="l1"}` |
| **Combined Cache Hit Rate** | >95% | Total hits / (hits + misses) |
| **Cache Latency (L1)** | <0.1ms | `cache_latency_ms{layer="l1"}` |
| **Cache Latency (L2)** | <1ms | `cache_latency_ms{layer="l2"}` |
| **DB Query p95** | <5ms | `pg_query_duration_ms` |
| **PgBouncer Wait** | 0 clients | `pgbouncer_pools_client_waiting` |
| **TCP Retransmit Rate** | <0.1% | `tcp_retransmits / tcp_segments_sent` |
| **Queue Time p99** | <2ms | `http_request_queue_time_ms` |
| **Memory Growth** | <5% over 1hr | Soak test |
