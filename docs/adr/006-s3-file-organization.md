# ADR-006: S3 File Organization Strategy

## Status
Accepted

## Context

The Report Builder system processes daily files from multiple hotel properties and needs:

- **Logical file organization**: Clear structure for different file types and processing stages
- **Property isolation**: Separate storage areas for different hotel properties
- **Date-based partitioning**: Efficient organization by processing date for time-series analysis
- **Processing stages**: Clear separation between raw, processed, and archived files
- **Query efficiency**: Structure that supports efficient file discovery and batch operations
- **Cost optimization**: Lifecycle policies for automated archival and deletion
- **Access patterns**: Support for both individual file access and bulk processing

## Decision

We will use a **hierarchical S3 bucket structure** with three dedicated buckets and standardized path conventions for organizing files by processing stage, property, and date.

## Alternatives Considered

### 1. Single Bucket with Prefixes
- **Pros**: Simpler IAM policies, fewer resources to manage, consolidated storage
- **Cons**: Risk of cross-contamination, harder to implement differential security, complex lifecycle policies

### 2. Property-Based Bucket Strategy
- **Pros**: Complete isolation per property, granular access control
- **Cons**: Bucket proliferation (50+ buckets), management overhead, IAM policy complexity

### 3. Flat File Structure with Metadata
- **Pros**: Simple implementation, flexible naming
- **Cons**: Poor query performance, difficult batch operations, no natural partitioning

### 4. Database-Centric with S3 References
- **Pros**: Rich metadata querying, relational organization
- **Cons**: Additional infrastructure, complexity for simple file operations, cost overhead

## Consequences

### Positive
- **Clear separation of concerns**: Raw, processed, and mapping files isolated by bucket
- **Efficient batch operations**: Date-based partitioning enables efficient daily processing
- **Property isolation**: Each property has dedicated path space within buckets
- **Lifecycle management**: Bucket-level policies for cost optimization
- **Access control**: Granular IAM policies per bucket and path
- **Query performance**: Predictable paths enable efficient S3 list operations
- **Monitoring**: Bucket-level CloudWatch metrics for operational insight

### Negative
- **Path depth**: Deep hierarchies can impact some operations
- **Convention dependency**: Requires strict adherence to naming conventions
- **Cross-bucket operations**: Some workflows require multiple bucket access

### Neutral
- **Storage costs**: Standard S3 pricing across all buckets
- **Management overhead**: Three buckets to monitor instead of one

## Implementation Notes

### Bucket Structure

```
report-builder-incoming-files-{environment}/
├── raw-emails/                    # SES-stored email files
│   └── {messageId}               # Raw email content
├── daily-files/{propertyId}/{date}/   # Extracted attachments
│   ├── report.pdf
│   ├── data.csv
│   └── summary.xlsx
└── email-metadata/{date}/         # Email processing metadata
    └── {messageId}.json

report-builder-processed-files-{environment}/
├── daily-reports/{propertyId}/{date}/     # Processed daily reports
│   ├── aggregated-data.json
│   └── comparison-results.json
├── weekly-reports/{propertyId}/{week}/    # Weekly aggregations
│   └── weekly-summary.json
└── archives/{year}/{month}/        # Long-term archived reports
    └── {propertyId}/

report-builder-mapping-files-{environment}/
├── property-mappings/             # Email-to-property mapping files
│   └── current-mapping.csv
├── templates/                     # Report templates
│   └── standard-template.xlsx
└── configuration/                 # System configuration files
    └── processing-rules.json
```

### Path Conventions

#### Date Format: `YYYY-MM-DD`
- Enables lexicographical sorting
- Compatible with S3 partitioning
- Human-readable for debugging

#### Property ID Format: `property-{id}` or `unknown-property`
- Consistent prefix for easy filtering
- Fallback for unmapped email addresses
- URL-safe characters only

#### File Naming: `{original-name}.{extension}`
- Preserve original filenames when possible
- Sanitize special characters
- Maintain file extensions for type identification

### Lifecycle Policies

```json
{
  "incoming-files": {
    "transitions": [
      {
        "days": 30,
        "storageClass": "STANDARD_IA"
      },
      {
        "days": 90,
        "storageClass": "GLACIER"
      }
    ],
    "expiration": {
      "days": 2555  // 7 years for business record retention
    }
  },
  "processed-files": {
    "transitions": [
      {
        "days": 90,
        "storageClass": "STANDARD_IA"
      }
    ],
    "expiration": {
      "days": 1825  // 5 years for processed reports
    }
  }
}
```

### Access Patterns

#### Email Processing Lambda
- **Read**: `incoming-files/raw-emails/{messageId}`
- **Write**: `incoming-files/daily-files/{propertyId}/{date}/*`
- **Write**: `incoming-files/email-metadata/{date}/{messageId}.json`

#### File Processing Lambda
- **Read**: `incoming-files/daily-files/{propertyId}/{date}/*`
- **Read**: `mapping-files/property-mappings/*`
- **Write**: `processed-files/daily-reports/{propertyId}/{date}/*`

#### Batch Operations
- **List**: `incoming-files/daily-files/*/2025-08-06/` (all properties for specific date)
- **List**: `processed-files/daily-reports/property-1/2025-08-*/` (one property for month)

### Security Implementation
- **Bucket policies**: Environment-specific access restrictions
- **IAM roles**: Least-privilege access per Lambda function
- **Encryption**: Server-side encryption enabled by default
- **Versioning**: Enabled for critical buckets with MFA delete protection
- **Public access**: Blocked at bucket level

### Monitoring and Operations
- **CloudWatch metrics**: Request metrics enabled for all buckets
- **S3 event notifications**: Trigger processing on file uploads
- **Inventory reports**: Weekly inventory for cost analysis
- **Access logging**: S3 access logs for security auditing

## References
- [S3 Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html)
- [S3 Lifecycle Management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html) 