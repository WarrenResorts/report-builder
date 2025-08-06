# ADR-003: Parameter Store for Configuration Management

## Status
Accepted

## Context

The Report Builder system requires configuration management for:

- **Email mapping configuration**: Property ID mapping based on sender email addresses
- **Email notification settings**: Recipients for alerts and notifications  
- **Scheduling parameters**: Cron expressions for batch processing
- **Environment-specific settings**: Different values for development vs production
- **Security requirements**: Sensitive configuration data needs encryption
- **Runtime access**: Lambda functions need fast, cached access to configuration
- **Operational flexibility**: Configuration changes without code deployment

## Decision

We will use **AWS Systems Manager Parameter Store** for centralized configuration management, with SecureString parameters for sensitive data and standard parameters for non-sensitive settings.

## Alternatives Considered

### 1. Environment Variables Only
- **Pros**: Simple, built into Lambda, no additional AWS costs
- **Cons**: Limited to deployment-time configuration, no runtime updates, size limitations, no encryption for sensitive data

### 2. AWS AppConfig
- **Pros**: Feature flags, gradual rollouts, configuration validation, rollback capabilities
- **Cons**: More complex setup, higher costs for simple use case, overkill for current requirements

### 3. DynamoDB Configuration Table
- **Pros**: Fast access, flexible schema, familiar NoSQL patterns
- **Cons**: Requires table management, costs for low-volume access, no built-in encryption

### 4. S3 Configuration Files
- **Pros**: Version control, supports large configurations, low cost
- **Cons**: File management overhead, no atomic updates, requires additional security setup

### 5. AWS Secrets Manager
- **Pros**: Designed for secrets, automatic rotation, fine-grained access control
- **Cons**: Higher cost ($0.40 per secret per month), overkill for non-rotating configuration

## Consequences

### Positive
- **Cost efficiency**: Standard parameters free up to 10,000, SecureString parameters $0.05 per 10,000 API calls
- **Built-in encryption**: SecureString parameters encrypted with AWS KMS at rest
- **Hierarchical organization**: Path-based organization (`/report-builder/{environment}/config/*`)
- **IAM integration**: Fine-grained access control with least-privilege permissions
- **SDK support**: Native AWS SDK integration with automatic retries
- **Caching capability**: Client-side caching reduces API calls and improves performance
- **Version history**: Parameter Store maintains parameter history for auditing
- **Cross-service integration**: Works seamlessly with Lambda, CloudFormation, and other AWS services

### Negative
- **API call latency**: Network calls required for parameter retrieval (mitigated by caching)
- **Parameter size limits**: 4KB limit for standard parameters, 8KB for advanced parameters
- **Throughput limits**: 1,000 transactions per second per region (not a concern for our volume)
- **AWS dependency**: Vendor lock-in to AWS ecosystem

### Neutral
- **Learning curve**: Parameter Store concepts and hierarchical naming conventions
- **Cache management**: Need to implement appropriate cache TTL strategies

## Implementation Notes

### Parameter Organization

```
/report-builder/{environment}/
├── config/
│   ├── property-mapping        (SecureString) - Email to property ID mapping
│   └── processing-schedules    (String) - Cron expressions for batch jobs
├── email/
│   ├── recipients             (SecureString) - Alert notification recipients
│   ├── alert-notifications    (SecureString) - Error notification addresses
│   └── from-address          (SecureString) - Sender email for outbound messages
└── ses/
    └── configuration-set      (String) - SES configuration set name
```

### Security Configuration
- **SecureString parameters**: All sensitive data (emails, property mappings) encrypted with KMS
- **KMS permissions**: Lambda execution roles include `kms:Decrypt` permissions
- **Access control**: IAM policies restrict parameter access by environment and path
- **Encryption key**: Uses default AWS-managed KMS key (`alias/aws/ssm`)

### Caching Strategy
- **Development environment**: 30-second cache TTL for fast iteration
- **Production environment**: 15-minute cache TTL for efficiency
- **Cache implementation**: In-memory caching in ParameterStoreConfig class
- **Cache invalidation**: Automatic expiry based on configurable TTL

### Error Handling
- **Fallback values**: Default values for non-critical parameters
- **Retry logic**: Exponential backoff for Parameter Store API calls
- **Graceful degradation**: System continues operation with cached values during outages
- **Logging**: Structured logging for parameter retrieval operations

### Cost Optimization
- **Batch retrieval**: GetParameters API for multiple parameters in single call
- **Appropriate caching**: Environment-specific TTL reduces API call frequency
- **Standard vs Advanced**: Use standard parameters where 4KB limit is sufficient

## References
- [AWS Systems Manager Parameter Store User Guide](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [Parameter Store Pricing](https://aws.amazon.com/systems-manager/pricing/#Parameter_Store)
- [Parameter Store Best Practices](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-working-with.html)
- [Securing Parameter Store Parameters](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html) 