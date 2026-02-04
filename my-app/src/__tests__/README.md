# Test Suite Documentation

This directory contains the comprehensive test suite for the application. The tests are organized into three main categories: unit tests, integration tests, and performance tests.

## Directory Structure

```
src/__tests__/
├── unit/                    # Unit tests for individual components
│   ├── cache/              # Cache layer tests
│   │   ├── cache.test.ts        # Multi-layer cache integration
│   │   ├── l1-cache.test.ts     # L1 (in-memory) cache tests
│   │   └── strategies.test.ts   # Cache key and invalidation strategies
│   ├── db/                 # Database layer tests
│   │   ├── client.test.ts       # Database client configuration
│   │   └── repositories/
│   │       └── users.test.ts    # User repository tests
│   ├── handlers/           # HTTP handler tests
│   │   ├── index.test.ts        # Handler registration
│   │   └── types.test.ts        # RouteHandler type tests
│   ├── general.test.ts     # General endpoints (home, health)
│   ├── users.test.ts       # User CRUD endpoints
│   ├── workload.test.ts    # Workload simulation endpoints
│   └── routing.test.ts     # Route configuration and matching
├── integration/            # Integration tests
│   └── api.test.ts        # End-to-end API tests
└── performance/            # Performance tests
    └── load.test.ts       # Load testing scenarios

```

## Running Tests

### All Tests
```bash
bun test
```

### Unit Tests Only
```bash
bun test src/__tests__/unit
# or
npm run test:unit
```

### Integration Tests Only
```bash
bun test src/__tests__/integration
# or
npm run test:integration
```

### Performance Tests Only
```bash
bun test src/__tests__/performance
# or
npm run test:performance
```

### Watch Mode
```bash
bun test --watch
# or
npm run test:watch
```

### Specific Test File
```bash
bun test src/__tests__/unit/cache/l1-cache.test.ts
```

## Test Categories

### Unit Tests

Unit tests focus on testing individual functions, modules, and components in isolation. They are fast, deterministic, and don't require external dependencies.

**Coverage includes:**
- Cache operations (L1, L2, strategies)
- Database client configuration and transformations
- Repository interfaces and types
- HTTP handlers (general, users, workload)
- Routing logic and configuration
- Type definitions and contracts

### Integration Tests

Integration tests verify that multiple components work correctly together. They may require external services like databases and Redis.

**Coverage includes:**
- Full HTTP request/response cycles
- Database queries and transactions
- Cache layer interactions
- End-to-end API workflows

### Performance Tests

Performance tests evaluate the application under various load conditions.

**Coverage includes:**
- Response time under load
- Throughput measurements
- Resource utilization
- Concurrency handling

## Test Patterns

### Basic Test Structure

```typescript
import { describe, expect, test } from "bun:test";

describe("Component Name", () => {
  describe("function or feature", () => {
    test("should do something specific", () => {
      // Arrange
      const input = "test";

      // Act
      const result = someFunction(input);

      // Assert
      expect(result).toBe("expected");
    });
  });
});
```

### Async Tests

```typescript
test("should handle async operations", async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Error Handling Tests

```typescript
test("should handle errors gracefully", async () => {
  const response = await handler(invalidRequest);
  expect(response.status).toBe(400);
});
```

## Best Practices

1. **Test Naming**: Use descriptive names that explain what is being tested and the expected outcome
   - Good: `"returns 404 when user not found"`
   - Bad: `"test getUserById"`

2. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification phases

3. **Independence**: Each test should be independent and not rely on other tests

4. **Coverage**: Test happy paths, error cases, edge cases, and boundary conditions

5. **Cleanup**: Clean up resources (clear caches, close connections) after tests

6. **Mock External Dependencies**: In unit tests, mock external services to ensure fast, reliable tests

## Testing Different Layers

### Handler Tests
```typescript
test("returns user when found", async () => {
  const req = new Request("http://localhost/api/users/1");
  const response = await getUserById(req, { id: "1" });
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.id).toBe(1);
});
```

### Cache Tests
```typescript
test("stores and retrieves values", () => {
  l1.set("key", "value");
  const result = l1.get("key");
  expect(result).toBe("value");
});
```

### Database Tests
```typescript
test("transforms snake_case to camelCase", () => {
  const transform = (col: string) =>
    col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

  expect(transform("created_at")).toBe("createdAt");
});
```

## Debugging Tests

### Run with Verbose Output
```bash
bun test --verbose
```

### Run Specific Test
```bash
bun test --test-name-pattern "returns user when found"
```

### Use console.log for Debugging
```typescript
test("debug test", () => {
  const data = { id: 1, name: "Test" };
  console.log("Data:", data);
  expect(data.id).toBe(1);
});
```

## Common Test Utilities

### Creating Mock Requests
```typescript
const req = new Request("http://localhost/api/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Test", email: "test@example.com" })
});
```

### Checking Response Types
```typescript
expect(response).toBeInstanceOf(Response);
expect(response.status).toBe(200);
const contentType = response.headers.get("content-type");
expect(contentType).toContain("application/json");
```

### Testing Async Operations
```typescript
test("handles async errors", async () => {
  try {
    await handler(badRequest);
    fail("Should have thrown");
  } catch (error) {
    expect(error).toBeDefined();
  }
});
```

## Test Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 85%
- **Lines**: > 80%

## Continuous Integration

Tests are automatically run on:
- Pull request creation
- Push to main branch
- Before deployment

## Contributing

When adding new features:
1. Write tests first (TDD approach) or alongside the implementation
2. Ensure all tests pass before submitting PR
3. Add tests for edge cases and error scenarios
4. Update this documentation if adding new test patterns

## Troubleshooting

### Tests Fail in CI but Pass Locally
- Check environment variables
- Verify Docker services are running
- Check for timing issues (use proper async/await)

### Slow Tests
- Check if tests are waiting for timeouts
- Verify external services are responding quickly
- Consider mocking slow dependencies in unit tests

### Flaky Tests
- Look for race conditions
- Check for shared state between tests
- Ensure proper cleanup in beforeEach/afterEach

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Testing Best Practices](https://testingjavascript.com/)
- Project-specific test examples in this directory