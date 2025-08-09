# Local Testing Guide

## Overview

This guide provides instructions for testing Lambda functions locally during development, including mocking AWS services and creating test data.

## Prerequisites

### Development Dependencies
```bash
npm install --save-dev
# Already includes vitest, aws-sdk-client-mock, etc.
```

### AWS CLI Configuration
```bash
# Configure AWS credentials for local testing
aws configure
# OR use environment variables
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_REGION=us-east-1
```

## Testing Email Processor Lambda

### Basic Unit Testing

```typescript
// test/email-processor.local.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handler } from '../src/lambda/email-processor';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Mock AWS clients
const s3Mock = mockClient(S3Client);
const ssmMock = mockClient(SSMClient);

describe('Email Processor Local Testing', () => {
  beforeEach(() => {
    s3Mock.reset();
    ssmMock.reset();
    
    // Mock environment variables
    process.env.INCOMING_FILES_BUCKET = 'test-incoming-bucket';
    process.env.NODE_ENV = 'test';
  });

  it('should process email with PDF attachment', async () => {
    // Mock S3 email retrieval
    const mockEmailContent = Buffer.from(`
From: property1@example.com
To: test@example.com
Subject: Test Email
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain

Test email body

--boundary123
Content-Type: application/pdf
Content-Disposition: attachment; filename="test-report.pdf"

%PDF-1.4 fake pdf content
--boundary123--
    `);

    s3Mock.on(GetObjectCommand).resolves({
      Body: {
        transformToByteArray: () => Promise.resolve(mockEmailContent)
      }
    });

    // Mock property mapping
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: {
        Value: JSON.stringify({
          "property1@example.com": "property-1"
        })
      }
    });

    // Mock S3 uploads
    s3Mock.on(PutObjectCommand).resolves({});

    // Create test SES event
    const testEvent = {
      Records: [
        {
          eventSource: 'aws:ses',
          eventVersion: '1.0',
          ses: {
            mail: {
              messageId: 'test-message-123',
              source: 'property1@example.com',
              timestamp: '2024-01-15T10:30:00.000Z',
              destination: ['test@example.com'],
              commonHeaders: {
                subject: 'Test Email',
                from: ['property1@example.com'],
                to: ['test@example.com']
              }
            },
            receipt: {
              timestamp: '2024-01-15T10:30:00.000Z',
              processingTimeMillis: 150,
              recipients: ['test@example.com'],
              spamVerdict: { status: 'PASS' },
              virusVerdict: { status: 'PASS' },
              spfVerdict: { status: 'PASS' },
              dkimVerdict: { status: 'PASS' },
              dmarcVerdict: { status: 'PASS' },
              action: {
                type: 'S3',
                bucketName: 'test-incoming-bucket',
                objectKey: 'raw-emails/test-message-123'
              }
            }
          }
        }
      ]
    };

    // Create mock Lambda context
    const mockContext = {
      awsRequestId: 'test-request-123',
      functionName: 'test-function',
      getRemainingTimeInMillis: () => 30000
    };

    // Execute handler
    const result = await handler(testEvent, mockContext);

    // Assertions
    expect(result.statusCode).toBe(200);
    expect(result.processedAttachments).toHaveLength(1);
    expect(result.processedAttachments[0].filename).toBe('test-report.pdf');
    expect(result.processedAttachments[0].propertyId).toBe('property-1');
  });
});
```

### Integration Testing with LocalStack

```bash
# Install LocalStack
pip install localstack

# Start LocalStack with required services
localstack start -d

# Configure AWS CLI for LocalStack
export AWS_ENDPOINT_URL=http://localhost:4566
```

```typescript
// test/email-processor.integration.test.ts
import AWS from 'aws-sdk';

// Configure AWS SDK for LocalStack
AWS.config.update({
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  accessKeyId: 'test',
  secretAccessKey: 'test'
});

describe('Email Processor Integration Tests', () => {
  let s3: AWS.S3;
  let ssm: AWS.SSM;

  beforeEach(async () => {
    s3 = new AWS.S3();
    ssm = new AWS.SSM();

    // Create test buckets
    await s3.createBucket({ Bucket: 'test-incoming-bucket' }).promise();
    await s3.createBucket({ Bucket: 'test-processed-bucket' }).promise();

    // Set up parameter store
    await ssm.putParameter({
      Name: '/report-builder/test/config/property-mapping',
      Value: JSON.stringify({
        "property1@example.com": "property-1"
      }),
      Type: 'String'
    }).promise();
  });

  it('should process real email end-to-end', async () => {
    // Upload test email to S3
    const emailContent = `/* real email content */`;
    await s3.putObject({
      Bucket: 'test-incoming-bucket',
      Key: 'raw-emails/test-email-456',
      Body: emailContent
    }).promise();

    // Test the actual handler
    const result = await handler(testEvent, mockContext);
    
    // Verify files were stored correctly
    const objects = await s3.listObjectsV2({
      Bucket: 'test-incoming-bucket',
      Prefix: 'daily-files/'
    }).promise();

    expect(objects.Contents).toBeDefined();
    expect(objects.Contents.length).toBeGreaterThan(0);
  });
});
```

## Testing File Processor Lambda

### Mock EventBridge Event

