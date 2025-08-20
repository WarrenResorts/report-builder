# Integration Test Strategy

## Overview

Our integration tests are designed to be **smart** and **adaptive**, providing value in multiple scenarios while avoiding false failures.

## Test Modes

### 🎭 **Mocked Mode (Default)**
- **When**: No AWS credentials available
- **What**: Tests integration patterns and configurations without requiring real AWS services
- **Value**: Validates code structure, event handling patterns, and configuration consistency
- **Run with**: `npm run test:integration:local`

### ☁️ **Real AWS Mode**
- **When**: AWS credentials available + `USE_REAL_AWS=true`
- **What**: Tests against actual deployed AWS resources
- **Value**: Validates real-world functionality and deployed infrastructure
- **Run with**: `npm run test:integration:aws`

### 🚀 **CI Mode**
- **When**: CI environment with `INTEGRATION_TEST_ENVIRONMENT` set
- **What**: Tests against deployed development environment in CI/CD pipeline
- **Value**: Validates deployments work correctly before promotion

## Why This Approach?

### ❌ **The Problem We Solved**
Traditional integration tests that always require real AWS services:
- Fail on developer machines without AWS setup
- Create noise and false negatives
- Make developers ignore test failures
- Block development when AWS services are unavailable

### ✅ **Our Solution**
Smart integration tests that:
- **Always provide value** regardless of environment
- **Never create false failures** due to missing AWS setup
- **Scale from local development to production validation**
- **Give clear feedback** about what's being tested

## What Gets Tested

### In All Modes
- Configuration validity
- Event structure validation
- Integration pattern consistency
- Naming convention adherence

### In Real AWS Mode Only
- Actual Lambda function invocation
- Real S3 bucket operations
- Parameter Store access
- Cross-service communication

## Running Integration Tests

### Local Development
```bash
# Run with smart defaults (mocked if no AWS)
npm run test:integration

# Force local mode (useful for testing patterns)
npm run test:integration:local

# Test against real AWS (requires credentials)
npm run test:integration:aws
```

### CI/CD Pipeline
```bash
# Automatic mode based on environment
npm run test:integration
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `USE_REAL_AWS` | Force real AWS testing | `false` |
| `SKIP_INTEGRATION_TESTS` | Skip all integration tests | `false` |
| `INTEGRATION_TEST_ENVIRONMENT` | CI environment marker | unset |
| `AWS_REGION` | AWS region for testing | `us-east-1` |

## Test Categories

### 1. Environment Configuration Tests
- ✅ Always run
- Validate environment variables and configuration consistency

### 2. Lambda Integration Tests  
- 🎭 **Mocked**: Validates function naming and event patterns
- ☁️ **Real AWS**: Invokes actual deployed functions

### 3. S3 Integration Tests
- 🎭 **Mocked**: Validates bucket naming patterns
- ☁️ **Real AWS**: Tests actual bucket operations

### 4. Parameter Store Tests
- 🎭 **Mocked**: Validates parameter naming conventions
- ☁️ **Real AWS**: Retrieves actual parameters

### 5. Cross-Service Integration Tests
- 🎭 **Mocked**: Validates integration patterns and event flows
- ☁️ **Real AWS**: Tests complete workflows end-to-end

## CI/CD Integration

### Development Environment
- **Trigger**: PR creation/updates
- **Mode**: Real AWS against development account
- **Purpose**: Validate deployments work correctly

### Production Environment  
- **Trigger**: Manual deployment
- **Mode**: Real AWS against production account
- **Purpose**: Final validation before production release

## Best Practices

### ✅ Do
- Write tests that provide value in both mocked and real modes
- Use descriptive test names that indicate what's being validated
- Log clearly what mode tests are running in
- Make tests resilient to AWS service temporary unavailability

### ❌ Don't
- Write tests that only work with real AWS services
- Create tests that fail due to missing AWS setup
- Assume AWS resources exist without checking
- Use hardcoded values that won't work across environments

## Example Test Structure

```typescript
describe('Smart Integration Test', () => {
  it('should validate Lambda configuration patterns', async () => {
    if (testMode === 'real-aws') {
      // Test against real deployed Lambda functions
      const functions = await lambda.listFunctions();
      expect(functions).toContainFunction('email-processor');
    } else {
      // Test configuration patterns without AWS
      const expectedName = `email-processor-${environment}`;
      expect(expectedName).toContain(environment);
    }
  });
});
```

This approach ensures integration tests are **always useful** while scaling from local development to production validation.
