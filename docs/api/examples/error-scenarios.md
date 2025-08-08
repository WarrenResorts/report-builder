# Error Scenarios and Troubleshooting

## Common Error Types

### 1. Email Retrieval Errors

**Cause**: Issues accessing raw email content from S3
**Common Reasons**:
- IAM permission issues
- S3 bucket doesn't exist
- Object key not found
- Network connectivity issues

**Example Error**:
```json
{
  "statusCode": 500,
  "error": "EmailRetrievalError",
  "message": "Failed to retrieve email from S3: Access denied",
  "correlationId": "eproc-1705316400000-error123",
  "context": {
    "bucketName": "report-builder-incoming-files-dev",
    "objectKey": "raw-emails/missing-email-id"
  }
}
```

**Troubleshooting Steps**:
1. Check Lambda execution role permissions
2. Verify S3 bucket exists and is accessible
3. Confirm object key format matches SES configuration
4. Review CloudWatch logs for detailed error messages

### 2. Email Parsing Errors

**Cause**: Malformed or corrupted email content
**Common Reasons**:
- Corrupted email files
- Unsupported email formats
- Missing email headers
- Binary content issues

**Example Error**:
```json
{
  "statusCode": 500,
  "error": "EmailParsingError",
  "message": "Failed to parse email content: Invalid email format",
  "correlationId": "eproc-1705316400000-parse567",
  "context": {
    "messageId": "corrupted-email-id",
    "emailSize": 0
  }
}
```

**Troubleshooting Steps**:
1. Check raw email content in S3
2. Validate email format and headers
3. Test with known good email samples
4. Review mailparser library logs

### 3. Attachment Processing Errors

**Cause**: Issues processing email attachments
**Common Reasons**:
- Unsupported file types
- Corrupted attachments
- File size limits exceeded
- Filename sanitization issues

**Example Error**:
```json
{
  "statusCode": 500,
  "error": "AttachmentProcessingError",
  "message": "Failed to process attachment: File size exceeds limit",
  "correlationId": "eproc-1705316400000-attach890",
  "context": {
    "filename": "huge-file.pdf",
    "contentType": "application/pdf",
    "attachmentIndex": 2
  }
}
```

**Troubleshooting Steps**:
1. Check file types against supported list
2. Verify file sizes are within limits
3. Test attachment extraction manually
4. Review filename sanitization logic

### 4. S3 Storage Errors

**Cause**: Issues storing processed files in S3
**Common Reasons**:
- IAM permission issues
- S3 bucket quota exceeded
- Invalid object key names
- Network timeouts

**Example Error**:
```json
{
  "statusCode": 500,
  "error": "S3StorageError",
  "message": "Failed to store file in S3: Access denied",
  "correlationId": "eproc-1705316400000-s3err456",
  "context": {
    "bucketName": "report-builder-incoming-files-dev",
    "key": "daily-files/property-1/invalid/key",
    "operation": "put"
  }
}
```

**Troubleshooting Steps**:
1. Verify IAM permissions for PutObject
2. Check S3 bucket policies
3. Validate object key format
4. Monitor S3 service health

## Debugging Workflow

### Step 1: Identify Error Type
1. Check Lambda response status code
2. Review error message and type
3. Examine correlation ID for tracking
4. Look at error context for specifics

### Step 2: Review CloudWatch Logs
```bash
# Search by correlation ID
aws logs filter-log-events \
  --log-group-name "/aws/lambda/report-builder-email-processor-dev" \
  --filter-pattern "eproc-1705316400000-error123"

# Search by error type
aws logs filter-log-events \
  --log-group-name "/aws/lambda/report-builder-email-processor-dev" \
  --filter-pattern "EmailRetrievalError"
```

### Step 3: Check AWS Service Status
1. Verify S3 service availability
2. Check SES service status
3. Monitor Lambda service health
4. Review Parameter Store accessibility

### Step 4: Validate Configuration
1. Check Parameter Store values
2. Verify IAM role permissions
3. Confirm environment variables
4. Test S3 bucket accessibility

## Recovery Procedures

### Automatic Retry
The system implements automatic retry for transient errors:
- **S3 Operations**: 3 retries with exponential backoff
- **Parameter Store**: 3 retries with exponential backoff
- **Non-retryable**: Access denied, invalid format errors

### Manual Recovery
For failed emails that require manual intervention:

1. **Access Raw Email**:
```bash
aws s3 cp s3://report-builder-incoming-files-dev/raw-emails/failed-message-id ./failed-email.eml
```

2. **Inspect Email Content**:
```bash
# Check email headers and structure
cat failed-email.eml | head -50
```

3. **Reprocess Manually**:
```typescript
// Extract attachments manually
const emailContent = fs.readFileSync('./failed-email.eml');
const parsed = await simpleParser(emailContent);
// Process attachments...
```

### Dead Letter Queue (Future)
Failed events will be sent to DLQ for analysis:
- Review failed event details
- Identify root cause
- Implement fixes
- Replay events if needed

## Prevention Strategies

### Input Validation
- Validate email format before processing
- Check attachment types and sizes
- Sanitize filenames and paths
- Verify sender mapping exists

### Error Handling
- Implement graceful degradation
- Log detailed error context
- Use correlation IDs for tracking
- Provide meaningful error messages

### Monitoring
- Set up CloudWatch alarms
- Monitor error rates and patterns
- Track processing latency
- Alert on critical failures

### Testing
- Regular integration testing
- Error injection testing
- Load testing with various email formats
- Monitoring dashboard validation 