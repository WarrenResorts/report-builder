# Required Manual Steps After Deployment

## Critical: Update Email Addresses in Parameter Store

After the infrastructure deploys successfully, you **MUST** update the placeholder email addresses with your real ones:

### Development Environment
```bash
aws ssm put-parameter \
  --name "/report-builder/development/email/incoming-address" \
  --value "your-dev-email@yourdomain.com" \
  --overwrite
```

### Production Environment  
```bash
aws ssm put-parameter \
  --name "/report-builder/production/email/incoming-address" \
  --value "your-prod-email@yourdomain.com" \
  --overwrite
```

## Why This Is Required

1. **Security**: Real email addresses cannot be hardcoded in public repositories
2. **CDK creates parameters with placeholder values**: `dev@example.com` and `test@example.com`
3. **SES receipt rules use these parameters**: Email routing won't work until updated with real addresses

## Verification

After updating the parameters, verify they were set correctly:

```bash
# Check development
aws ssm get-parameter --name "/report-builder/development/email/incoming-address"

# Check production  
aws ssm get-parameter --name "/report-builder/production/email/incoming-address"
```

## Other Manual Steps

1. **DNS Configuration**: Ensure MX record points to AWS SES
2. **Domain Verification**: Check SES console for domain verification status
3. **Test Email**: Send test email to verify end-to-end processing

**⚠️ WARNING: Email processing will NOT work until these parameters are updated with real email addresses!**
