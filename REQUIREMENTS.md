# Report Builder - Email Processing Requirements

## Overview
This document captures the requirements for the email processing functionality of the Report Builder system.

## 📧 Email Processing Requirements

### 1. Email Source
- **Number of senders**: 14 different property management systems
- **Sender addresses**: 14 different email addresses (one per property management system)
- **Configuration control**: We can configure each management system to send to any email address we specify
- **Target domain**: `example.com` (DNS control available)
- **Proposed SES email**: `test@example.com` (or similar)

### 2. Email Format
- **Attachment types**: PDF, CSV, and TXT files
- **Email body**: Will be ignored (no processing needed)
- **Attachments per email**: Variable (1 or multiple attachments per email)
- **Variation**: May vary by property and day

### 3. File Naming Patterns
- **Status**: UNKNOWN (Email being sent to gather info)
- **Need to determine**: 
  - Are there consistent naming patterns?
  - Do filenames include property names or dates?
  - How consistent are filenames across different property management systems?

### 4. Email Domain Setup
- **Domain**: `example.com`
- **DNS Control**: Available
- **SES Integration**: Will be configured for email receiving

## 🚀 Technical Implementation Plan

### Phase 2A: SES Email Receiving Setup
- Configure SES to receive emails at `test@example.com`
- Set up DNS records (MX, TXT) for domain verification
- Configure S3 integration for raw email storage
- Create email processing rules

### Phase 2B: Email Parser Lambda
- Parse incoming emails and extract metadata
- Handle multiple attachment scenarios
- Support PDF, CSV, and TXT file types
- Save attachments to S3 with organized structure
- Extract sender information to identify property

### Phase 2C: Trigger Integration
- Connect email receipt to Lambda function
- Set up proper error handling and logging
- Implement retry logic for failed processing

## 📁 Proposed File Structure
```
s3://report-builder-incoming-files-{env}/
├── raw-emails/                    # Raw email files from SES
│   └── {timestamp}-{message-id}.json
├── daily-emails/                  # Extracted attachments
│   └── {property-id}/
│       └── {date}/
│           ├── report1.pdf
│           ├── report2.csv
│           └── report3.txt
└── mapping-files/                 # Excel mapping files
    └── property-mapping.xlsx
```

### 5. Processing Timing
- **Schedule**: Daily at 11:59 AM
- **Processing window**: 24-hour batches (11:59 AM Day 1 → 11:59 AM Day 2)
- **Approach**: Batch processing (not real-time)
- **Implementation**: EventBridge scheduled rule to trigger processing Lambda

### 6. Property Identification & Final Report
- **Final output**: Single consolidated report containing data from all 14 properties
- **Property distinction**: Each property must be separately identified within the report
- **Delivery**: 2-3 email recipients (specific addresses TBD)
- **Email limits**: Well within AWS SES limits (50 recipients max, 200 emails/day)
- **Property mapping**: UNKNOWN (Email being sent to gather info)
- **Need to determine**: Mapping from sender email address to property name/ID

### 7. Error Handling & Late Reports
- **Report generation failure**: Retry once, then alert
- **Report sending failure**: Retry once, then alert
- **Missing property data**: Continue processing, note missing property in email body
- **Late reports**: Process multiple reports from same property in 24-hour window
- **Duplicate handling**: If property sends late report, process both reports from same property

## 📊 Data Structure Analysis

### Mapping File Structure
Based on `WRHMappingFile copy.csv` (768 lines):

**Columns:**
- `Rec Id`: Record identifier
- `Src Acct Code`: Source account code (from PMS)
- `Src Acct Desc`: Source account description
- `Xref Key`: Cross-reference key
- `Acct Id`: Account ID
- `Property Id`: Property identifier (0-15)
- `Property Name`: Property name (when specified)
- `Acct Code`: Target account code
- `Acct Suffix`: Account suffix
- `Acct Name`: Target account name
- `Multiplier`: Multiplier for calculations
- `Created/Updated`: Timestamps

### Identified Properties
From the mapping file, we can see these properties:
- **Best Western Windsor Inn** (Property ID: 15)
- **Driftwood Inn** (Property ID: 3)
- **Lakeside Lodge & Suites** (Property ID: 9)
- **Marina Beach Motel** (Property ID: 1)
- Plus additional properties with IDs: 4, 5, 6, 7, 8, 10, 14

### Data Processing Logic
The system maps PMS transaction codes to accounting codes with:
- Revenue categorization (Room charges, other revenue, taxes)
- Payment method tracking (Cash, Credit Cards, Direct Bill)
- Property-specific mappings
- Multipliers for calculations

## ❓ Outstanding Questions
1. **File naming patterns**: What naming conventions do the property management systems use?
2. **Property identification**: How do we map sender email to property name/ID?
3. **Final report delivery**: What email address should receive the consolidated report?
4. **Alert notifications**: Where should error alerts be sent when retries fail?
5. **Report format**: What should the final consolidated report look like?

## 📋 Next Steps
1. Complete requirements gathering (file naming patterns, etc.)
2. Set up SES domain verification
3. Implement email receiving infrastructure
4. Build attachment extraction logic
5. Test with sample emails from property management systems 