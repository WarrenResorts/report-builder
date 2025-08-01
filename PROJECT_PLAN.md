# Report Builder Project Plan

## 📋 Project Overview
Automated file processing system that receives files via email, processes them through Excel mapping, and sends the transformed results via email.

## 🎯 Core Requirements
- **Input**: Email with attached file (PDF, CSV, or TXT)
- **Processing**: Transform file using Excel mapping rules
- **Output**: Send processed CSV file via email
- **Constraints**: 
  - Use AWS services (serverless preferred)
  - Manage everything through GitHub/CDK (no AWS console)
  - Cost-effective solution

## 🏗️ Proposed Architecture

### AWS Services (Cost-Effective Serverless Approach)
1. **Amazon SES (Simple Email Service)**
   - Receive incoming emails with attachments
   - Send processed files via email
   - Cost: ~$0.10 per 1,000 emails

2. **Amazon S3**
   - Store incoming files
   - Store Excel mapping file
   - Store processed output files
   - Cost: ~$0.023 per GB/month

3. **AWS Lambda**
   - Process files (PDF parsing, CSV transformation)
   - Handle email triggers
   - Cost: First 1M requests free, then $0.20 per 1M requests

4. **Amazon EventBridge**
   - Schedule daily batch processing (cron job)
   - Trigger Lambda at specified time each day
   - Cost: First 1M events free

### Data Flow
```
Throughout Day: Emails → SES → S3 (store files)
Daily Schedule: EventBridge → Lambda → Process 24hr files → S3 (output) → SES (send)
```

### Processing Logic
1. **Collection Phase**: Receive and store files throughout the day (24-hour window)
2. **Scheduled Trigger**: Daily batch job processes all files from prior 24 hours
3. **Batch Processing**: Process all collected files using mapping rules
4. **Historical Comparison**: Compare current day data with previous day (Phase 6)
5. **Consolidation**: Combine all processed data into single CSV with property sections
6. **Net Change Calculation**: Generate delta reports showing day-to-day changes (Phase 6)
7. **Delivery**: Send consolidated report with optional comparison data via email

## 📝 Implementation Plan

### Phase 1: Infrastructure Setup ✅
- [x] CDK project structure
- [x] GitHub Actions CI/CD with enhanced features
- [x] Environment configuration (dev/prod)
- [x] KICS security scanning
- [x] Conventional commits validation
- [x] Automated release tagging
- [x] ESLint and Jest configuration
- [x] AWS SES configuration
- [x] S3 buckets setup
- [x] Lambda functions scaffolding

### Phase 2: Email Processing
- [ ] SES email receiving configuration
- [ ] Lambda function to handle incoming emails
- [ ] Extract and store attachments in S3 with timestamps
- [ ] Email parsing and validation
- [ ] EventBridge scheduled rule for daily processing

### Phase 3: File Processing Engine
- [ ] Batch processing Lambda (triggered by EventBridge)
- [ ] Query S3 for files from last 24 hours
- [ ] PDF text extraction (using AWS Textract or pdf-parse)
- [ ] CSV parsing utilities
- [ ] TXT file processing
- [ ] Excel mapping file parser
- [ ] Data transformation logic

### Phase 4: Output Generation
- [ ] CSV generation from processed data
- [ ] File validation and quality checks
- [ ] S3 storage of output files

### Phase 5: Email Delivery
- [ ] SES email sending configuration
- [ ] Email template system
- [ ] Attachment handling for outbound emails
- [ ] Delivery confirmation

### Phase 6: Day-to-Day Comparison Engine
- [ ] Enhanced S3 storage structure for processed daily data
- [ ] Historical data retrieval functions
- [ ] Day-to-day comparison algorithms
- [ ] Net change calculation logic
- [ ] Handle missing previous day data scenarios
- [ ] Enhanced report format with delta sections
- [ ] Data standardization for cross-format comparison

### Phase 7: Error Handling & Monitoring
- [ ] CloudWatch logging
- [ ] Error notifications
- [ ] Dead letter queues
- [ ] Retry mechanisms

### Phase 8: Testing & Deployment
- [ ] Unit tests for Lambda functions
- [ ] Integration tests for comparison logic
- [ ] End-to-end testing
- [ ] Production deployment

