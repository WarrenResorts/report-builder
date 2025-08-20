# Integration Test Strategy

This directory contains simple integration tests that validate only the functionality we've actually built.

## Test Philosophy

**Only test what we've implemented**: These integration tests validate actual deployed functionality, not hypothetical features.

## Test Modes

### Mocked Mode (Local Development)
- **When**: No AWS credentials available
- **Behavior**: Tests pass with minimal validation (just checking object creation)
- **Purpose**: Allows developers to run tests locally without AWS access
- **Command**: `npm run test:integration:local`

### Real AWS Mode (Deployed Environment)
- **When**: AWS credentials are available and infrastructure is deployed
- **Behavior**: Tests run against actual AWS resources
- **Purpose**: Validates that deployed infrastructure works correctly
- **Command**: `npm run test:integration:aws`

## Current Test Coverage

We only test what we've actually built:

1. **Parameter Store Integration** (`parameter-store-integration.test.ts`)
   - Basic parameter retrieval
   - Error handling for missing parameters
   - Connection validation

## Running Tests

### Local Development (Mocked)
```bash
npm run test:integration:local
```

### Against Deployed Infrastructure
```bash
# Ensure AWS credentials are configured for the development account
aws configure list

# Run against real AWS
npm run test:integration:aws
```

## Adding New Tests

When we build new features, add corresponding integration tests that:

1. **Test only implemented functionality**
2. **Work in both mocked and real AWS modes** 
3. **Are simple and focused**
4. **Will pass once the feature is deployed**

## Test Structure

```typescript
it('should test actual functionality', async () => {
  if (testMode === 'mocked') {
    // Just verify basic setup works
    expect(service).toBeDefined();
    return;
  }

  // Test real AWS functionality
  const result = await service.actualMethod();
  expect(result).toBeDefined();
});
```