# Deployment Guide

This guide provides comprehensive instructions for deploying the Report Builder application to AWS.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Deployment Environments](#deployment-environments)
- [Step-by-Step Deployment](#step-by-step-deployment)
- [Automated Scripts](#automated-scripts)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)
- [Post-Deployment](#post-deployment)

## Prerequisites

### System Requirements

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **AWS CLI** - [Installation guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- **AWS CDK CLI** - Install with `npm install -g aws-cdk`
- **Git** - For version control

### AWS Requirements

- AWS Account with appropriate permissions
- AWS CLI configured with credentials
- CDK bootstrap completed in target region

### Required AWS Permissions

Your AWS user/role needs the following permissions:
- CloudFormation (full access)
- S3 (full access)
- Lambda (full access)
- SES (full access)
- EventBridge (full access)
- IAM (create/update roles and policies)
- Systems Manager Parameter Store (full access)
- KMS (decrypt for SecureString parameters)

## Quick Start

### 1. Pre-flight Check

Run the pre-deployment validation script:

```bash
./scripts/pre-deploy-check.sh
```

This script validates:
- System requirements
- AWS configuration
- Project structure
- Dependencies
- Build status
- Tests
- Security checks

### 2. Deploy to Development

```bash
./scripts/deploy.sh --environment development
```

### 3. Deploy to Production

```bash
./scripts/deploy.sh --environment production
```

## Deployment Environments

### Development Environment

- **Purpose**: Testing and development
- **Resources**: Minimal configuration for cost optimization
- **Data retention**: 30 days
- **Monitoring**: Basic CloudWatch logs
- **Cost**: ~$2-5/month

### Production Environment

- **Purpose**: Live business operations
- **Resources**: Optimized for reliability and performance
- **Data retention**: 7 years (business requirement)
- **Monitoring**: Enhanced metrics and alerting
- **Cost**: ~$5-15/month (depending on volume)

## Step-by-Step Deployment

### Step 1: Environment Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd report-builder
   ```

2. **Install dependencies**:
   ```bash
   npm install
   cd infrastructure
   npm install
   cd ..
   ```

3. **Configure AWS credentials**:
   ```bash
   aws configure
   # OR
   export AWS_PROFILE=your-profile
   ```

### Step 2: Parameter Store Configuration

Before deploying, you need to configure AWS Systems Manager Parameter Store with your specific values.

1. **Follow the Parameter Store setup guide**:
   ```bash
   cat PARAMETER_STORE_SETUP.md
   ```

2. **Set required parameters**:
   - Email property mappings
   - SES configuration
   - Alert notification addresses

### Step 3: Infrastructure Deployment

1. **Bootstrap CDK** (first time only):
   ```bash
   cd infrastructure
   cdk bootstrap
   cd ..
   ```

2. **Deploy infrastructure**:
   ```bash
   # Development
   ./scripts/deploy.sh --environment development
   
   # Production
   ./scripts/deploy.sh --environment production
   ```

### Step 4: Verification

1. **Check deployment status**:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name report-builder-development \
     --query 'Stacks[0].StackStatus'
   ```

2. **Verify resources**:
   - S3 buckets created
   - Lambda functions deployed
   - SES domain identity verified
   - EventBridge rules configured

3. **Test email processing**:
   - Send a test email to your configured address
   - Check CloudWatch logs for processing
   - Verify files appear in S3

## Automated Scripts

### Deployment Script

**Location**: `scripts/deploy.sh`

**Features**:
- Multi-environment support
- Pre-deployment validation
- Automated testing
- CDK bootstrapping
- Post-deployment verification

**Usage**:
```bash
./scripts/deploy.sh [OPTIONS]

Options:
  -e, --environment ENVIRONMENT    Target environment (development|production)
  -r, --region REGION             AWS region (default: us-east-1)
  -s, --skip-tests               Skip running tests
  -b, --skip-build               Skip building application
  -v, --verbose                  Enable verbose output
  -d, --dry-run                  Show what would be deployed
  -h, --help                     Show help message
```

**Examples**:
```bash
# Development deployment
./scripts/deploy.sh --environment development

# Production with verbose output
./scripts/deploy.sh -e production -v

# Dry run to see changes
./scripts/deploy.sh -e development --dry-run
```

### Pre-deployment Check

**Location**: `scripts/pre-deploy-check.sh`

**Purpose**: Validates system readiness before deployment

**Checks**:
- System requirements (Node.js, AWS CLI, CDK)
- AWS configuration and permissions
- Project structure and dependencies
- Git repository status
- Build and test status
- Security vulnerabilities

**Usage**:
```bash
./scripts/pre-deploy-check.sh
```

### Rollback Script

**Location**: `scripts/rollback.sh`

**Purpose**: Rollback to a previous deployment version

**Features**:
- Git-based version management
- Safe rollback with confirmations
- Backup before rollback
- Verification after rollback

**Usage**:
```bash
./scripts/rollback.sh [OPTIONS]

Options:
  -e, --environment ENVIRONMENT    Target environment
  -v, --version VERSION           Version to rollback to
  -r, --region REGION             AWS region
  -d, --dry-run                   Show rollback plan
  -f, --force                     Skip confirmation
```

**Examples**:
```bash
# Rollback to previous version
./scripts/rollback.sh -e development -v previous

# Rollback to specific version
./scripts/rollback.sh -e production -v v1.2.3

# Dry run rollback
./scripts/rollback.sh -e development -v previous --dry-run
```

## Rollback Procedures

### When to Rollback

- Critical bugs in production
- Performance degradation
- Failed deployment
- Security issues

### Rollback Steps

1. **Identify the issue**:
   - Check CloudWatch logs
   - Monitor error rates
   - Verify functionality

2. **Determine target version**:
   - `previous` - Last known good version
   - `v1.2.3` - Specific version tag
   - `latest-stable` - Latest stable release

3. **Execute rollback**:
   ```bash
   ./scripts/rollback.sh \
     --environment production \
     --version previous
   ```

4. **Verify rollback**:
   - Check application functionality
   - Monitor logs and metrics
   - Test critical workflows

### Emergency Rollback

For critical production issues:

```bash
./scripts/rollback.sh \
  --environment production \
  --version previous \
  --force
```

## Troubleshooting

### Common Issues

#### 1. CDK Bootstrap Errors

**Error**: "Need to perform AWS CDK bootstrap"

**Solution**:
```bash
cd infrastructure
cdk bootstrap
```

#### 2. AWS Credentials Issues

**Error**: "Unable to locate credentials"

**Solutions**:
```bash
# Option 1: Configure AWS CLI
aws configure

# Option 2: Use environment variables
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret

# Option 3: Use AWS profile
export AWS_PROFILE=your-profile
```

#### 3. Parameter Store Access Denied

**Error**: "Access denied to Parameter Store"

**Solution**: Ensure your AWS user/role has `ssm:GetParameter` and `kms:Decrypt` permissions.

#### 4. Stack Update Failures

**Error**: "Stack is in UPDATE_ROLLBACK_COMPLETE state"

**Solution**:
```bash
# Continue update rollback
aws cloudformation continue-update-rollback \
  --stack-name report-builder-development

# Or delete and redeploy
aws cloudformation delete-stack \
  --stack-name report-builder-development
```

#### 5. SES Domain Verification

**Error**: "Domain identity not verified"

**Solution**:
1. Check SES console for verification status
2. Add required DNS records to your domain
3. Wait for verification (can take up to 72 hours)

### Debugging Commands

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name report-builder-development

# View stack events
aws cloudformation describe-stack-events \
  --stack-name report-builder-development

# Check Lambda logs
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/report-builder"

# Test Lambda function
aws lambda invoke \
  --function-name report-builder-development-EmailProcessor \
  --payload '{}' \
  response.json
```

## Post-Deployment

### 1. Verify Deployment

- [ ] All CloudFormation stacks deployed successfully
- [ ] Lambda functions are active
- [ ] S3 buckets created with correct permissions
- [ ] SES domain identity verified
- [ ] EventBridge rules configured
- [ ] Parameter Store values set

### 2. Test Functionality

- [ ] Send test email to configured address
- [ ] Verify email processing in CloudWatch logs
- [ ] Check S3 for processed files
- [ ] Test scheduled batch processing
- [ ] Verify error handling

### 3. Monitor and Maintain

- [ ] Set up CloudWatch dashboards
- [ ] Configure alerting thresholds
- [ ] Review costs in AWS Cost Explorer
- [ ] Schedule regular health checks
- [ ] Plan for parameter updates

### 4. Documentation

- [ ] Update deployment notes
- [ ] Document any environment-specific configurations
- [ ] Share access information with team
- [ ] Update runbooks and procedures

## Security Considerations

### 1. Access Control

- Use IAM roles with least privilege
- Enable CloudTrail for audit logs
- Rotate AWS access keys regularly
- Use temporary credentials when possible

### 2. Data Protection

- All S3 buckets have encryption enabled
- Parameter Store uses SecureString for sensitive data
- Email data is automatically archived
- Access logs are maintained

### 3. Network Security

- Lambda functions run in AWS managed VPCs
- Security groups restrict access
- API endpoints use HTTPS only
- No public internet access required

## Cost Management

### Development Environment
- **Lambda**: ~$0.50/month (low usage)
- **S3**: ~$1.00/month (30-day retention)
- **SES**: ~$0.10/month (minimal emails)
- **Other**: ~$0.50/month
- **Total**: ~$2-3/month

### Production Environment
- **Lambda**: ~$2-5/month (business usage)
- **S3**: ~$3-8/month (7-year retention)
- **SES**: ~$0.50/month (regular emails)
- **EventBridge**: ~$0.10/month
- **Parameter Store**: ~$0.05/month
- **Total**: ~$6-15/month

### Cost Optimization

- Use S3 lifecycle policies for automatic archival
- Monitor Lambda execution duration
- Implement Parameter Store caching
- Regular cleanup of test data
- Use development environment for testing

## Support and Resources

### Documentation
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [SES Developer Guide](https://docs.aws.amazon.com/ses/latest/dg/)

### Monitoring
- CloudWatch Console: AWS Console → CloudWatch
- Application logs: `/aws/lambda/report-builder-*` log groups
- Stack events: CloudFormation Console

### Getting Help
1. Check the troubleshooting section above
2. Review CloudWatch logs for error details
3. Consult AWS documentation
4. Contact the development team