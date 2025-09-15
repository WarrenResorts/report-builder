# Dead Letter Queue (DLQ) Implementation

## Overview

The email processing Lambda function now includes a Dead Letter Queue (DLQ) to capture failed email processing attempts, providing better error handling and recovery capabilities.

## Architecture

```
SES Email → Lambda (3 attempts) → Success ✓
                ↓ (failure after retries)
            SQS DLQ → CloudWatch Alarm → Alert
```

## Components

### 1. SQS Dead Letter Queue
- **Name**: `report-builder-email-processor-dlq-{environment}`
- **Message Retention**: 14 days
- **Encryption**: SQS-managed encryption
- **Visibility Timeout**: 5 minutes

### 2. Lambda Configuration
- **Retry Attempts**: 2 (total of 3 attempts: initial + 2 retries)
- **DLQ Integration**: Automatic message routing on failure
- **Asynchronous Invocation**: SES invokes Lambda asynchronously

### 3. SNS Alert Topic
- **Name**: `report-builder-email-processor-dlq-alerts-{environment}`
- **Purpose**: Sends notifications when emails fail processing
- **Subscriptions**: Email and Slack notifications (configured post-deployment)
- **Encryption**: AWS managed encryption

### 4. CloudWatch Alarm
- **Name**: `report-builder-email-processor-dlq-alarm-{environment}`
- **Metric**: `ApproximateNumberOfVisibleMessages`
- **Threshold**: ≥ 1 message
- **Evaluation**: Immediate (1 period)
- **Actions**: Sends notifications to SNS topic

## Error Flow

1. **SES receives email** → Stores in S3 → Invokes Lambda
2. **Lambda fails** → AWS runtime retries (2 additional attempts)
3. **All retries fail** → Message sent to DLQ
4. **DLQ receives message** → CloudWatch alarm triggers
5. **SNS topic activated** → Email and Slack notifications sent
6. **Operations team alerted** → Manual investigation begins

## Message Format in DLQ

When a Lambda invocation fails, the DLQ receives a message containing:

```json
{
  "version": "1.0",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "requestContext": {
    "requestId": "12345678-1234-1234-1234-123456789012",
    "functionName": "report-builder-email-processor-development",
    "condition": "RetriesExhausted",
    "approximateInvokeCount": 3
  },
  "requestPayload": {
    "Records": [
      {
        "eventSource": "aws:ses",
        "ses": {
          "mail": {
            "messageId": "failed-email-id",
            "source": "sender@example.com"
          }
        }
      }
    ]
  },
  "responseContext": {
    "statusCode": 200,
    "executedVersion": "$LATEST"
  },
  "responsePayload": {
    "errorMessage": "EmailRetrievalError: Failed to retrieve email from S3",
    "errorType": "EmailRetrievalError",
    "stackTrace": [...]
  }
}
```

## Monitoring and Alerts

### CloudWatch Metrics
- **Queue Depth**: `AWS/SQS/ApproximateNumberOfVisibleMessages`
- **Message Age**: `AWS/SQS/ApproximateAgeOfOldestMessage`
- **Lambda Errors**: `AWS/Lambda/Errors`

### Recommended Dashboards
1. **DLQ Messages Over Time**
2. **Lambda Error Rate**
3. **Email Processing Success Rate**
4. **Average Processing Duration**

## Recovery Procedures

### 1. Investigate Failed Messages

```bash
# List messages in DLQ
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url \
    --queue-name report-builder-email-processor-dlq-development \
    --query 'QueueUrl' --output text) \
  --max-number-of-messages 10

# Get detailed message content
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --message-attribute-names All \
  --attribute-names All
```

### 2. Analyze Root Cause

Common failure scenarios:
- **S3 Access Issues**: Check IAM permissions
- **Parameter Store Errors**: Verify parameter existence
- **Parsing Failures**: Examine email format
- **Timeout Issues**: Check Lambda timeout settings

### 3. Reprocess Messages

After fixing the root cause:

```bash
# Redrive messages from DLQ back to Lambda
aws sqs redrive-messages \
  --source-queue-url $DLQ_URL \
  --destination-queue-url $LAMBDA_QUEUE_URL
```

Or manually trigger Lambda with the original SES event:

```bash
# Extract original payload and reinvoke Lambda
aws lambda invoke \
  --function-name report-builder-email-processor-development \
  --payload file://failed-event.json \
  response.json
```

## Cost Impact

### SQS Costs
- **Requests**: $0.40 per million requests
- **Storage**: $0.40 per GB-month
- **Expected Monthly Cost**: ~$0.05 (assuming minimal failures)

### CloudWatch Costs
- **Metrics**: $0.30 per metric per month
- **Alarms**: $0.10 per alarm per month
- **Expected Monthly Cost**: ~$0.40

**Total Additional Cost**: ~$0.45/month per environment

## Best Practices

### 1. Message Handling
- Set appropriate visibility timeout
- Use exponential backoff for reprocessing
- Implement idempotent processing logic

### 2. Monitoring
- Set up SNS notifications for DLQ alarms
- Monitor DLQ message age
- Track error patterns and trends

### 3. Recovery
- Automate common recovery scenarios
- Document investigation procedures
- Test recovery processes regularly

## Configuration

### Environment Variables
```bash
# Lambda automatically receives these
LAMBDA_DLQ_ARN="arn:aws:sqs:region:account:report-builder-email-processor-dlq-env"
```

### CloudFormation Outputs
```yaml
EmailProcessorDLQArn:
  Description: "ARN of the email processor Dead Letter Queue"
  Export:
    Name: "ReportBuilderStack-{environment}-EmailProcessorDLQArn"

EmailProcessorDLQUrl:
  Description: "URL of the email processor Dead Letter Queue"
  Export:
    Name: "ReportBuilderStack-{environment}-EmailProcessorDLQUrl"
```

## Testing

### Simulate Failure
```typescript
// Force Lambda timeout for testing
export const handler = async (event: SESEvent) => {
  if (process.env.TEST_DLQ === 'true') {
    await new Promise(resolve => setTimeout(resolve, 300000)); // 5 min timeout
  }
  // Normal processing...
};
```

### Verify DLQ Integration
1. Deploy with test flag enabled
2. Send test email
3. Verify message appears in DLQ
4. Confirm CloudWatch alarm triggers
5. Test message recovery process

## Related Documentation

- [SNS Alert Setup Guide](../operations/sns-alert-setup.md)
- [Error Handling Strategy](./error-handling.md)
- [Lambda Function Configuration](./lambda-functions.md)
- [Monitoring and Alerting](./monitoring.md)
- [Operational Runbooks](../operations/runbooks.md)
