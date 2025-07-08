# Report Builder Infrastructure

This directory contains the AWS CDK infrastructure code for the Report Builder application.

## Architecture

- **S3 Buckets**: File storage for incoming, processed, and mapping files
- **Lambda Functions**: Email and file processing logic
- **SES**: Email receiving and sending configuration
- **IAM Roles**: Secure access between services

## Environments

The infrastructure supports two environments:
- **Development**: For testing and development work
- **Production**: For live operations

## Deployment Commands

### Development Environment
```bash
# Deploy to development
npx cdk deploy --context environment=development

# Destroy development resources
npx cdk destroy --context environment=development
```

### Production Environment
```bash
# Deploy to production
npx cdk deploy --context environment=production

# Destroy production resources (use with caution!)
npx cdk destroy --context environment=production
```

## Other Useful Commands

```bash
# Compile TypeScript to JavaScript
npm run build

# Watch for changes and compile
npm run watch

# Run unit tests
npm run test

# Compare deployed stack with current state
npx cdk diff --context environment=development

# Synthesize CloudFormation template
npx cdk synth --context environment=development
```

## Setup Requirements

1. AWS CLI configured with appropriate credentials
2. CDK bootstrapped in your target AWS account/region:
   ```bash
   npx cdk bootstrap
   ```

## Resources Created

### S3 Buckets
- `report-builder-incoming-files-{environment}`: Stores files received via email
- `report-builder-processed-files-{environment}`: Stores processed output files
- `report-builder-mapping-files-{environment}`: Stores Excel mapping files

### Lambda Functions
- `report-builder-email-processor-{environment}`: Processes incoming emails
- `report-builder-file-processor-{environment}`: Processes files and generates reports

### SES Configuration
- Configuration set for email handling in each environment

## Notes

- Development resources are configured with `DESTROY` removal policy for easy cleanup
- Production resources use `RETAIN` removal policy for safety
- All resources are tagged with environment and project information