```typescript
// test/file-processor.local.test.ts
describe('File Processor Local Testing', () => {
  it('should process daily batch event', async () => {
    const testEvent = {
      version: '0',
      id: 'test-event-789',
      'detail-type': 'Scheduled File Processing',
      source: 'report-builder.scheduler',
      account: '123456789012',
      time: '2024-01-15T06:00:00Z',
      region: 'us-east-1',
      detail: {
        processingType: 'daily-batch',
        environment: 'development',
        timestamp: '2024-01-15T06:00:00Z',
        scheduleExpression: 'cron(0 6 * * ? *)'
      }
    };

    const mockContext = {
      awsRequestId: 'test-batch-456',
      functionName: 'test-file-processor',
      getRemainingTimeInMillis: () => 600000 // 10 minutes
    };

    // Mock S3 file discovery
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: 'daily-files/property-1/2024-01-15/report.pdf',
          Size: 156789,
          LastModified: new Date('2024-01-15T08:00:00Z')
        }
      ]
    });

    const result = await fileProcessorHandler(testEvent, mockContext);
    
    expect(result.statusCode).toBe(200);
    expect(result.processingType).toBe('daily-batch');
  });
});
```

## Manual Testing Scripts

### Email Processing Test Script

```bash
#!/bin/bash
# test/scripts/test-email-processing.sh

echo "Testing Email Processor Lambda..."

# Set test environment
export NODE_ENV=test
export INCOMING_FILES_BUCKET=test-bucket
export AWS_ENDPOINT_URL=http://localhost:4566

# Create test email file
cat > test-email.eml << 'EOF'
From: property1@example.com
To: test@example.com
Subject: Test Daily Report
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/plain

This is a test email with attachments.

--boundary123
Content-Type: application/pdf
Content-Disposition: attachment; filename="daily-report.pdf"

%PDF-1.4 Test PDF content
--boundary123--
EOF

# Upload to LocalStack S3
aws s3 cp test-email.eml s3://test-bucket/raw-emails/test-message-id

# Create test event JSON
cat > test-event.json << 'EOF'
{
  "Records": [
    {
      "eventSource": "aws:ses",
      "eventVersion": "1.0",
      "ses": {
        "mail": {
          "messageId": "test-message-id",
          "source": "property1@example.com",
          "commonHeaders": {
            "subject": "Test Daily Report"
          }
        },
        "receipt": {
          "action": {
            "type": "S3",
            "bucketName": "test-bucket",
            "objectKey": "raw-emails/test-message-id"
          }
        }
      }
    }
  ]
}
EOF

# Test with Node.js
node -e "
const { handler } = require('./dist/lambda/email-processor.js');
const event = require('./test-event.json');
const context = { awsRequestId: 'test-123', getRemainingTimeInMillis: () => 30000 };

handler(event, context).then(result => {
  console.log('Result:', JSON.stringify(result, null, 2));
}).catch(error => {
  console.error('Error:', error);
});
"

# Cleanup
rm test-email.eml test-event.json
```

### File Processing Test Script

```bash
#!/bin/bash
# test/scripts/test-file-processing.sh

echo "Testing File Processor Lambda..."

# Create test files in S3
aws s3 cp test-data/property-1-report.pdf s3://test-bucket/daily-files/property-1/2024-01-15/
aws s3 cp test-data/property-2-data.csv s3://test-bucket/daily-files/property-2/2024-01-15/

# Create EventBridge test event
cat > batch-event.json << 'EOF'
{
  "version": "0",
  "id": "test-batch-event",
  "detail-type": "Scheduled File Processing",
  "source": "report-builder.scheduler",
  "account": "123456789012",
  "time": "2024-01-15T06:00:00Z",
  "region": "us-east-1",
  "detail": {
    "processingType": "daily-batch",
    "environment": "development",
    "timestamp": "2024-01-15T06:00:00Z"
  }
}
EOF

# Test file processor
node -e "
const { handler } = require('./dist/lambda/file-processor.js');
const event = require('./batch-event.json');
const context = { awsRequestId: 'test-batch-456', getRemainingTimeInMillis: () => 600000 };

handler(event, context).then(result => {
  console.log('Batch Result:', JSON.stringify(result, null, 2));
}).catch(error => {
  console.error('Batch Error:', error);
});
"

# Cleanup
rm batch-event.json
```

## Debugging Tips

### Enable Debug Logging
```bash
export DEBUG=true
export LOG_LEVEL=debug
npm test
```

### Use AWS X-Ray Local
```bash
# Install X-Ray daemon
wget https://s3.us-east-2.amazonaws.com/aws-xray-assets.us-east-2/xray-daemon/aws-xray-daemon-3.x.zip
unzip aws-xray-daemon-3.x.zip
./xray -l dev -n us-east-1

# Enable tracing in tests
export _X_AMZN_TRACE_ID="Root=1-5e1b4151-5ac6c58f3020d83e05a3b5a0"
```

### Monitor Resource Usage
```typescript
// Add to test setup
process.on('beforeExit', () => {
  console.log('Memory usage:', process.memoryUsage());
  console.log('CPU usage:', process.cpuUsage());
});
```

## Test Data Management

### Sample Test Files
```bash
# Create test-data directory structure
mkdir -p test-data/emails test-data/attachments

# Generate sample email
cat > test-data/emails/sample-email.eml << 'EOF'
From: property1@example.com
To: test@example.com
Subject: Sample Daily Report
/* ... email content ... */
EOF

# Create sample attachments
echo "CSV data" > test-data/attachments/sample.csv
echo "%PDF-1.4 sample" > test-data/attachments/sample.pdf
```

### Test Environment Cleanup
```bash
#!/bin/bash
# test/scripts/cleanup.sh

echo "Cleaning up test environment..."

# Remove LocalStack containers
docker stop localstack_main
docker rm localstack_main

# Clean test files
rm -rf test-data/temp/*
rm -f test-*.json test-*.eml

# Reset environment variables
unset AWS_ENDPOINT_URL
unset NODE_ENV

echo "Cleanup complete!"
``` 