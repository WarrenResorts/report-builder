# Email Processor Lambda API

## Overview

The Email Processor Lambda function is triggered by Amazon SES when emails are received. It processes email content, extracts attachments, and organizes files in S3 for further processing.

## Function Details

- **Function Name**: `report-builder-email-processor-{environment}`
- **Runtime**: Node.js 20.x
- **Memory**: 384 MB (development), 512 MB (production)
- **Timeout**: 5 minutes (development), 3 minutes (production)
- **Trigger**: Amazon SES email events

## Input Interface

### Event Structure

The function receives SES email events with the following structure:

```typescript
interface SESEvent {
  Records: SESRecord[];
}

interface SESRecord {
  eventSource: 'aws:ses';
  eventVersion: '1.0';
  ses: {
    mail: {
      timestamp: string;
      source: string;
      messageId: string;
      destination: string[];
      headersTruncated: boolean;
      headers: Array<{
        name: string;
        value: string;
      }>;
      commonHeaders: {
        from: string[];
        to: string[];
        cc?: string[];
        bcc?: string[];
        sender?: string[];
        replyTo?: string[];
        returnPath: string;
        messageId: string;
        date: string;
        subject: string;
      };
    };
    receipt: {
      timestamp: string;
      processingTimeMillis: number;
      recipients: string[];
      spamVerdict: SESVerdict;
      virusVerdict: SESVerdict;
      spfVerdict: SESVerdict;
      dkimVerdict: SESVerdict;
      dmarcVerdict: SESVerdict;
      action: {
        type: 'S3' | 'Lambda' | 'SNS' | 'Bounce' | 'Stop';
        bucketName?: string;
        objectKey?: string;
        functionArn?: string;
        topicArn?: string;
      };
    };
  };
}

interface SESVerdict {
  status: 'PASS' | 'FAIL' | 'GRAY' | 'PROCESSING_FAILED';
}
```

### Example Event

```json
{
  "Records": [
    {
      "eventSource": "aws:ses",
      "eventVersion": "1.0",
      "ses": {
        "mail": {
          "timestamp": "2024-01-15T10:30:00.000Z",
          "source": "property1@example.com",
          "messageId": "0000014a-f4d4-4f89-b0d5-123456789abc",
          "destination": ["test@example.com"],
          "headersTruncated": false,
          "headers": [
            {"name": "From", "value": "property1@example.com"},
            {"name": "To", "value": "test@example.com"},
            {"name": "Subject", "value": "Daily Report - Property 1"}
          ],
          "commonHeaders": {
            "from": ["property1@example.com"],
            "to": ["test@example.com"],
            "subject": "Daily Report - Property 1",
            "date": "Mon, 15 Jan 2024 10:30:00 +0000",
            "messageId": "0000014a-f4d4-4f89-b0d5-123456789abc"
          }
        },
        "receipt": {
          "timestamp": "2024-01-15T10:30:00.000Z",
          "processingTimeMillis": 150,
          "recipients": ["test@example.com"],
          "spamVerdict": {"status": "PASS"},
          "virusVerdict": {"status": "PASS"},
          "spfVerdict": {"status": "PASS"},
          "dkimVerdict": {"status": "PASS"},
          "dmarcVerdict": {"status": "PASS"},
          "action": {
            "type": "S3",
            "bucketName": "report-builder-incoming-files-dev",
            "objectKey": "raw-emails/0000014a-f4d4-4f89-b0d5-123456789abc"
          }
        }
      }
    }
  ]
}
```

## Output Interface

### Success Response

```typescript
interface EmailProcessorResult {
  statusCode: 200;
  message: string;
  processedAttachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    s3Key: string;
    propertyId: string;
  }>;
  totalRecords: number;
  correlationId: string;
  timestamp: string;
}
```

### Example Success Response