## 🆕 Day-to-Day Comparison Feature (Phase 6)

### Overview
Enhanced reporting capability that compares current day data with previous day data to calculate net changes, new transactions, and identify differences across all properties.

### Key Features
- **Historical Data Storage**: Retain processed daily data for comparison
- **Net Change Calculations**: Automatic delta calculations between consecutive days
- **Missing Data Handling**: Graceful handling when previous day data is unavailable
- **Cross-Format Comparison**: Compare data regardless of source format (PDF, CSV, TXT)
- **Enhanced Reports**: Include both current data and change summaries

### Technical Implementation
```
Enhanced S3 Structure:
├── daily-files/{property-id}/{YYYY-MM-DD}/     # Raw daily files
├── processed-data/{property-id}/{YYYY-MM-DD}/  # Standardized processed data
└── comparison-reports/{YYYY-MM-DD}/            # Delta reports
```

### Comparison Logic
1. **Data Standardization**: Convert all formats to common JSON structure
2. **Historical Lookup**: Retrieve previous day's processed data from S3
3. **Delta Calculation**: Compare account codes, amounts, transaction counts
4. **Report Enhancement**: Add "Net Changes" section to daily reports
5. **Missing Data Scenarios**: Handle first-day processing and data gaps

### Use Cases
- Track daily revenue changes across properties
- Identify new or removed transaction types
- Monitor payment method trends
- Detect data processing anomalies

## 🛠️ Technical Decisions

### File Processing Options
1. **PDF Processing**: AWS Textract (managed) vs pdf-parse (in Lambda)
2. **Excel Mapping**: ExcelJS library in Lambda
3. **CSV Processing**: Built-in Node.js csv-parser
4. **Data Comparison**: Custom delta engine with JSON diff algorithms

### Cost Optimization Strategies
- Use Lambda with minimal memory allocation
- Implement S3 lifecycle policies
- Use SES in same region to avoid data transfer costs
- Implement efficient file processing to minimize Lambda execution time

## 📊 Estimated Monthly Costs (14 emails/day = ~420/month)

### Basic Processing (Phases 1-5)
- **SES**: ~$0.50 (well within free tier for receiving, minimal sending costs)
- **S3**: ~$0.50 (storing ~84MB/month of files)
- **Lambda**: ~$0.10 (processing time minimal, within free tier)
- **Basic Total**: ~$1-2/month

### With Day-to-Day Comparison (Phase 6)
- **SES**: ~$0.50 (unchanged)
- **S3**: ~$1.00 (additional storage for processed data + comparison reports)
- **Lambda**: ~$0.25 (longer execution time for comparison logic)
- **Enhanced Total**: ~$2-3/month (still very cost-effective)

### Cost Impact Analysis
- **Additional Storage**: ~$0.50/month for historical processed data
- **Processing Overhead**: ~$0.15/month for comparison calculations
- **Benefits**: Significant business value from trend analysis and change detection

## 🔧 Development Environment
- **Languages**: Node.js/TypeScript
- **Infrastructure**: AWS CDK
- **CI/CD**: GitHub Actions
- **Testing**: Jest
- **Monitoring**: CloudWatch

## 📋 Project Specifications
1. **Volume**: 14 emails per day (one per property)
2. **Processing**: All files combined into single output file, separated by property
3. **File Size**: 100-200 KB per incoming file
4. **Mapping File**: Will be provided when ready for implementation
5. **Whitelist/Error Handling**: To be defined during implementation phases
6. **Output**: Single consolidated CSV with property-based sections

## 📋 Additional Questions

### Basic Processing
1. Do you need any reporting/dashboard capabilities?
2. Should the output file include timestamps or processing metadata?
3. How should properties be identified in the final output (property name, ID, etc.)?

### Day-to-Day Comparison (Phase 6)
4. What types of changes are most important to track (revenue, transaction counts, new accounts)?
5. Should comparison reports be sent as separate emails or included in daily reports?
6. How should missing previous day data be handled in reports?
7. What threshold changes should trigger special alerts or notifications?

## 🚀 Next Steps
1. Review and refine this plan
2. Set up SES domain verification
3. Create sample Excel mapping file structure
4. Implement basic email receiving functionality
5. Build file processing pipeline

---

*This plan will be updated as requirements evolve and implementation progresses.* 