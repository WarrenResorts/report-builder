# Environment Setup Guide

This guide covers the setup and configuration for different deployment environments.

## Environment Overview

| Aspect | Development | Production |
|--------|-------------|------------|
| **Purpose** | Testing, development, experimentation | Live business operations |
| **Data Retention** | 30 days | 7 years |
| **Monitoring** | Basic logs | Enhanced metrics + alerting |
| **Cost** | ~$2-5/month | ~$5-15/month |
| **Approval** | Auto-deploy | Manual approval required |
| **Git Branch** | Any branch | Main branch only |

## Development Environment

### Configuration Location
```
infrastructure/config/environments/development.json
```

### Key Settings

```json
{
  "domain": {
    "domainName": "aws.example.com",
    "emailAddress": "dev@example.com"
  },
  "storage": {
    "lifecycleTransitionDays": 7,
    "lifecycleArchiveDays": 30,
    "retentionDays": 90
  },
  "lambda": {
    "timeout": 300,
    "memorySize": 512,
    "reservedConcurrency": 5
  },
  "application": {
    "parameterStore": {
      "cacheTTLSeconds": 30
    }
  },
  "scheduling": {
    "dailyProcessingCron": "cron(0 */2 * * ? *)",
    "weeklyReportingCron": "cron(0 10 ? * MON *)"
  }
}
```

### Development-Specific Features

#### Fast Iteration
- **Short cache TTL** (30 seconds) for quick parameter updates
- **Frequent processing** (every 2 hours) for testing
- **Lower timeout values** for faster feedback
- **Minimal retention** for cost optimization

#### Resource Limits
- **Reserved concurrency**: 5 (prevent runaway costs)
- **Memory size**: 512MB (adequate for dev workloads)
- **Quick lifecycle transitions** (7 days to IA, 30 days to Glacier)

#### Testing Features
- **Separate email address** for development testing
- **Shorter retention** (90 days total)
- **Relaxed monitoring** (basic CloudWatch logs)

### Development Deployment

```bash
# Quick deployment
./scripts/deploy.sh --environment development

# With verbose output for debugging
./scripts/deploy.sh -e development -v

# Skip tests for rapid iteration
./scripts/deploy.sh -e development --skip-tests

# Dry run to see changes
./scripts/deploy.sh -e development --dry-run
```

### Development Testing

#### Email Testing
1. **Configure test email address**:
   ```bash
   # Update Parameter Store
   aws ssm put-parameter \
     --name "/report-builder/development/config/property-mapping" \
     --value '{"test@example.com": "property-dev-1"}' \
     --type SecureString
   ```

2. **Send test email** to `dev@example.com`

3. **Check processing**:
   ```bash
   # View Lambda logs
   aws logs tail /aws/lambda/report-builder-development-EmailProcessor

   # Check S3 for processed files
   aws s3 ls s3://report-builder-incoming-files-development/daily-files/
   ```

#### Load Testing
```bash
# Send multiple test emails
for i in {1..10}; do
  # Send test email with different properties
  echo "Test $i" | mail -s "Test Report $i" dev@example.com
done
```

#### Parameter Testing
```bash
# Update parameter and verify cache refresh
aws ssm put-parameter \
  --name "/report-builder/development/email/recipients" \
  --value "dev-team@example.com" \
  --type SecureString \
  --overwrite

# Wait 30 seconds for cache to expire, then test
```

## Production Environment

### Configuration Location
```
infrastructure/config/environments/production.json
```

### Key Settings

```json
{
  "domain": {
    "domainName": "aws.example.com",
    "emailAddress": "test@example.com"
  },
  "storage": {
    "lifecycleTransitionDays": 90,
    "lifecycleArchiveDays": 365,
    "retentionDays": 2555
  },
  "lambda": {
    "timeout": 900,
    "memorySize": 1024,
    "reservedConcurrency": 100
  },
  "application": {
    "parameterStore": {
      "cacheTTLSeconds": 900
    }
  },
  "scheduling": {
    "dailyProcessingCron": "cron(0 18 * * ? *)",
    "weeklyReportingCron": "cron(0 8 ? * MON *)"
  }
}
```

### Production-Specific Features

#### Performance Optimization
- **Higher memory allocation** (1024MB) for better performance
- **Extended timeout** (15 minutes) for large file processing
- **Higher concurrency limit** (100) for peak loads
- **Longer cache TTL** (15 minutes) for efficiency

#### Business Alignment
- **Business hours processing** (6 PM daily, 8 AM Monday)
- **Long-term retention** (7 years as per business requirements)
- **Gradual archival** (90 days to IA, 1 year to Glacier)

#### Reliability Features
- **Enhanced monitoring** with CloudWatch dashboards
- **Automated alerting** for failures
- **Backup strategies** for critical data
- **Rollback procedures** for quick recovery

### Production Deployment

#### Prerequisites
1. **Clean git repository**:
   ```bash
   git status
   # Should show "working tree clean"
   ```

2. **All tests passing**:
   ```bash
   npm test
   npm run test:integration
   ```

3. **Security scan**:
   ```bash
   npm audit
   # Address any high/critical vulnerabilities
   ```

#### Deployment Process
```bash
# 1. Pre-flight check
./scripts/pre-deploy-check.sh

# 2. Deploy with manual approval
./scripts/deploy.sh --environment production

# 3. Verify deployment
aws cloudformation describe-stacks \
  --stack-name report-builder-production \
  --query 'Stacks[0].StackStatus'

# 4. Post-deployment testing
# Send test email and verify processing
```

