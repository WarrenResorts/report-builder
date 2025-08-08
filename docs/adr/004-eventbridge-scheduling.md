# ADR-004: EventBridge for Task Scheduling

## Status
Accepted

## Context

The Report Builder system requires scheduled execution of batch processing tasks:

- **Daily file processing**: Aggregate and analyze received files at end of business day
- **Weekly reporting**: Generate comparative reports across time periods
- **Environment-specific schedules**: Different timing for development vs production
- **Flexible scheduling**: Business hours processing with timezone awareness
- **Event-driven architecture**: Integration with existing serverless workflow
- **Scalability**: Handle multiple properties with different schedules
- **Reliability**: Ensure scheduled tasks execute consistently

## Decision

We will use **Amazon EventBridge** with scheduled rules to trigger Lambda functions for batch processing tasks, replacing CloudWatch Events for enhanced functionality and future extensibility.

## Alternatives Considered

### 1. CloudWatch Events (Legacy)
- **Pros**: Simple setup, direct Lambda integration, familiar cron syntax
- **Cons**: Being replaced by EventBridge, limited event filtering, less flexible event routing

### 2. AWS Batch with CloudWatch Events
- **Pros**: Designed for batch processing, handles complex workflows, resource management
- **Cons**: Overkill for simple file processing, higher costs, container management overhead

### 3. Lambda with CloudWatch Alarms
- **Pros**: Simple trigger mechanism, cost-effective
- **Cons**: Limited scheduling flexibility, not designed for recurring tasks, alarm-based triggers inappropriate

### 4. External Cron Service (cron-job.org, etc.)
- **Pros**: Simple setup, familiar cron syntax, external monitoring
- **Cons**: External dependency, security concerns with public webhooks, limited integration

### 5. Step Functions with Scheduled Triggers
- **Pros**: Workflow orchestration, error handling, visual monitoring
- **Cons**: Added complexity for simple scheduling, higher costs, overkill for current needs

## Consequences

### Positive
- **Enhanced event routing**: More sophisticated event filtering and routing than CloudWatch Events
- **Custom event patterns**: Support for custom events beyond simple scheduling
- **Third-party integrations**: Native support for SaaS event sources (future extensibility)
- **Event replay**: Built-in event replay capabilities for debugging and recovery
- **Cost efficiency**: Pay-per-event model with generous free tier (14 million events/month)
- **Serverless integration**: Natural fit with Lambda-based architecture
- **Flexible scheduling**: Cron expressions with timezone support
- **Event archive**: Built-in event history and archiving capabilities

### Negative
- **Learning curve**: EventBridge concepts more complex than simple CloudWatch Events
- **Over-engineering**: May be excessive for simple cron scheduling needs
- **AWS lock-in**: Vendor-specific service with limited portability

### Neutral
- **Migration path**: Straightforward migration from CloudWatch Events when needed
- **Event schema**: Requires understanding of EventBridge event structure

## Implementation Notes

### Event Rules Configuration

```json
{
  "DailyProcessing": {
    "scheduleExpression": "cron(0 18 * * ? *)",  // 6 PM daily
    "description": "Trigger daily file processing",
    "target": "FileProcessorLambda"
  },
  "WeeklyReporting": {
    "scheduleExpression": "cron(0 8 ? * MON *)",  // 8 AM Mondays
    "description": "Generate weekly comparative reports",
    "target": "ReportGeneratorLambda"
  }
}
```

### Environment-Specific Scheduling
- **Development**: More frequent execution for testing (`cron(0 */2 * * ? *)` - every 2 hours)
- **Production**: Business-aligned schedules (`cron(0 18 * * ? *)` - end of business day)
- **Configuration**: Schedule expressions stored in Parameter Store for runtime flexibility

### Event Payload Structure
```json
{
  "version": "0",
  "id": "12345678-1234-1234-1234-123456789012",
  "detail-type": "Scheduled Event",
  "source": "aws.events",
  "account": "123456789012",
  "time": "2025-08-06T18:00:00Z",
  "region": "us-east-1",
  "detail": {
    "processingType": "daily-batch",
    "environment": "production",
    "timestamp": "2025-08-06T18:00:00Z"
  }
}
```

### Lambda Integration
- **Event filtering**: Lambda functions filter on `detail.processingType`
- **Error handling**: Built-in retry logic with dead letter queue support
- **Monitoring**: CloudWatch metrics for rule execution and failures
- **Logging**: Structured logging with correlation IDs for scheduled events

### Infrastructure as Code
- **CDK integration**: EventBridge rules defined in `EventsConstruct`
- **Environment configuration**: Rule schedules defined in environment config files
- **Parameter Store integration**: Schedule expressions stored as parameters for runtime updates
- **IAM permissions**: Least-privilege access for EventBridge to invoke Lambda functions

### Future Extensibility
- **Custom events**: Support for business-specific events (property-specific schedules)
- **Event-driven workflows**: Foundation for more complex event-driven architectures
- **Third-party integration**: Ready for SaaS webhook integrations
- **Event sourcing**: Potential foundation for event sourcing patterns

## References
- [Amazon EventBridge User Guide](https://docs.aws.amazon.com/eventbridge/latest/userguide/what-is-amazon-eventbridge.html)
- [EventBridge Scheduled Rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/scheduled-events.html)
- [EventBridge Pricing](https://aws.amazon.com/eventbridge/pricing/)
- [Migration from CloudWatch Events](https://docs.aws.amazon.com/eventbridge/latest/userguide/migrate-cwe-to-eb.html) 