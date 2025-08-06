# Architecture Decision Records (ADRs)

## Overview

This directory contains Architecture Decision Records (ADRs) for the Report Builder project. ADRs document important architectural decisions, including the context, options considered, and rationale behind each choice.

## ADR Format

Each ADR follows a consistent format:

- **Title**: Short noun phrase describing the decision
- **Status**: Proposed, Accepted, Deprecated, or Superseded
- **Context**: The situation that motivates the decision
- **Decision**: The chosen solution
- **Consequences**: The positive and negative outcomes of the decision

## Index of Decisions

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](./001-serverless-architecture-choice.md) | Serverless Architecture Choice | Accepted | 2025-08-06 |
| [ADR-002](./002-aws-ses-for-email-processing.md) | AWS SES for Email Processing | Accepted | 2025-08-06 |
| [ADR-003](./003-parameter-store-configuration.md) | Parameter Store for Configuration | Accepted | 2025-08-06 |
| [ADR-004](./004-eventbridge-scheduling.md) | EventBridge for Task Scheduling | Accepted | 2025-08-06 |
| [ADR-005](./005-aws-cdk-infrastructure.md) | AWS CDK for Infrastructure as Code | Accepted | 2025-08-06 |
| [ADR-006](./006-s3-file-organization.md) | S3 File Organization Strategy | Accepted | 2025-08-06 |
| [ADR-007](./007-typescript-language-choice.md) | TypeScript as Primary Language | Accepted | 2025-08-06 |
| [ADR-008](./008-vitest-testing-framework.md) | Vitest as Testing Framework | Accepted | 2025-08-06 |

## Contributing

When making significant architectural decisions:

1. Create a new ADR using the next sequential number
2. Follow the established format and structure
3. Include context, alternatives considered, and trade-offs
4. Update this README index
5. Get team review before marking as "Accepted"

## Template

Use this template for new ADRs:

```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Context
[Describe the situation that motivates this decision]

## Decision
[Describe the chosen solution]

## Alternatives Considered
[List other options that were evaluated]

## Consequences
### Positive
- [Benefit 1]
- [Benefit 2]

### Negative
- [Cost/limitation 1]
- [Cost/limitation 2]

### Neutral
- [Impact that is neither clearly positive nor negative]

## Implementation Notes
[Any specific implementation guidance or requirements]

## References
- [Links to relevant documentation, discussions, or resources]
``` 