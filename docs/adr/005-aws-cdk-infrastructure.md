# ADR-005: AWS CDK for Infrastructure as Code

## Status
Accepted

## Context

The Report Builder system requires Infrastructure as Code (IaC) for:

- **Consistent deployments**: Identical infrastructure across development and production
- **Version control**: Infrastructure changes tracked alongside application code
- **Environment management**: Parameterized deployments for different environments
- **Team collaboration**: Shareable and reviewable infrastructure definitions
- **AWS service integration**: Native support for AWS services and best practices
- **Type safety**: Catch configuration errors at development time
- **Maintenance efficiency**: Automated resource management and updates

## Decision

We will use **AWS CDK (Cloud Development Kit)** v2 with TypeScript for defining and deploying all AWS infrastructure components.

## Alternatives Considered

### 1. AWS CloudFormation (Raw YAML/JSON)
- **Pros**: Native AWS support, mature ecosystem, detailed documentation
- **Cons**: Verbose syntax, limited reusability, no compile-time validation, steep learning curve

### 2. Terraform by HashiCorp
- **Pros**: Multi-cloud support, mature state management, large community, HCL syntax
- **Cons**: Additional tool complexity, third-party dependency, state management overhead, AWS service lag

### 3. AWS SAM (Serverless Application Model)
- **Pros**: Serverless-focused, simpler syntax for Lambda/API Gateway, good local testing
- **Cons**: Limited to serverless resources, less flexible than full IaC solutions, CloudFormation limitations

### 4. Pulumi
- **Pros**: Multiple language support, good abstractions, familiar programming patterns
- **Cons**: Newer tool, smaller community, additional learning curve, subscription pricing for teams

### 5. Manual AWS Console/CLI
- **Pros**: Direct control, immediate feedback, familiar interface
- **Cons**: No version control, error-prone, inconsistent deployments, no automation

## Consequences

### Positive
- **Type safety**: TypeScript provides compile-time error checking and IntelliSense
- **Code reusability**: Object-oriented patterns enable reusable constructs
- **AWS best practices**: CDK constructs implement AWS recommended configurations
- **Familiar syntax**: TypeScript familiarity reduces learning curve for developers
- **Native AWS integration**: First-party tool with immediate support for new AWS services
- **Powerful abstractions**: High-level constructs simplify complex configurations
- **Testing capabilities**: Unit testing infrastructure code with familiar JavaScript testing frameworks
- **IDE integration**: Full IDE support with autocompletion and error detection

### Negative
- **AWS vendor lock-in**: CDK is AWS-specific, limits multi-cloud strategies
- **Learning curve**: CDK concepts and patterns require initial investment
- **Compilation step**: TypeScript compilation adds step to deployment process
- **Rapid evolution**: CDK v2 is newer with occasional breaking changes
- **Generated CloudFormation**: Debugging requires understanding generated templates

### Neutral
- **Bootstrap requirement**: One-time CDK bootstrap process per account/region
- **Build dependencies**: Node.js and npm required for development environment

## Implementation Notes

### Project Structure
```
infrastructure/
├── bin/
│   └── infrastructure.ts      # CDK app entry point
├── lib/
│   ├── infrastructure-stack.ts # Main stack definition
│   └── constructs/            # Reusable construct library
│       ├── storage-construct.ts
│       ├── ses-construct.ts
│       ├── lambda-construct.ts
│       └── events-construct.ts
├── config/                    # Environment-specific configuration
├── test/                      # Infrastructure unit tests
└── cdk.json                   # CDK configuration
```

### Construct Design Principles
- **Single responsibility**: Each construct manages one logical AWS service group
- **Environment awareness**: Constructs accept environment configuration
- **Least privilege**: IAM policies follow principle of least privilege
- **Resource naming**: Consistent naming patterns across all resources
- **Tagging strategy**: Standardized tags for cost allocation and management

### Environment Management
```typescript
// Development deployment
npx cdk deploy --context environment=development

// Production deployment  
npx cdk deploy --context environment=production
```

### Key CDK Features Utilized
- **Constructs**: Reusable infrastructure components (L1, L2, L3)
- **Aspects**: Cross-cutting concerns (tagging, security)
- **Context**: Environment-specific configuration
- **Outputs**: Cross-stack references and deployment information
- **IAM policies**: Type-safe policy definitions

### Resource Organization
- **StorageConstruct**: S3 buckets, lifecycle policies, bucket policies
- **SESConstruct**: Domain identity, configuration sets, receipt rules
- **LambdaConstruct**: Lambda functions, IAM roles, environment variables
- **EventsConstruct**: EventBridge rules, Parameter Store definitions

### Security Implementation
- **IAM roles**: Separate roles for each Lambda function with minimal permissions
- **Resource ARNs**: Specific resource targeting instead of wildcard permissions
- **KMS integration**: Automatic encryption key management for SecureString parameters
- **VPC options**: Infrastructure ready for VPC deployment if required

### Testing Strategy
- **Unit tests**: Test construct creation and property validation
- **Integration tests**: Validate deployed resources match expectations
- **Snapshot tests**: Detect unexpected CloudFormation template changes
- **Synthesis validation**: Ensure clean CDK synthesis without errors

## References
- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/v2/guide/)
- [CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/v2/typescript/)
- [CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [CDK Constructs Library](https://constructs.dev/) 