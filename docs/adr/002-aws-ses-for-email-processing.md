# ADR-002: AWS SES for Email Processing

## Status
Accepted

## Context

The Report Builder system requires automated processing of incoming emails with attachments from hotel properties. Key requirements include:

- **Reliable email reception**: Must not lose any incoming reports
- **Attachment extraction**: Need to process PDF, CSV, TXT, and Excel files
- **Integration with processing pipeline**: Seamless handoff to Lambda functions
- **Cost effectiveness**: Budget-conscious solution for moderate email volume
- **Compliance**: Proper handling of business communications
- **Domain management**: Professional email handling for business domain

## Decision

We will use **AWS Simple Email Service (SES)** for receiving and processing incoming emails, with SES receipt rules triggering Lambda functions for processing.

## Alternatives Considered

### 1. Third-party Email Service (SendGrid, Mailgun, etc.)
- **Pros**: Feature-rich APIs, easier integration, built-in email parsing
- **Cons**: Additional vendor dependency, monthly fees ($10-50/month), data transfer costs, external API calls required

### 2. IMAP/POP3 Polling
- **Pros**: Works with any email provider, familiar email protocols
- **Cons**: Polling overhead, missed emails during downtime, complex attachment handling, requires persistent connection management

### 3. Email Forwarding to External Webhook
- **Pros**: Simple setup, works with existing email infrastructure
- **Cons**: Security concerns with public webhooks, additional infrastructure required, limited attachment size handling

### 4. Microsoft Graph API (Office 365)
- **Pros**: Enterprise-grade, excellent Office integration
- **Cons**: Requires Office 365 subscription, complex authentication, overkill for simple email processing

## Consequences

### Positive
- **AWS ecosystem integration**: Native integration with Lambda, S3, and other AWS services
- **Cost efficiency**: Pay-per-email model (~$0.10 per 1,000 emails) vs fixed monthly fees
- **Reliability**: AWS-managed infrastructure with high availability
- **Automatic scaling**: Handles email volume spikes without configuration
- **Built-in security**: DKIM, SPF, DMARC support for email authentication
- **S3 integration**: Direct email storage to S3 buckets
- **Lambda triggers**: Immediate processing without polling
- **Domain verification**: Professional business email handling

### Negative
- **AWS vendor lock-in**: Tight coupling to AWS ecosystem
- **Learning curve**: SES-specific configuration and troubleshooting
- **Regional limitations**: SES not available in all AWS regions
- **Bounce/complaint handling**: Requires additional setup for production
- **Domain reputation management**: Responsibility for maintaining sending reputation

### Neutral
- **Email size limits**: 40MB limit manageable for typical business attachments
- **Configuration complexity**: Receipt rules setup requires understanding of SES concepts
- **Sandbox mode**: Initial limitation requiring AWS support request for production use

## Implementation Notes

### SES Configuration
- **Domain identity**: Verified `example.com` for receiving emails
- **Receipt rules**: Configured to store raw emails in S3 and trigger Lambda
- **Configuration set**: Environment-specific settings for tracking and reputation management
- **IAM permissions**: Least-privilege access for Lambda functions to SES resources

### Email Processing Flow
1. **Email reception**: SES receives email at configured address
2. **S3 storage**: Raw email stored in `incoming-files` bucket with metadata
3. **Lambda trigger**: SES triggers EmailProcessor Lambda function
4. **Attachment extraction**: Lambda uses `mailparser` to extract attachments
5. **File organization**: Attachments stored in organized S3 structure
6. **Metadata storage**: Email metadata stored as JSON for audit trail

### Security Considerations
- **Domain verification**: DNS records verify domain ownership
- **Encrypted storage**: SecureString parameters for sensitive email configuration
- **Access control**: IAM policies restrict SES operations to specific resources
- **Email authentication**: DKIM signatures for sender verification

### Cost Analysis
- **Receiving emails**: $0.10 per 1,000 emails received
- **S3 storage**: Standard rates for email and attachment storage
- **Lambda execution**: Pay-per-invocation for processing
- **Total estimated cost**: ~$1-2/month for typical hotel report volume

## References
- [AWS SES Developer Guide](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html)
- [SES Email Receiving](https://docs.aws.amazon.com/ses/latest/dg/receiving-email.html)
- [SES Receipt Rules](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules.html)
- [Email Authentication Best Practices](https://docs.aws.amazon.com/ses/latest/dg/email-authentication.html) 