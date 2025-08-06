# Report Builder API Documentation

## Overview

The Report Builder system consists of serverless Lambda functions that process emails and generate reports. This documentation provides comprehensive API specifications for all system interfaces.

## Architecture

```
Email → SES → S3 (raw storage) → Email Processor Lambda → S3 (organized files)
                                           ↓
EventBridge (scheduled) → File Processor Lambda → S3 (processed reports)
```

## Lambda Functions

### 1. Email Processor Lambda
- **Purpose**: Processes incoming emails from SES, extracts attachments, and organizes files
- **Trigger**: SES email events
- **Documentation**: [email-processor-api.md](./email-processor-api.md)

### 2. File Processor Lambda
- **Purpose**: Batch processes daily files and generates consolidated reports
- **Trigger**: EventBridge scheduled events
- **Documentation**: [file-processor-api.md](./file-processor-api.md)

## Event Schemas

- **SES Email Event**: [schemas/ses-event.yaml](./schemas/ses-event.yaml)
- **EventBridge File Processing Event**: [schemas/eventbridge-event.yaml](./schemas/eventbridge-event.yaml)
- **Email Processor Response**: [schemas/email-processor-response.yaml](./schemas/email-processor-response.yaml)
- **File Processor Response**: [schemas/file-processor-response.yaml](./schemas/file-processor-response.yaml)

## Examples & Usage

- **Email Processing Flow**: [examples/email-processing-flow.md](./examples/email-processing-flow.md)
- **Error Scenarios**: [examples/error-scenarios.md](./examples/error-scenarios.md)
- **Testing Locally**: [examples/local-testing.md](./examples/local-testing.md)

## Environment Variables

Both Lambda functions use the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment name | `development`, `production` |
| `INCOMING_FILES_BUCKET` | S3 bucket for raw files | `report-builder-incoming-files-dev` |
| `PROCESSED_FILES_BUCKET` | S3 bucket for processed files | `report-builder-processed-files-dev` |
| `MAPPING_FILES_BUCKET` | S3 bucket for mapping files | `report-builder-mapping-files-dev` |
| `PARAMETER_STORE_CACHE_TTL_SECONDS` | Cache TTL for parameter store | `30` (dev), `900` (prod) |

## Error Handling

All Lambda functions implement structured error handling with:

- **Correlation IDs** for request tracing
- **Retry mechanisms** with exponential backoff
- **Structured logging** in JSON format
- **Type-specific error responses** with context

## Security

- **IAM Roles**: Least privilege access to AWS resources
- **Parameter Store**: Encrypted configuration storage
- **VPC**: Functions can be deployed in VPC for enhanced security
- **Input Validation**: All inputs are validated and sanitized

## Monitoring

- **CloudWatch Logs**: Structured JSON logging with correlation IDs
- **CloudWatch Metrics**: Custom metrics for processing success/failure
- **X-Ray Tracing**: Distributed tracing for complex workflows
- **Lambda Insights**: Performance monitoring and optimization

## Development

### Local Testing
```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Test with local environment
NODE_ENV=development npm start
```

### Deployment
```bash
# Deploy to development
npx cdk deploy --context environment=development

# Deploy to production
npx cdk deploy --context environment=production
```

## Support

For issues or questions:
1. Check the examples and error scenarios documentation
2. Review CloudWatch logs with correlation IDs
3. Consult the specific Lambda function documentation
4. Check the integration test suite for expected behavior 