```json
{
  "statusCode": 200,
  "message": "Successfully processed 2 attachments from 1 email records",
  "processedAttachments": [
    {
      "filename": "daily-report.pdf",
      "contentType": "application/pdf",
      "size": 156789,
      "s3Key": "daily-files/property-1/2024-01-15/daily-report.pdf",
      "propertyId": "property-1"
    },
    {
      "filename": "transactions.csv",
      "contentType": "text/csv",
      "size": 45231,
      "s3Key": "daily-files/property-1/2024-01-15/transactions.csv",
      "propertyId": "property-1"
    }
  ],
  "totalRecords": 1,
  "correlationId": "eproc-1705316400000-abc123def",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Processing Flow

### 1. Event Reception
- Receives SES event with email metadata
- Generates correlation ID for request tracking
- Logs invocation with structured logging

### 2. Email Retrieval
- Retrieves raw email content from S3 using the object key from SES
- Implements retry logic with exponential backoff
- Validates email content exists

### 3. Email Parsing
- Parses email content using `mailparser` library
- Extracts sender, recipients, subject, and attachments
- Handles various email formats (text, HTML, multipart)

### 4. Property Identification
- Maps sender email to property ID using Parameter Store
- Falls back to `unknown-property` if mapping not found
- Caches property mappings for performance

### 5. Attachment Processing
- Validates attachment types (PDF, CSV, TXT, XLSX, XLS)
- Sanitizes filenames for S3 storage
- Stores attachments in organized S3 structure: `daily-files/{propertyId}/{date}/{filename}`

### 6. Metadata Storage
- Stores email metadata in S3: `email-metadata/{date}/{messageId}.json`
- Includes processing results and attachment information

## Error Handling

### Error Types

The function can throw the following error types:

#### 1. EmailRetrievalError
```typescript
{
  name: "EmailRetrievalError",
  message: "Failed to retrieve email from S3: {reason}",
  correlationId: string,
  context: {
    bucketName: string,
    objectKey: string,
    messageId: string
  }
}
```

#### 2. EmailParsingError
```typescript
{
  name: "EmailParsingError", 
  message: "Failed to parse email content: {reason}",
  correlationId: string,
  context: {
    messageId: string,
    emailSize: number
  }
}
```

#### 3. AttachmentProcessingError
```typescript
{
  name: "AttachmentProcessingError",
  message: "Failed to process attachment: {reason}",
  correlationId: string,
  context: {
    filename: string,
    contentType: string,
    attachmentIndex: number
  }
}
```

#### 4. S3StorageError
```typescript
{
  name: "S3StorageError",
  message: "Failed to store file in S3: {reason}",
  correlationId: string,
  context: {
    bucketName: string,
    key: string,
    operation: 'put' | 'get'
  }
}
```

### Retry Behavior

- **S3 Operations**: 3 retries with exponential backoff (1s, 2s, 4s)
- **Parameter Store**: 3 retries with exponential backoff
- **Non-retryable errors**: Access denied, invalid credentials
- **Retryable errors**: Network timeouts, throttling, temporary failures

## Supported File Types

| Extension | MIME Type | Description |
|-----------|-----------|-------------|
| `.pdf` | `application/pdf` | PDF documents |
| `.csv` | `text/csv` | Comma-separated values |
| `.txt` | `text/plain` | Plain text files |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Excel (modern) |
| `.xls` | `application/vnd.ms-excel` | Excel (legacy) |

## Environment Configuration

### Required Environment Variables

- `INCOMING_FILES_BUCKET`: S3 bucket for storing processed attachments
- `PROCESSED_FILES_BUCKET`: S3 bucket for final processed files  
- `MAPPING_FILES_BUCKET`: S3 bucket for mapping files
- `PARAMETER_STORE_CACHE_TTL_SECONDS`: Cache TTL for Parameter Store (30s dev, 900s prod)

### Parameter Store Configuration

The function requires the following parameters in Parameter Store:

- `/report-builder/{env}/config/property-mapping`: JSON mapping of email addresses to property IDs
- `/report-builder/{env}/email/recipients`: List of report recipients
- `/report-builder/{env}/email/alert-notifications`: Alert notification email
- `/report-builder/{env}/email/from-address`: From email address for outbound emails

## IAM Permissions

### Required Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::report-builder-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/report-builder/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": [
        "arn:aws:kms:*:*:key/alias/aws/ssm"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream", 
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## Monitoring & Logging

### CloudWatch Metrics

Custom metrics published:
- `EmailsProcessed`: Number of emails processed
- `AttachmentsExtracted`: Number of attachments extracted
- `ProcessingErrors`: Number of processing errors
- `ProcessingDuration`: Time taken to process emails

### Log Format

All logs are structured JSON with correlation IDs:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "service": "EmailProcessor",
  "message": "Email processing completed successfully",
  "correlationId": "eproc-1705316400000-abc123def",
  "messageId": "0000014a-f4d4-4f89-b0d5-123456789abc",
  "attachmentCount": 2,
  "operation": "email_processing_complete"
}
```

## Testing

### Unit Tests
```bash
# Run email processor tests
npm test -- src/lambda/email-processor.test.ts
```

### Integration Tests
```bash
# Run integration tests
npm run test:integration
```

### Local Testing

```typescript
import { handler } from '../src/lambda/email-processor';

const testEvent = {
  Records: [/* SES event structure */]
};

const result = await handler(testEvent, mockContext);
console.log(result);
``` 