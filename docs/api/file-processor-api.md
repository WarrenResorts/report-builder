# File Processor Lambda API

## Overview

The File Processor Lambda function is triggered by Amazon EventBridge on a scheduled basis to perform batch processing of daily files. It processes accumulated files, generates consolidated reports, and prepares them for delivery.

## Function Details

- **Function Name**: `report-builder-file-processor-{environment}`
- **Runtime**: Node.js 20.x
- **Memory**: 768 MB (development), 1024 MB (production)
- **Timeout**: 10 minutes (development), 15 minutes (production)
- **Trigger**: Amazon EventBridge scheduled events

## Input Interface

### Event Structure

The function receives EventBridge events with the following structure:

```typescript
interface EventBridgeEvent<T> {
  version: string;
  id: string;
  'detail-type': string;
  source: string;
  account: string;
  time: string;
  region: string;
  detail: T;
}

interface FileProcessingEvent {
  processingType: 'daily-batch' | 'weekly-report';
  environment: string;
  timestamp: string;
  scheduleExpression: string;
}
```

### Example Event

```json
{
  "version": "0",
  "id": "12345678-1234-1234-1234-123456789012",
  "detail-type": "Scheduled File Processing",
  "source": "report-builder.scheduler",
  "account": "123456789012",
  "time": "2024-01-15T06:00:00Z",
  "region": "us-east-1",
  "detail": {
    "processingType": "daily-batch",
    "environment": "production",
    "timestamp": "2024-01-15T06:00:00Z",
    "scheduleExpression": "cron(0 6 * * ? *)"
  }
}
```

## Output Interface

### Success Response

```typescript
interface FileProcessingResult {
  statusCode: 200;
  message: string;
  processedFiles: number;
  timestamp: string;
  processingType: 'daily-batch' | 'weekly-report';
  environment: string;
  correlationId: string;
  duration: number; // milliseconds
  generatedReports: Array<{
    reportType: string;
    fileName: string;
    s3Key: string;
    size: number;
    recordCount: number;
  }>;
}
```

### Example Success Response

```json
{
  "statusCode": 200,
  "message": "Daily batch processing completed successfully",
  "processedFiles": 14,
  "timestamp": "2024-01-15T06:15:30.000Z",
  "processingType": "daily-batch",
  "environment": "production",
  "correlationId": "fproc-1705305330000-xyz789abc",
  "duration": 45230,
  "generatedReports": [
    {
      "reportType": "consolidated-daily",
      "fileName": "daily-report-2024-01-15.csv",
      "s3Key": "processed-reports/2024/01/15/daily-report-2024-01-15.csv",
      "size": 2456789,
      "recordCount": 15420
    },
    {
      "reportType": "property-summary",
      "fileName": "property-summary-2024-01-15.json",
      "s3Key": "processed-reports/2024/01/15/property-summary-2024-01-15.json",
      "size": 145678,
      "recordCount": 14
    }
  ]
}
```

## Processing Flow

### 1. Event Reception
- Receives EventBridge scheduled event
- Generates correlation ID for batch tracking
- Logs batch processing initiation

### 2. File Discovery
- Scans S3 for files from the last 24 hours (for daily-batch)
- Organizes files by property ID and date
- Validates file integrity and formats

### 3. Data Processing
- **PDF Processing**: Extracts text using AWS Textract or pdfjs-dist
- **CSV Processing**: Parses and validates data structures
- **Excel Processing**: Converts to standard format using ExcelJS
- **Data Transformation**: Applies mapping rules from Excel mapping file

### 4. Report Generation
- **Consolidation**: Combines all property data into unified format
- **Validation**: Ensures data quality and completeness
- **Formatting**: Generates final CSV/Excel reports
- **Metadata**: Creates processing summaries and statistics

### 5. Output Storage
- Stores processed reports in S3: `processed-reports/{YYYY}/{MM}/{DD}/`
- Creates backup copies with timestamps
- Updates processing status in Parameter Store

### 6. Notification (Future)
- Sends completion notifications via SES
- Includes processing summary and download links
- Alerts on processing failures or data anomalies

## Error Handling

### Error Types

#### 1. FileDiscoveryError
```typescript
{
  name: "FileDiscoveryError",
  message: "Failed to discover files for processing: {reason}",
  correlationId: string,
  context: {
    bucketName: string,
    dateRange: string,
    expectedFiles: number,
    foundFiles: number
  }
}
```

#### 2. DataProcessingError
```typescript
{
  name: "DataProcessingError",
  message: "Failed to process file data: {reason}",
  correlationId: string,
  context: {
    fileName: string,
    fileType: string,
    propertyId: string,
    processingStep: string
  }
}
```

#### 3. ReportGenerationError
```typescript
{
  name: "ReportGenerationError",
  message: "Failed to generate report: {reason}",
  correlationId: string,
  context: {
    reportType: string,
    recordCount: number,
    processingDuration: number
  }
}
```

### Retry Behavior

- **File Operations**: 3 retries with exponential backoff
- **Data Processing**: 2 retries for transient failures
- **Report Generation**: Single attempt (complex operation)
- **Dead Letter Queue**: Failed events sent to DLQ for investigation

## Supported Processing Types

### Daily Batch Processing
- **Schedule**: Daily at 6:00 AM UTC
- **Scope**: Files from previous 24 hours
- **Output**: Consolidated daily report
- **Duration**: Typically 2-5 minutes

