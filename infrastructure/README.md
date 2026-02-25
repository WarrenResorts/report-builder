# Report Builder Infrastructure

This directory contains the AWS CDK infrastructure code for the Report Builder application using a **multi-account AWS strategy**.

## 🏗️ Multi-Account Architecture

The infrastructure deploys to separate AWS accounts for complete environment isolation:

- **Management Account** (316422224105): AWS Organizations only, no resources
- **Development Account** (237124340260): Development environment (`dev.example.com`)
- **Production Account** (400534944857): Production environment (`example.com`)

## 🔧 Infrastructure Components

### Core Services
- **AWS CDK**: Infrastructure as Code (TypeScript)
- **Amazon S3**: File storage with lifecycle policies
- **AWS Lambda**: Serverless email/file processing (Node.js 20.x)
- **Amazon SES**: Email receiving/sending with domain verification
- **Amazon EventBridge**: Scheduled batch processing
- **AWS Systems Manager**: Parameter Store for configuration
- **Amazon CloudWatch**: Logging and monitoring

### Account-Specific Resources
Each account has completely independent infrastructure:
- S3 buckets with environment-specific naming
- Lambda functions with separate IAM roles
- SES domains and receipt rules
- CloudWatch log groups
- EventBridge rules

## 🚀 Deployment Strategy

### Automated CI/CD (Recommended)
The infrastructure is deployed automatically via GitHub Actions:

**Development**: Auto-deploy on PR creation/updates
**Production**: Manual workflow dispatch

### Manual Deployment (Local)

#### Prerequisites
1. **AWS CLI configured** with OrganizationAccountAccessRole access
2. **CDK bootstrapped** in target accounts:
   ```bash
   # Development account
   npx cdk bootstrap aws://237124340260/us-east-1
   
   # Production account  
   npx cdk bootstrap aws://400534944857/us-east-1
   ```

#### Development Environment
```bash
# **IMPORTANT**: Run from project root, not infrastructure/ directory
cd /path/to/report-builder-1

# **CRITICAL**: Create Parameter Store parameters FIRST!
# See PARAMETER_STORE_SETUP.md for required parameters

# Assume role to Development account
aws sts assume-role --role-arn arn:aws:iam::237124340260:role/OrganizationAccountAccessRole --role-session-name DevDeploy

# Export credentials (from assume-role output)
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."

# Deploy to development (will fail if parameters don't exist)
npx cdk deploy --app "npx ts-node --prefer-ts-exts infrastructure/bin/infrastructure.ts" --context environment=development

# Destroy development resources
npx cdk destroy --app "npx ts-node --prefer-ts-exts infrastructure/bin/infrastructure.ts" --context environment=development
```

#### Production Environment
```bash
# **IMPORTANT**: Run from project root, not infrastructure/ directory
cd /path/to/report-builder-1

# **CRITICAL**: Create Parameter Store parameters FIRST!
# See PARAMETER_STORE_SETUP.md for required parameters

# Assume role to Production account
aws sts assume-role --role-arn arn:aws:iam::400534944857:role/OrganizationAccountAccessRole --role-session-name ProdDeploy

# Export credentials (from assume-role output)
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."

# Deploy to production
npx cdk deploy --app "npx ts-node --prefer-ts-exts infrastructure/bin/infrastructure.ts" --context environment=production

# Destroy production resources (use with extreme caution!)
npx cdk destroy --app "npx ts-node --prefer-ts-exts infrastructure/bin/infrastructure.ts" --context environment=production
```

## 🛠️ Development Commands

```bash
# **Run from project root directory**

# Compile TypeScript
npm run build

# Run tests
npm run test

# Compare deployed stack with current state
npx cdk diff --app "npx ts-node --prefer-ts-exts infrastructure/bin/infrastructure.ts" --context environment=development

# Synthesize CloudFormation template
npx cdk synth --app "npx ts-node --prefer-ts-exts infrastructure/bin/infrastructure.ts" --context environment=development
```

## 📦 Resources Created Per Account

### S3 Buckets
- `report-builder-incoming-files-{environment}-v2`: Raw emails and attachments
- `report-builder-processed-files-{environment}-v2`: Processed output files  
- `report-builder-mapping-files-{environment}-v2`: Excel mapping configurations

### Lambda Functions
- `report-builder-email-processor-{environment}`: Email parsing and attachment extraction
- `report-builder-file-processor-{environment}`: File transformation and report generation

### SES Configuration
- Domain identity: `dev.example.com` (dev) / `example.com` (prod)
- Receipt rule set: `report-builder-rules-{environment}`
- Configuration set: `report-builder-{environment}`

### IAM Roles & Policies
- Lambda execution roles with least-privilege permissions
- OIDC role for GitHub Actions CI/CD
- Cross-service permissions (Lambda ↔ S3, SES, Parameter Store)

### EventBridge Rules
- Daily file processing: Every 6 hours (dev) / Daily at 3 AM (prod)
- Weekly reports: Monday 12 PM (dev) / Sunday 6 AM (prod)

## ⚠️ Important Notes

### Account Isolation Benefits
- **No Resource Conflicts**: Complete separation between environments
- **Independent Scaling**: Each account has separate service quotas
- **Security Isolation**: Breaches contained to single environment
- **Cost Tracking**: Clear cost attribution per environment

### Critical Deployment Requirements
- **Project Root Execution**: CDK commands must run from project root (for `mailparser` dependency)
- **Account Context**: Always verify you're deploying to correct account
- **Bootstrap Once**: Each account only needs CDK bootstrap once
- **DNS Configuration**: Each domain requires separate DNS setup

### Rollback Strategy
- Development: Safe to destroy/recreate resources
- Production: Resources have `RETAIN` policy for data protection
- Manual rollback via CloudFormation console if needed

**🚨 Always verify the target account before deployment!**
