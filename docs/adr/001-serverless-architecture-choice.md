# ADR-001: Serverless Architecture Choice

## Status
Accepted

## Context

The Report Builder system needs to process daily email reports from multiple hotel properties, extract attachments, and organize files for comparison analysis. The system has the following characteristics:

- **Unpredictable workload**: Email processing happens in batches, primarily during business hours
- **Batch processing nature**: Daily reports arrive in clusters, not continuous streams
- **Cost sensitivity**: Budget-conscious project requiring cost-effective solution
- **Maintenance overhead concerns**: Small team with limited operational capacity
- **Scalability requirements**: May need to handle 50+ properties in the future

## Decision

We will use a **serverless architecture** built on AWS Lambda, SES, S3, and EventBridge rather than traditional server-based solutions.

## Alternatives Considered

### 1. EC2-based Solution
- **Pros**: Full control, can handle any workload, familiar deployment patterns
- **Cons**: Fixed costs (~$50-100/month minimum), requires OS maintenance, scaling complexity, over-provisioning for batch workloads

### 2. Container-based Solution (ECS/Fargate)
- **Pros**: Good for consistent workloads, easy local development, microservices patterns
- **Cons**: Still requires capacity planning, minimum costs for always-running services, complexity for batch processing

### 3. Hybrid Approach (EC2 + Lambda)
- **Pros**: Can optimize for different workload patterns
- **Cons**: Increased complexity, multiple deployment pipelines, higher operational overhead

## Consequences

### Positive
- **Cost efficiency**: Pay-per-execution model perfect for batch processing (~$2-5/month vs $50-100/month)
- **Zero maintenance**: No OS patching, security updates, or server management
- **Automatic scaling**: Handles traffic spikes without capacity planning
- **High availability**: Built-in fault tolerance and multi-AZ deployment
- **Fast development**: Focus on business logic instead of infrastructure
- **Event-driven architecture**: Natural fit for email processing workflows

### Negative
- **Cold start latency**: 1-3 second delays for infrequent invocations (acceptable for batch processing)
- **Execution time limits**: 15-minute Lambda timeout requires chunking large operations
- **Vendor lock-in**: Tight coupling to AWS services
- **Local development complexity**: Requires mocking AWS services for testing
- **Debugging challenges**: Distributed system troubleshooting requires CloudWatch expertise

### Neutral
- **Learning curve**: Team needs AWS-specific knowledge (offset by comprehensive documentation)
- **Function size limits**: 50MB deployment package limit (manageable with current requirements)

## Implementation Notes

### Architecture Components
- **AWS Lambda**: Core processing functions (email processing, file processing)
- **Amazon SES**: Email reception and processing triggers
- **Amazon S3**: File storage with organized bucket structure
- **Amazon EventBridge**: Scheduling and event routing
- **AWS Systems Manager Parameter Store**: Configuration management
- **Amazon CloudWatch**: Logging and monitoring

### Design Patterns
- **Event-driven processing**: SES → Lambda → S3 workflow
- **Batch processing**: EventBridge scheduled triggers for daily operations
- **Configuration externalization**: Parameter Store for environment-specific settings
- **Error handling**: Structured error types with retry logic and dead letter queues

### Cost Optimization
- **Development environment**: Minimal resource allocation, short retention periods
- **Production environment**: Optimized for reliability and business schedules
- **Parameter Store caching**: Reduced API calls with environment-specific TTL
- **S3 lifecycle policies**: Automatic archival to reduce long-term storage costs

## References
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [AWS Well-Architected Serverless Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html)
- [Serverless Application Repository](https://aws.amazon.com/serverless/serverlessrepo/)
- [AWS Serverless Multi-Tier Architectures](https://docs.aws.amazon.com/whitepapers/latest/serverless-multi-tier-architectures-api-gateway-lambda/welcome.html) 