# ADR-008: Vitest as Testing Framework

## Status
Accepted

## Context

The Report Builder system requires a comprehensive testing framework for:

- **Unit testing**: Lambda functions, utility classes, and configuration modules
- **Integration testing**: AWS service interactions and end-to-end workflows
- **TypeScript support**: Native TypeScript testing without additional compilation
- **Mocking capabilities**: AWS SDK mocking for isolated unit tests
- **Performance**: Fast test execution for development productivity
- **CI/CD integration**: Reliable testing in automated pipelines
- **Developer experience**: Good error messages and debugging support

## Decision

We will use **Vitest** as the primary testing framework for all unit tests, integration tests, and mocking requirements.

## Alternatives Considered

### 1. Jest
- **Pros**: Most popular JavaScript testing framework, extensive ecosystem, excellent mocking
- **Cons**: Slower than Vitest, requires additional TypeScript configuration, heavier dependencies

### 2. Mocha + Chai + Sinon
- **Pros**: Mature ecosystem, flexible configuration, modular approach
- **Cons**: More complex setup, multiple dependencies to manage, slower execution

### 3. AVA
- **Pros**: Fast parallel execution, minimal configuration, modern syntax
- **Cons**: Smaller ecosystem, less AWS-specific testing utilities, limited mocking

### 4. Node.js Test Runner (Built-in)
- **Pros**: No additional dependencies, built into Node.js 18+, fast execution
- **Cons**: Limited features, minimal mocking support, new and evolving

### 5. Jasmine
- **Pros**: Behavior-driven development syntax, no dependencies, familiar API
- **Cons**: Less modern than alternatives, limited TypeScript support, slower development

## Consequences

### Positive
- **Performance**: Significantly faster than Jest, especially for TypeScript projects
- **TypeScript native**: No additional configuration required for TypeScript support
- **Modern architecture**: Built on Vite, leverages modern build tools and ESM
- **Jest compatibility**: Drop-in replacement for Jest with familiar API
- **Excellent mocking**: Powerful mocking capabilities with vi.mock()
- **Hot module replacement**: Fast re-runs during development
- **ESM support**: Native ES module support without configuration
- **Vite ecosystem**: Benefits from Vite's plugin ecosystem and optimizations

### Negative
- **Newer framework**: Less mature than Jest, smaller community
- **Plugin ecosystem**: Fewer plugins available compared to Jest
- **Documentation**: Less comprehensive documentation and Stack Overflow answers
- **AWS-specific tools**: Fewer AWS-specific testing utilities compared to Jest ecosystem

### Neutral
- **API familiarity**: Jest-compatible API reduces learning curve
- **Migration path**: Easy migration to/from Jest if needed
- **Configuration**: Similar configuration patterns to other modern testing frameworks

## Implementation Notes

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'infrastructure/',
        '**/*.d.ts',
        '**/*.test.ts'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      '@': './src'
    }
  }
});
```

### Integration Test Configuration

```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,    // Extended timeout for AWS calls
    hookTimeout: 30000,
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts']
  }
});
```

### Testing Patterns

#### Unit Tests with Mocking
```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmailProcessor } from '../src/lambda/email-processor';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn()
}));

describe('EmailProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process email successfully', async () => {
    // Test implementation
  });
});
```

#### Integration Tests
```typescript
import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';

describe('S3 Integration', () => {
  it('should upload and retrieve files', async () => {
    // Real AWS service integration
  }, 30000); // Extended timeout
});
```

### AWS SDK Mocking Strategy
- **Unit tests**: Mock all AWS SDK calls for fast, isolated testing
- **Integration tests**: Use real AWS services with test-specific resources
- **Test utilities**: Shared mocking utilities for common AWS operations
- **Environment separation**: Different test configurations for different test types

### Coverage Configuration
- **Statements**: 100% target for core business logic
- **Branches**: 95%+ target with documented exceptions
- **Functions**: 100% target for exported functions
- **Lines**: 100% target with exclusions for error handling edge cases

### CI/CD Integration
```yaml
# GitHub Actions
- name: Run Tests
  run: npm test

- name: Run Integration Tests
  run: npm run test:integration
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

### Performance Benefits
- **Fast startup**: Vite-powered test runner with minimal overhead
- **Parallel execution**: Tests run in parallel by default
- **Hot reloading**: Changed tests re-run automatically
- **TypeScript performance**: No separate compilation step required
- **Smart re-runs**: Only affected tests re-run on file changes

### Developer Experience
- **Error messages**: Clear, helpful error messages with source maps
- **Debugging**: Native Node.js debugging support
- **Watch mode**: Excellent watch mode with file change detection
- **IDE integration**: Good support in VS Code and other IDEs
- **Stack traces**: Clear stack traces with proper source mapping

### Future Extensibility
- **Vite plugins**: Access to Vite plugin ecosystem for specialized testing needs
- **Custom matchers**: Easy to add domain-specific test assertions
- **Test utilities**: Growing ecosystem of Vitest-specific utilities
- **Performance monitoring**: Built-in performance profiling capabilities

## References
- [Vitest Documentation](https://vitest.dev/)
- [Vite Guide](https://vitejs.dev/guide/)
- [Vitest API Reference](https://vitest.dev/api/)
- [Migration from Jest](https://vitest.dev/guide/migration.html) 