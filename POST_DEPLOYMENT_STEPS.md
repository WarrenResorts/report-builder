# Required Manual Steps After Deployment

This guide covers the manual steps required after deploying the Report Builder infrastructure using the **multi-account AWS strategy**.

## 🏗️ Multi-Account Architecture

The system uses separate AWS accounts for complete environment isolation:
- **Development Account**: 237124340260 (`dev.example.com`)
- **Production Account**: 400534944857 (`example.com`)

## 🔧 Account Setup Prerequisites

### 1. AWS Organizations Structure
Ensure your AWS Organizations is set up correctly:
```
Root (Management Account: 316422224105)
├── Development Account (237124340260)
└── Production Account (400534944857)
```

### 2. OIDC Roles for GitHub Actions
Each account needs an OIDC role for secure CI/CD:

**Development Account Role**: `arn:aws:iam::237124340260:role/GitHubActionsOIDCRole`
**Production Account Role**: `arn:aws:iam::400534944857:role/GitHubActionsOIDCRole`

## 📧 Email Configuration

### Development Environment (`dev.example.com`)

#### DNS Setup (GoDaddy)
Add these DNS records for the development subdomain:

**MX Record:**
```
Type: MX
Name: dev
Value: 10 inbound-smtp.us-east-1.amazonaws.com
```

**CNAME Records for DKIM Verification:**
Check AWS SES Console → Domains → `dev.example.com` → DKIM for the 3 CNAME records to add.

#### Parameter Store Update
```bash
# Switch to Development account
aws sts assume-role --role-arn arn:aws:iam::237124340260:role/OrganizationAccountAccessRole --role-session-name DevSetup

# Update email parameter
aws ssm put-parameter \
  --name "/report-builder/development/email/incoming-address" \
  --value "dev@dev.example.com" \
  --overwrite
```

### Production Environment (`example.com`)

#### DNS Setup (Existing)
The production subdomain should already be configured from previous setup.

#### Parameter Store Update
```bash
# Switch to Production account  
aws sts assume-role --role-arn arn:aws:iam::400534944857:role/OrganizationAccountAccessRole --role-session-name ProdSetup

# Update email parameter
aws ssm put-parameter \
  --name "/report-builder/production/email/incoming-address" \
  --value "reports@example.com" \
  --overwrite
```

## 🔐 Security Configuration

### Convert Parameters to SecureString (Production Only)
For production security, convert sensitive parameters to SecureString:

```bash
# Email recipients
aws ssm put-parameter \
  --name "/report-builder/production/email/recipients" \
  --value "user1@example.com,user2@example.com" \
  --type "SecureString" \
  --overwrite

# Alert notifications
aws ssm put-parameter \
  --name "/report-builder/production/email/alert-notifications" \
  --value "alerts@example.com" \
  --type "SecureString" \
  --overwrite

# Property mapping (JSON)
aws ssm put-parameter \
  --name "/report-builder/production/config/property-mapping" \
  --value '{"sender@property1.com":"PROP001","sender@property2.com":"PROP002"}' \
  --type "SecureString" \
  --overwrite
```

## ✅ Verification Steps

### 1. Account Authentication
Verify you can access both accounts:
```bash
# Development
aws sts assume-role --role-arn arn:aws:iam::237124340260:role/OrganizationAccountAccessRole --role-session-name Test
aws sts get-caller-identity

# Production  
aws sts assume-role --role-arn arn:aws:iam::400534944857:role/OrganizationAccountAccessRole --role-session-name Test
aws sts get-caller-identity
```

### 2. SES Domain Verification
Check domain verification status in each account:
```bash
# Development account
aws ses get-identity-verification-attributes --identities dev.example.com

# Production account
aws ses get-identity-verification-attributes --identities example.com
```

### 3. Parameter Store Values
Verify parameters were updated correctly:
```bash
# Development
aws ssm get-parameter --name "/report-builder/development/email/incoming-address"

# Production
aws ssm get-parameter --name "/report-builder/production/email/incoming-address"
```

### 4. Test Email Processing
Send test emails to verify end-to-end processing:

**Development**: Send email with attachment to `dev@dev.example.com`
**Production**: Send email with attachment to `reports@example.com`

Check CloudWatch logs and S3 buckets to verify processing.

## 🚨 Important Notes

- **No Shared Resources**: Each account has completely independent infrastructure
- **CDK Bootstrap**: Each account needs CDK bootstrap (`npx cdk bootstrap aws://ACCOUNT-ID/us-east-1`)  
- **DNS Propagation**: Allow time for DNS changes to propagate globally
- **DKIM Verification**: May take time for AWS to verify domain ownership

**⚠️ Both environments can process emails simultaneously without conflicts due to account isolation!**
