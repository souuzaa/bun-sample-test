import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Custom metrics
const hashProcessingTime = new Trend('hash_processing_time');
const payloadSizeKb = new Trend('payload_size_kb');
const cacheHits = new Counter('cache_hits');
const cacheMisses = new Counter('cache_misses');

// Test configuration with realistic traffic mix
export const options = {
  scenarios: {
    // 80% of traffic - read operations (should hit cache)
    read_heavy: {
      executor: 'constant-vus',
      vus: 40,
      duration: '2m',
      exec: 'readOperations',
    },
    // 15% of traffic - write operations (invalidates cache)
    write_moderate: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'writeOperations',
      startTime: '5s',
    },
    // 5% of traffic - CPU intensive operations
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

// Read operations - 80% of traffic
// These should hit the cache most of the time
export function readOperations() {
  // GET /api/users - should hit L1/L2 cache
  const usersResponse = http.get(`${BASE_URL}/api/users`);
  check(usersResponse, {
    'GET /api/users status is 200': (r) => r.status === 200,
    'GET /api/users has users': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body) && body.length > 0;
      } catch {
        return false;
      }
    },
  });

  // GET /api/users/1 - should hit cache
  const userResponse = http.get(`${BASE_URL}/api/users/1`);
  check(userResponse, {
    'GET /api/users/1 status is 200': (r) => r.status === 200,
    'GET /api/users/1 has user data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Small sleep to simulate realistic traffic
  sleep(0.1);
}

// Write operations - 15% of traffic
// These invalidate cache entries
export function writeOperations() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const payload = JSON.stringify({
    name: `User ${uniqueId}`,
    email: `user-${uniqueId}@example.com`,
  });

  const response = http.post(`${BASE_URL}/api/users`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(response, {
    'POST /api/users status is 201': (r) => r.status === 201,
    'POST /api/users returns user': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined && body.email !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}

// CPU intensive operations - 5% of traffic
// Tests hash workload and payload generation
export function cpuOperations() {
  // POST /api/workload/hash with random iterations (10000-60000)
  const iterations = Math.floor(Math.random() * 50000) + 10000;
  const hashPayload = JSON.stringify({
    data: `benchmark-data-${Date.now()}`,
    iterations: iterations,
  });

  const hashResponse = http.post(`${BASE_URL}/api/workload/hash`, hashPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(hashResponse, {
    'POST /api/workload/hash status is 200': (r) => r.status === 200,
    'POST /api/workload/hash returns hash': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.hash !== undefined && body.processingTimeMs !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Record hash processing time from response
  if (hashResponse.status === 200) {
    try {
      const hashData = JSON.parse(hashResponse.body);
      if (hashData.processingTimeMs) {
        hashProcessingTime.add(hashData.processingTimeMs);
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // POST /api/workload/payload with random size (10-500KB)
  const sizeKb = Math.floor(Math.random() * 490) + 10;
  const payloadPayload = JSON.stringify({
    size_kb: sizeKb,
  });

  const payloadResponse = http.post(`${BASE_URL}/api/workload/payload`, payloadPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(payloadResponse, {
    'POST /api/workload/payload status is 200': (r) => r.status === 200,
    'POST /api/workload/payload returns data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.size_kb !== undefined && body.data !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Record payload size
  if (payloadResponse.status === 200) {
    payloadSizeKb.add(sizeKb);
  }

  sleep(1);
}

// Optional: Setup function to verify server is ready
export function setup() {
  const healthResponse = http.get(`${BASE_URL}/api/health`);
  check(healthResponse, {
    'Health check passed': (r) => r.status === 200,
  });

  if (healthResponse.status !== 200) {
    throw new Error(`Server not ready at ${BASE_URL}`);
  }

  console.log(`Running workload test against ${BASE_URL}`);
  return { baseUrl: BASE_URL };
}

// Optional: Teardown function for cleanup
export function teardown(data) {
  console.log(`Workload test completed against ${data.baseUrl}`);
}
