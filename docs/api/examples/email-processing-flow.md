# Email Processing Flow Examples

## Overview

This document provides detailed examples of the email processing workflow, from receiving an email via SES to storing processed attachments in S3.

## Complete Processing Flow

### Step 1: Email Reception via SES

When an email is sent to `reports@aws.warrenresorthotels.com`, Amazon SES:

1. **Receives the email** and performs spam/virus scanning
2. **Stores raw email** in S3 bucket: `report-builder-incoming-files-{env}/raw-emails/{messageId}`
3. **Triggers Lambda** function with SES event

**Example SES Event:**
```json
{
  "Records": [
    {
      "eventSource": "aws:ses",
      "eventVersion": "1.0",
      "ses": {
        "mail": {
          "timestamp": "2024-01-15T10:30:00.000Z",
          "source": "property1@warrenresorthotels.com",
          "messageId": "0000014a-f4d4-4f89-b0d5-123456789abc",
          "destination": ["reports@aws.warrenresorthotels.com"],
          "commonHeaders": {
            "subject": "Daily Report - Property 1",
            "from": ["property1@warrenresorthotels.com"],
            "to": ["reports@aws.warrenresorthotels.com"]
          }
        },
        "receipt": {
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

### Step 2: Lambda Function Processing

The Email Processor Lambda function:

1. **Generates correlation ID** for tracking: `eproc-1705316400000-abc123def`
2. **Retrieves raw email** from S3 using the object key
3. **Parses email content** using the mailparser library
4. **Extracts attachments** and validates file types
5. **Maps sender to property** using Parameter Store configuration
6. **Stores attachments** in organized S3 structure
7. **Stores metadata** for processing audit trail

### Step 3: Property Identification

**Parameter Store Configuration:**
```json
{
  "property1@warrenresorthotels.com": "property-1",
  "property2@warrenresorthotels.com": "property-2",
  "accounting@warrenresorthotels.com": "corporate"
}
```

**Property Mapping Logic:**
- Known sender → Use mapped property ID
- Unknown sender → Use `unknown-property` fallback
- Log warning for unknown senders

### Step 4: Attachment Processing

**Supported File Types:**
- `*.pdf` → PDF documents
- `*.csv` → Comma-separated values
- `*.txt` → Plain text files
- `*.xlsx` → Modern Excel files
- `*.xls` → Legacy Excel files

**File Organization:**
```
daily-files/
├── property-1/
│   └── 2024-01-15/
│       ├── daily-report.pdf
│       └── transactions.csv
├── property-2/
│   └── 2024-01-15/
│       └── summary.xlsx
└── unknown-property/
    └── 2024-01-15/
        └── unidentified-file.pdf
```

### Step 5: Metadata Storage

**Email Metadata Example:**
```json
{
  "messageId": "0000014a-f4d4-4f89-b0d5-123456789abc",
  "correlationId": "eproc-1705316400000-abc123def",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "sender": "property1@warrenresorthotels.com",
  "subject": "Daily Report - Property 1",
  "propertyId": "property-1",
  "attachments": [
    {
      "filename": "daily-report.pdf",
      "contentType": "application/pdf",
      "size": 156789,
      "s3Key": "daily-files/property-1/2024-01-15/daily-report.pdf",
      "timestamp": "2024-01-15T10:30:15.000Z"
    }
  ],
  "processingDuration": 2340,
  "status": "completed"
}
```

**Metadata Storage Location:**
```
email-metadata/
└── 2024-01-15/
    └── 0000014a-f4d4-4f89-b0d5-123456789abc.json
```

## Example Processing Scenarios

### Scenario 1: Successful Processing with Multiple Attachments

**Input Email:**
- **From:** property1@warrenresorthotels.com
- **Subject:** Daily Reports - January 15
- **Attachments:** 
  - daily-report.pdf (156 KB)
  - transactions.csv (45 KB)
  - summary.xlsx (89 KB)

**Processing Steps:**
1. Email received at 10:30 AM
2. Correlation ID generated: `eproc-1705316400000-multi123`
3. Property mapped to: `property-1`
4. All 3 attachments valid and processed
5. Files stored in: `daily-files/property-1/2024-01-15/`

**Lambda Response:**
```json
{
  "statusCode": 200,
  "message": "Successfully processed 3 attachments from 1 email records",
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
    },
    {
      "filename": "summary.xlsx",
      "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "size": 89012,
      "s3Key": "daily-files/property-1/2024-01-15/summary.xlsx",
      "propertyId": "property-1"
    }
  ],
  "totalRecords": 1,
  "correlationId": "eproc-1705316400000-multi123",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Scenario 2: Unknown Sender with Fallback

**Input Email:**
- **From:** unknown@external-company.com
- **Subject:** Financial Data
- **Attachments:** report.pdf

