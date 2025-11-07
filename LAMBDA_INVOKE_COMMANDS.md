# Lambda Invocation Commands

## IMPORTANT: Always use these exact commands

### Dev Account Information
- **Account ID**: 237124340260
- **AWS Profile**: `dev-account`

### File Processor Lambda (Development)
```bash
export AWS_PROFILE=dev-account && aws lambda invoke --function-name report-builder-file-processor-development --cli-binary-format raw-in-base64-out --payload '{"source":"aws.events","detail-type":"Scheduled Event","detail":{"processingType":"daily-batch"}}' /tmp/lambda-response.json && cat /tmp/lambda-response.json | jq .
```

### CloudWatch Logs
```bash
aws logs tail /aws/lambda/report-builder-file-processor-development --since 5m --format short
```

### S3 Buckets
- **Incoming**: `report-builder-incoming-files-development-v2`
- **Processed**: `report-builder-processed-files-development-v2`
- **Mapping**: `report-builder-mapping-files-development-v2`

