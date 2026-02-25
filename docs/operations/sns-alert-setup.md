# SNS Alert Setup for DLQ Notifications

## Overview

The Dead Letter Queue (DLQ) system includes an SNS topic that sends notifications when emails fail processing. This guide shows how to set up email and Slack notifications after deployment.

## SNS Topic Details

**Topic Name**: `report-builder-email-processor-dlq-alerts-{environment}`
**Topic ARN**: Available in CloudFormation outputs after deployment

## Setting Up Email Notifications

### 1. Subscribe Email Address via AWS Console

1. **Navigate to SNS Console**: `console.aws.amazon.com/sns`
2. **Find the Topic**: `report-builder-email-processor-dlq-alerts-development`
3. **Create Subscription**:
   - Protocol: `Email`
   - Endpoint: Your email address (e.g., `ops@yourcompany.com`)
4. **Confirm Subscription**: Check email and click confirmation link

### 2. Subscribe Email Address via AWS CLI

```bash
# Get the topic ARN from CloudFormation outputs
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name ReportBuilderStack-development \
  --query 'Stacks[0].Outputs[?OutputKey==`EmailProcessorDLQAlertTopicArn`].OutputValue' \
  --output text)

# Subscribe your email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint ops@yourcompany.com

# Confirm subscription (check your email)
```

## Setting Up Slack Notifications

### Option 1: Slack Webhook (Recommended)

1. **Create Slack Webhook**:
   - Go to your Slack workspace settings
   - Navigate to "Incoming Webhooks"
   - Create webhook for your alerts channel
   - Copy the webhook URL

2. **Subscribe Webhook to SNS**:
```bash
# Subscribe Slack webhook
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol https \
  --notification-endpoint https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### Option 2: AWS Chatbot (Enterprise)

1. **Set up AWS Chatbot** in the AWS Console
2. **Connect to Slack workspace**
3. **Configure SNS topic** to send to Slack channel
4. **Customize message formatting** for better readability

## Notification Message Format

### Email Notification Example
```
Subject: ALARM: "report-builder-email-processor-dlq-alarm-development" in US East (N. Virginia)

AlarmName: report-builder-email-processor-dlq-alarm-development
AlarmDescription: Alert when emails fail processing and are sent to DLQ
AWSAccountId: 123456789012
NewStateValue: ALARM
NewStateReason: Threshold Crossed: 1 out of the last 1 datapoints [1.0 (12/09/25 19:15:00)] was greater than or equal to the threshold (1.0).
StateChangeTime: 2025-09-12T19:15:32.804+0000
Region: US East (N. Virginia)
AlarmArn: arn:aws:cloudwatch:us-east-1:123456789012:alarm:report-builder-email-processor-dlq-alarm-development
OldStateValue: OK
Trigger: MetricName: ApproximateNumberOfVisibleMessages
```

### Slack Notification (Raw)
The raw SNS message will appear in Slack. For better formatting, consider using a Lambda function to transform the message.

## Custom Message Formatting (Optional)

### Lambda Function for Slack Formatting

Create a Lambda function that:
1. Receives SNS notifications
2. Formats them for Slack
3. Posts to Slack webhook

```typescript
// Example Lambda function for Slack formatting
export const handler = async (event: SNSEvent) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message);
    
    const slackMessage = {
      text: "🚨 Email Processing Alert",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${message.AlarmName}*\n${message.NewStateReason}`
          }
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Environment:*\n${message.AlarmName.includes('development') ? 'Development' : 'Production'}`
            },
            {
              type: "mrkdwn", 
              text: `*Status:*\n${message.NewStateValue}`
            }
          ]
        }
      ]
    };

    // Post to Slack webhook
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage)
    });
  }
};
```

## Testing Notifications

### 1. Test SNS Topic Directly
```bash
# Send test message to SNS topic
aws sns publish \
  --topic-arn $TOPIC_ARN \
  --message "Test notification - please ignore" \
  --subject "DLQ Alert Test"
```

### 2. Trigger DLQ Alarm
```bash
# Send a message directly to the DLQ to trigger the alarm
aws sqs send-message \
  --queue-url $(aws sqs get-queue-url \
    --queue-name report-builder-email-processor-dlq-development \
    --query 'QueueUrl' --output text) \
  --message-body "Test DLQ message"
```

### 3. Simulate Email Processing Failure
- Send an email with invalid attachment format
- Check that it appears in DLQ and triggers notifications

## Subscription Management

### List Current Subscriptions
```bash
aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN
```

### Unsubscribe
```bash
aws sns unsubscribe --subscription-arn <subscription-arn>
```

### Update Subscription Attributes
```bash
# Set delivery policy for retries
aws sns set-subscription-attributes \
  --subscription-arn <subscription-arn> \
  --attribute-name DeliveryPolicy \
  --attribute-value '{"healthyRetryPolicy":{"numRetries":3,"backoffFunction":"exponential"}}'
```

## Monitoring Subscription Health

### CloudWatch Metrics for SNS
- `NumberOfNotificationsFailed`
- `NumberOfNotificationsDelivered`
- `NumberOfNotificationsFilteredOut`

### Set Up Subscription Failure Alerts
```bash
# Create alarm for failed notifications
aws cloudwatch put-metric-alarm \
  --alarm-name "sns-dlq-alerts-delivery-failures" \
  --alarm-description "Alert when SNS notifications fail to deliver" \
  --metric-name NumberOfNotificationsFailed \
  --namespace AWS/SNS \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1
```

## Cost Optimization

### Reduce Notification Costs
1. **Use email over SMS** (email is much cheaper)
2. **Batch notifications** if you expect high failure rates
3. **Set up delivery policies** to avoid retry storms
4. **Monitor subscription costs** in AWS Billing

### Expected Costs
- **Email notifications**: $0.50 per million notifications
- **HTTPS notifications**: $0.60 per million notifications  
- **SMS notifications**: $0.75 per message (not recommended)

## Troubleshooting

### Common Issues

1. **Email notifications not received**:
   - Check spam folder
   - Verify subscription is confirmed
   - Check SNS topic permissions

2. **Slack notifications not working**:
   - Verify webhook URL is correct
   - Check webhook permissions in Slack
   - Test webhook directly with curl

3. **Too many notifications**:
   - Review alarm threshold settings
   - Consider batching or filtering
   - Check for alarm flapping

### Debug Commands
```bash
# Check SNS topic attributes
aws sns get-topic-attributes --topic-arn $TOPIC_ARN

# Check subscription status
aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN

# View CloudWatch logs for SNS
aws logs filter-log-events \
  --log-group-name /aws/sns/us-east-1/123456789012/report-builder-email-processor-dlq-alerts-development
```

## Security Considerations

1. **Topic Access**: Only authorized personnel should subscribe
2. **Webhook Security**: Use HTTPS webhooks only
3. **Message Content**: May contain sensitive error information
4. **Subscription Confirmation**: Always confirm subscriptions manually

## Related Documentation

- [Dead Letter Queue Implementation](../architecture/dead-letter-queue.md)
- [CloudWatch Monitoring](../monitoring/cloudwatch-setup.md)
- [Incident Response Procedures](./incident-response.md)
