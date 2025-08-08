# Integration Test Suite

This directory contains comprehensive integration tests for the Report Builder application. These tests validate the complete system functionality using real AWS services to ensure production-ready behavior.

## Overview

The integration test suite provides end-to-end validation of:

- **Complete email processing workflow** - From SES event to S3 storage
- **S3 integration** - File upload, download, organization, and performance
- **Parameter Store integration** - Configuration management and caching
- **Lambda deployment validation** - Function existence, invocation, and performance
- **AWS service integration** - Real service interactions and error handling

## Test Structure

```
tests/
├── integration/           # Integration test files
│   ├── email-processing-workflow.test.ts
│   ├── s3-integration.test.ts
│   ├── parameter-store-integration.test.ts
│   └── lambda-deployment.test.ts
├── fixtures/              # Test data and fixtures
│   └── test-data.ts       # Realistic test data for all scenarios
├── utils/                 # Test utilities and helpers
│   └── aws-test-helpers.ts # AWS service integration utilities
└── README.md              # This file
```

## Prerequisites

### AWS Configuration

1. **AWS Credentials**: Configure AWS credentials with sufficient permissions:
   ```bash
   aws configure
   # OR set environment variables:
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   export AWS_REGION=us-east-1
   ```

2. **Required AWS Permissions**:
   - S3: `s3:CreateBucket`, `s3:DeleteBucket`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`
   - Parameter Store: `ssm:GetParameter`, `ssm:PutParameter`, `ssm:DeleteParameter`
   - Lambda: `lambda:InvokeFunction`, `lambda:GetFunction` (for deployment validation)

3. **Network Connectivity**: Ensure network access to AWS services

### Environment Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Build Application**:
   ```bash
   npm run build
   ```

3. **Deploy Infrastructure** (for Lambda deployment tests):
   ```bash
   cd infrastructure
   npm run cdk deploy
   ```

## Running Integration Tests

### Basic Commands

```bash
# Run all integration tests
npm run test:integration

# Run integration tests in watch mode
npm run test:integration:watch

# Run both unit and integration tests
npm run test:all

# Run specific integration test file
npx vitest run tests/integration/s3-integration.test.ts --config vitest.integration.config.ts
```

### Environment Variables

```bash
# Optional: Override default test configuration
export INTEGRATION_TEST_TIMEOUT=120000  # 2 minutes
export AWS_REGION=us-west-2              # Different region
export NODE_ENV=test                     # Ensure test environment
```

## Test Categories

### 1. Email Processing Workflow Tests

**File**: `email-processing-workflow.test.ts`

Tests the complete email processing pipeline from SES event to file storage:

- End-to-end email processing with attachments
- Email parsing and attachment extraction
- Property identification via Parameter Store
- S3 file organization and metadata generation
- Error handling and retry mechanisms
- Performance validation under load

**Example Run**:
```bash
npx vitest run tests/integration/email-processing-workflow.test.ts --config vitest.integration.config.ts
```

### 2. S3 Integration Tests

**File**: `s3-integration.test.ts`

Validates S3-specific functionality:

- Bucket operations and file management
- File organization patterns and structure
- Large file handling and performance
- Concurrent upload/download operations
- Error scenarios and recovery
- Special character handling in file names

**Example Run**:
```bash
npx vitest run tests/integration/s3-integration.test.ts --config vitest.integration.config.ts
```

### 3. Parameter Store Integration Tests

**File**: `parameter-store-integration.test.ts`

Tests Parameter Store configuration management:

- Parameter creation, retrieval, and updates
- Caching behavior and performance optimization
- Hierarchical parameter organization
- Error handling and fallback mechanisms
- Concurrent access patterns
- Configuration validation

**Example Run**:
```bash
npx vitest run tests/integration/parameter-store-integration.test.ts --config vitest.integration.config.ts
```

### 4. Lambda Deployment Validation Tests

**File**: `lambda-deployment.test.ts`

Validates deployed Lambda functions:

- Function existence and configuration
- Invocation with real SES events
- Performance characteristics and cold starts
- AWS service integration validation
- Error handling in deployed environment
- Environment-specific configuration

**Example Run**:
```bash
npx vitest run tests/integration/lambda-deployment.test.ts --config vitest.integration.config.ts
```

## Test Configuration

### Timeouts

Integration tests use extended timeouts to accommodate AWS service latency:

- **Test Timeout**: 60 seconds per test
- **Hook Timeout**: 30 seconds for setup/teardown
- **S3 Operations**: 10 seconds
- **Lambda Invocations**: 30 seconds
- **Parameter Store**: 5 seconds
- **Email Processing**: 45 seconds

### Resource Management

Tests automatically create and clean up AWS resources:

- **S3 Buckets**: Unique timestamped names for isolation
- **Parameters**: Isolated namespace `/report-builder/integration-test/`
- **Objects**: Tracked and deleted during cleanup
- **Cleanup**: Automatic cleanup in `afterAll` hooks

### Parallel Execution

Integration tests are configured for safe parallel execution:

- **Max Threads**: 3 (to avoid AWS rate limits)
- **Retry Logic**: 2 retries for flaky AWS operations
- **Resource Isolation**: Each test creates unique resources

## Troubleshooting

### Common Issues

1. **AWS Credentials Not Found**:
   ```
   Error: Unable to locate credentials
   ```
   **Solution**: Configure AWS credentials using `aws configure` or environment variables

2. **Permission Denied**:
   ```
   Error: AccessDenied
   ```
   **Solution**: Ensure your AWS credentials have required permissions listed above

3. **Network Timeouts**:
   ```
   Error: Network timeout
   ```
   **Solution**: Check network connectivity to AWS services, increase timeouts if needed

4. **Resource Conflicts**:
   ```
   Error: Bucket already exists
   ```
   **Solution**: Tests use unique timestamped names; this usually indicates cleanup issues

5. **Lambda Function Not Found**:
   ```
   Error: Function not found
   ```
   **Solution**: Deploy infrastructure first using `cd infrastructure && npm run cdk deploy`

### Debug Mode

Enable verbose logging for debugging:

```bash
# Run with debug output
DEBUG=1 npm run test:integration