**Processing Steps:**
1. Email received and parsed successfully
2. Correlation ID: `eproc-1705316400000-unknown456`
3. Property mapping not found → Use `unknown-property`
4. Warning logged for manual review
5. File stored in: `daily-files/unknown-property/2024-01-15/`

**Lambda Response:**
```json
{
  "statusCode": 200,
  "message": "Successfully processed 1 attachments from 1 email records",
  "processedAttachments": [
    {
      "filename": "report.pdf",
      "contentType": "application/pdf",
      "size": 123456,
      "s3Key": "daily-files/unknown-property/2024-01-15/report.pdf",
      "propertyId": "unknown-property"
    }
  ],
  "totalRecords": 1,
  "correlationId": "eproc-1705316400000-unknown456",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "warnings": [
    "Property mapping not found for unknown@external-company.com, using fallback"
  ]
}
```

### Scenario 3: Invalid Attachments Filtered

**Input Email:**
- **From:** property2@warrenresorthotels.com
- **Subject:** Mixed Files
- **Attachments:** 
  - report.pdf (valid)
  - photo.jpg (invalid)
  - virus.exe (invalid)
  - data.csv (valid)

**Processing Steps:**
1. Email parsed successfully
2. Property mapped to: `property-2`
3. 2 valid files processed, 2 invalid files skipped
4. Warning logged for skipped files

**Lambda Response:**
```json
{
  "statusCode": 200,
  "message": "Successfully processed 2 attachments from 1 email records",
  "processedAttachments": [
    {
      "filename": "report.pdf",
      "contentType": "application/pdf",
      "size": 145678,
      "s3Key": "daily-files/property-2/2024-01-15/report.pdf",
      "propertyId": "property-2"
    },
    {
      "filename": "data.csv",
      "contentType": "text/csv",
      "size": 34567,
      "s3Key": "daily-files/property-2/2024-01-15/data.csv",
      "propertyId": "property-2"
    }
  ],
  "totalRecords": 1,
  "correlationId": "eproc-1705316400000-filter789",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "skippedAttachments": 2,
  "warnings": [
    "Skipped attachment 'photo.jpg' - invalid file type",
    "Skipped attachment 'virus.exe' - invalid file type"
  ]
}
```

## Error Scenarios

### S3 Access Error

**Scenario:** Lambda cannot access S3 bucket due to permission issues

**Error Response:**
```json
{
  "statusCode": 500,
  "error": "EmailRetrievalError",
  "message": "Failed to retrieve email from S3: Access denied",
  "correlationId": "eproc-1705316400000-error123",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "context": {
    "messageId": "0000014a-f4d4-4f89-b0d5-123456789abc",
    "bucketName": "report-builder-incoming-files-dev",
    "objectKey": "raw-emails/0000014a-f4d4-4f89-b0d5-123456789abc",
    "operation": "email_retrieval"
  },
  "retryable": false
}
```

### Email Parsing Error

**Scenario:** Corrupted or malformed email content

**Error Response:**
```json
{
  "statusCode": 500,
  "error": "EmailParsingError",
  "message": "Failed to parse email content: Invalid email format",
  "correlationId": "eproc-1705316400000-parse567",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "context": {
    "messageId": "malformed-email-id",
    "operation": "email_parsing",
    "emailSize": 0
  },
  "retryable": false
}
```

## Monitoring and Debugging

### CloudWatch Logs

**Log Entry Example:**
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

### Correlation ID Tracking

Use correlation IDs to trace processing through CloudWatch:

1. **Search CloudWatch Logs** for correlation ID
2. **Filter by operation** (email_retrieval, attachment_processing, etc.)
3. **Review processing timeline** and identify bottlenecks
4. **Check error context** for debugging information

### Common Debugging Steps

1. **Check SES receipt rule** configuration
2. **Verify S3 bucket permissions** for Lambda role
3. **Review Parameter Store** property mappings
4. **Validate email format** and attachment types
5. **Monitor Lambda timeout** and memory usage

## Testing

### Local Testing Example

```typescript
import { handler } from '../src/lambda/email-processor';

const testEvent = {
  Records: [
    {
      eventSource: 'aws:ses',
      eventVersion: '1.0',
      ses: {
        mail: {
          messageId: 'test-message-id',
          source: 'property1@warrenresorthotels.com',
          commonHeaders: {
            subject: 'Test Email'
          }
        },
        receipt: {
          action: {
            type: 'S3',
            bucketName: 'test-bucket',
            objectKey: 'raw-emails/test-message-id'
          }
        }
      }
    }
  ]
};

// Mock AWS services and test
const result = await handler(testEvent, mockContext);
console.log('Processing result:', result);
``` 