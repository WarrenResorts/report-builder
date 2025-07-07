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
4. **Consolidation**: Combine all processed data into single CSV with property sections
5. **Delivery**: Send consolidated report via email

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

### Phase 6: Error Handling & Monitoring
- [ ] CloudWatch logging
- [ ] Error notifications
- [ ] Dead letter queues
- [ ] Retry mechanisms

### Phase 7: Testing & Deployment
- [ ] Unit tests for Lambda functions
- [ ] Integration tests
- [ ] End-to-end testing
- [ ] Production deployment

## 🛠️ Technical Decisions

### File Processing Options
1. **PDF Processing**: AWS Textract (managed) vs pdf-parse (in Lambda)
2. **Excel Mapping**: ExcelJS library in Lambda
3. **CSV Processing**: Built-in Node.js csv-parser

### Cost Optimization Strategies
- Use Lambda with minimal memory allocation
- Implement S3 lifecycle policies
- Use SES in same region to avoid data transfer costs
- Implement efficient file processing to minimize Lambda execution time

## 📊 Estimated Monthly Costs (14 emails/day = ~420/month)
- **SES**: ~$0.50 (well within free tier for receiving, minimal sending costs)
- **S3**: ~$0.50 (storing ~84MB/month of files)
- **Lambda**: ~$0.10 (processing time minimal, within free tier)
- **Total**: ~$1-2/month (very cost-effective for this volume)

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
1. Do you need any reporting/dashboard capabilities?
2. Should the output file include timestamps or processing metadata?
3. How should properties be identified in the final output (property name, ID, etc.)?

## 🚀 Next Steps
1. Review and refine this plan
2. Set up SES domain verification
3. Create sample Excel mapping file structure
4. Implement basic email receiving functionality
5. Build file processing pipeline

---

*This plan will be updated as requirements evolve and implementation progresses.* 