# Run specific test with verbose output
npx vitest run tests/integration/s3-integration.test.ts --config vitest.integration.config.ts --reporter=verbose
```

### Manual Cleanup

If automatic cleanup fails, manually remove test resources:

```bash
# List and delete test buckets
aws s3 ls | grep report-builder-integration-test
aws s3 rb s3://bucket-name --force

# List and delete test parameters
aws ssm get-parameters-by-path --path "/report-builder/integration-test" --recursive
aws ssm delete-parameter --name "/report-builder/integration-test/parameter-name"
```

## Performance Expectations

### Typical Test Execution Times

- **S3 Integration**: 30-60 seconds
- **Parameter Store**: 15-30 seconds
- **Email Processing Workflow**: 60-120 seconds
- **Lambda Deployment**: 45-90 seconds

### Performance Benchmarks

Tests include performance validation:

- **S3 Upload/Download**: < 30 seconds for 1MB files
- **Lambda Cold Start**: < 15 seconds average
- **Parameter Store Retrieval**: < 5 seconds
- **Email Processing**: < 45 seconds end-to-end

## Contributing

When adding new integration tests:

1. **Follow naming conventions**: `feature-integration.test.ts`
2. **Use test utilities**: Import from `../utils/aws-test-helpers`
3. **Include cleanup**: Always clean up created resources
4. **Add timeouts**: Set appropriate timeouts for AWS operations
5. **Document prerequisites**: Note any special setup requirements
6. **Test error scenarios**: Include both success and failure cases

### Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IntegrationTestSuite } from '../utils/aws-test-helpers';
import { TEST_TIMEOUTS } from '../fixtures/test-data';

describe('Your Feature Integration', () => {
  let testSuite: IntegrationTestSuite;

  beforeAll(async () => {
    testSuite = new IntegrationTestSuite();
    await testSuite.setup();
  }, TEST_TIMEOUTS.S3_OPERATION);

  afterAll(async () => {
    await testSuite.cleanup();
  }, TEST_TIMEOUTS.S3_OPERATION);

  it('should test your feature', async () => {
    // Your test implementation
  }, TEST_TIMEOUTS.EMAIL_PROCESSING);
});
```

## CI/CD Integration

Integration tests can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Integration Tests
  run: npm run test:integration
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_REGION: us-east-1
```

For production deployments, run integration tests against staging environment first to validate deployment before promoting to production. 