#### Production Safeguards
- **Manual approval required** for CloudFormation changes
- **Rollback plan ready** before deployment
- **Monitoring dashboard** active during deployment
- **Team notification** of deployment status

### Production Monitoring

#### Key Metrics
- **Lambda duration** (should be < 30 seconds for email processing)
- **Error rate** (should be < 1%)
- **S3 storage growth** (monitor for unexpected increases)
- **Email processing volume** (track daily/weekly trends)

#### Alerting Thresholds
```bash
# CloudWatch alarms (set up via console or CDK)
- Lambda errors > 5 in 5 minutes
- Lambda duration > 60 seconds
- S3 PUT errors > 1 in 1 hour
- Parameter Store access errors > 3 in 5 minutes
```

#### Health Checks
```bash
# Daily health check script
#!/bin/bash
echo "Production Health Check - $(date)"

# Check stack status
aws cloudformation describe-stacks \
  --stack-name report-builder-production \
  --query 'Stacks[0].StackStatus'

# Check recent Lambda invocations
aws logs filter-log-events \
  --log-group-name "/aws/lambda/report-builder-production-EmailProcessor" \
  --start-time $(date -d "1 hour ago" +%s)000 \
  --filter-pattern "ERROR"

# Check S3 recent activity
aws s3api list-objects-v2 \
  --bucket report-builder-incoming-files-production \
  --prefix "daily-files/$(date +%Y-%m-%d)" \
  --query 'length(Contents)'
```

## Environment-Specific Parameter Store Configuration

### Development Parameters

```bash
# Property mappings (development)
aws ssm put-parameter \
  --name "/report-builder/development/config/property-mapping" \
  --value '{
    "property1-dev@example.com": "property-dev-1",
    "property2-dev@example.com": "property-dev-2",
    "test@example.com": "property-test-1"
  }' \
  --type SecureString

# Email configuration (development)
aws ssm put-parameter \
  --name "/report-builder/development/email/recipients" \
  --value "dev-team@example.com,qa-team@example.com" \
  --type SecureString

aws ssm put-parameter \
  --name "/report-builder/development/email/alert-notifications" \
  --value "dev-alerts@example.com" \
  --type SecureString
```

### Production Parameters

```bash
# Property mappings (production)
aws ssm put-parameter \
  --name "/report-builder/production/config/property-mapping" \
  --value '{
    "property1@example.com": "property-001",
    "property2@example.com": "property-002",
    "property3@example.com": "property-003"
  }' \
  --type SecureString

# Email configuration (production)
aws ssm put-parameter \
  --name "/report-builder/production/email/recipients" \
  --value "management@example.com,operations@example.com" \
  --type SecureString

aws ssm put-parameter \
  --name "/report-builder/production/email/alert-notifications" \
  --value "alerts@example.com,on-call@example.com" \
  --type SecureString
```

## Environment Migration

### Development to Production

1. **Test thoroughly in development**:
   ```bash
   # Run full test suite
   npm test
   npm run test:integration
   
   # Manual testing
   ./scripts/pre-deploy-check.sh
   ```

2. **Update production parameters**:
   ```bash
   # Review and update Parameter Store values
   # Ensure production email addresses are correct
   # Verify property mappings are accurate
   ```

3. **Deploy to production**:
   ```bash
   # Clean deployment
   git checkout main
   git pull origin main
   ./scripts/deploy.sh --environment production
   ```

4. **Verify production deployment**:
   ```bash
   # Check all services
   # Test email processing
   # Monitor for 24 hours
   ```

### Configuration Drift Prevention

#### Regular Audits
```bash
# Compare development and production configurations
diff \
  <(aws ssm get-parameters-by-path --path "/report-builder/development" --recursive --with-decryption) \
  <(aws ssm get-parameters-by-path --path "/report-builder/production" --recursive --with-decryption)
```

#### Infrastructure Drift
```bash
# Check for manual changes
cd infrastructure
cdk diff --context environment=production
```

#### Documentation Updates
- Keep environment documentation current
- Update parameter descriptions
- Document any manual configurations
- Maintain environment comparison matrix

## Troubleshooting Environment Issues

### Common Environment Problems

#### 1. Parameter Store Misconfigurations
```bash
# Symptoms: Email processing fails, unknown property mappings
# Solution: Verify parameter paths and values
aws ssm get-parameters-by-path \
  --path "/report-builder/$ENVIRONMENT" \
  --recursive \
  --with-decryption
```

#### 2. SES Domain Verification
```bash
# Symptoms: Email not received, SES bounce notifications
# Solution: Check domain verification status
aws ses get-identity-verification-attributes \
  --identities aws.example.com
```

#### 3. Lambda Timeout Issues
```bash
# Symptoms: Lambda timeouts in CloudWatch logs
# Solution: Check environment-specific timeout values
aws lambda get-function-configuration \
  --function-name report-builder-$ENVIRONMENT-EmailProcessor \
  --query 'Timeout'
```

#### 4. S3 Lifecycle Policy Conflicts
```bash
# Symptoms: Files archived too quickly, unexpected storage costs
# Solution: Review lifecycle rules
aws s3api get-bucket-lifecycle-configuration \
  --bucket report-builder-incoming-files-$ENVIRONMENT
```

### Environment Reset

#### Development Reset
```bash
# Complete development environment reset
aws cloudformation delete-stack \
  --stack-name report-builder-development

# Wait for deletion to complete, then redeploy
./scripts/deploy.sh --environment development
```

#### Production Recovery
```bash
# For production issues, use rollback instead of reset
./scripts/rollback.sh \
  --environment production \
  --version previous
```