### Weekly Report Processing
- **Schedule**: Weekly on Sundays at 7:00 AM UTC
- **Scope**: Files from previous 7 days
- **Output**: Weekly summary and trends
- **Duration**: Typically 10-20 minutes

## Environment Configuration

### Required Environment Variables

- `INCOMING_FILES_BUCKET`: S3 bucket containing files to process
- `PROCESSED_FILES_BUCKET`: S3 bucket for storing final reports
- `MAPPING_FILES_BUCKET`: S3 bucket containing Excel mapping files
- `PARAMETER_STORE_CACHE_TTL_SECONDS`: Cache TTL for configuration

### Parameter Store Configuration

Required parameters:
- `/report-builder/{env}/processing/batch-size`: Maximum files per batch
- `/report-builder/{env}/processing/timeout-minutes`: Processing timeout
- `/report-builder/{env}/email/recipients`: Report delivery recipients
- `/report-builder/{env}/config/mapping-file-key`: S3 key for Excel mapping file

## File Organization

### Input File Structure
```
daily-files/
├── property-1/
│   └── 2024-01-15/
│       ├── morning-report.pdf
│       ├── transactions.csv
│       └── summary.xlsx
├── property-2/
│   └── 2024-01-15/
│       └── daily-data.csv
└── unknown-property/
    └── 2024-01-15/
        └── unidentified-file.pdf
```

### Output Report Structure
```
processed-reports/
├── 2024/
│   └── 01/
│       └── 15/
│           ├── daily-report-2024-01-15.csv
│           ├── property-summary-2024-01-15.json
│           ├── processing-log-2024-01-15.txt
│           └── backup/
│               └── daily-report-2024-01-15-backup.csv
```

## Data Transformation

### Mapping Configuration

The Excel mapping file defines:
- **Column Mappings**: Source column to standard field mappings
- **Data Types**: Expected data types and validation rules
- **Business Rules**: Calculation formulas and derivations
- **Property Settings**: Property-specific processing rules

### Standard Output Format

```csv
Date,PropertyID,TransactionType,Amount,AccountCode,Description,Source
2024-01-15,property-1,REVENUE,1250.00,4010,Room Revenue,PDF
2024-01-15,property-1,EXPENSE,85.50,6010,Supplies,CSV
2024-01-15,property-2,REVENUE,2100.00,4010,Room Revenue,XLSX
```

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
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::report-builder-*",
        "arn:aws:s3:::report-builder-*/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:PutParameter"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/report-builder/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "textract:DetectDocumentText",
        "textract:AnalyzeDocument"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": [
        "arn:aws:ses:*:*:identity/*"
      ]
    }
  ]
}
```

## Monitoring & Logging

### CloudWatch Metrics

Custom metrics published:
- `FilesProcessed`: Number of files processed per batch
- `ProcessingDuration`: Time taken for batch processing
- `ReportsGenerated`: Number of reports created
- `DataQualityScore`: Percentage of valid records processed
- `ProcessingErrors`: Number of files that failed processing

### Log Format

Structured JSON logging with correlation IDs:

```json
{
  "timestamp": "2024-01-15T06:15:30.000Z",
  "level": "INFO",
  "service": "FileProcessor",
  "message": "Batch processing completed successfully",
  "correlationId": "fproc-1705305330000-xyz789abc",
  "processingType": "daily-batch",
  "filesProcessed": 14,
  "reportsGenerated": 2,
  "duration": 45230,
  "operation": "batch_processing_complete"
}
```

## Performance Considerations

### Memory Usage
- **Base Memory**: 768 MB for typical daily processing
- **Peak Memory**: Up to 1024 MB for large file processing
- **Memory Optimization**: Streaming processing for large CSV files

### Processing Time
- **Average**: 2-5 minutes for daily batch (14 properties)
- **Peak**: 10-15 minutes for weekly reports or large datasets
- **Timeout**: Configurable per environment (10-15 minutes)

### Concurrency
- **Reserved Concurrency**: 2 instances to prevent overwhelming downstream systems
- **Batch Size**: Configurable files per processing batch
- **Rate Limiting**: Built-in delays for external API calls

## Testing

### Unit Tests
```bash
# Run file processor tests
npm test -- src/lambda/file-processor.test.ts
```

### Integration Tests
```bash
# Test with sample files
npm run test:integration -- --grep "file-processing"
```

### Local Testing

```typescript
import { handler } from '../src/lambda/file-processor';

const testEvent = {
  version: "0",
  id: "test-event",
  "detail-type": "Scheduled File Processing",
  source: "test",
  account: "123456789012",
  time: new Date().toISOString(),
  region: "us-east-1",
  detail: {
    processingType: "daily-batch",
    environment: "development",
    timestamp: new Date().toISOString(),
    scheduleExpression: "cron(0 6 * * ? *)"
  }
};

const result = await handler(testEvent, mockContext);
console.log(result);
```

## Troubleshooting

### Common Issues

1. **Missing Files**: Check S3 bucket permissions and file organization
2. **Processing Timeout**: Increase memory allocation or timeout settings
3. **Data Quality Issues**: Review Excel mapping file and validation rules
4. **Memory Errors**: Enable streaming processing for large files

### Debug Mode

Enable debug logging by setting Parameter Store value:
```
/report-builder/{env}/config/debug-mode = "true"
```

This enables detailed logging of file processing steps and data transformations. 