# Lambda Invocation Commands

## IMPORTANT: Always use these exact commands

### Dev Account Information
- **Account ID**: 237124340260
- **AWS Profile**: `dev-account`

### File Processor Lambda (Development)

**Process last 24 hours (default daily behavior):**
```bash
export AWS_PROFILE=dev-account && aws lambda invoke --function-name report-builder-file-processor-development --cli-binary-format raw-in-base64-out --payload '{"source":"aws.events","detail-type":"Scheduled Event","detail":{"processingType":"daily-batch"}}' /tmp/lambda-response.json && cat /tmp/lambda-response.json | jq .
```

**Reprocess a specific date (useful for bug fixes or missed days):**
```bash
export AWS_PROFILE=dev-account && aws lambda invoke --function-name report-builder-file-processor-development --cli-binary-format raw-in-base64-out --payload '{"source":"aws.events","detail-type":"Scheduled Event","detail":{"processingType":"daily-batch","targetDate":"2026-01-12"}}' /tmp/lambda-response.json && cat /tmp/lambda-response.json | jq .
```
> Replace `2026-01-12` with the date you want to reprocess (YYYY-MM-DD format)

**Resend email for existing reports (skip processing, just email):**
```bash
export AWS_PROFILE=dev-account && aws lambda invoke --function-name report-builder-file-processor-development --cli-binary-format raw-in-base64-out --payload '{"source":"aws.events","detail-type":"Scheduled Event","detail":{"processingType":"daily-batch","targetDate":"2026-01-13","resendEmail":true}}' /tmp/lambda-response.json && cat /tmp/lambda-response.json | jq .
```
> Replace `2026-01-13` with the business date of the reports you want to resend. Requires reports to already exist in S3.

### CloudWatch Logs
```bash
aws logs tail /aws/lambda/report-builder-file-processor-development --since 5m --format short
```

### S3 Buckets
- **Incoming**: `report-builder-incoming-files-development-v2`
- **Processed**: `report-builder-processed-files-development-v2`
- **Mapping**: `report-builder-mapping-files-development-v2`

