# Remaining Issues to Address

## Issues Fixed ✅

### 1. Credit Card Processing Flow
- **Problem**: Credit card summary lines (VISA/MASTER, AMEX, DISCOVER) were filtered out during mapping because they don't have VisualMatrix mappings
- **Solution**: Extract credit card totals BEFORE mapping, then generate deposit records after mapping
- **Status**: ✅ FIXED

### 2. Parser Pattern Ordering
- **Problem**: Parser was missing account codes due to incorrect regex ordering
- **Solution**: Reordered patterns to prioritize specific matches (ledgerLine → paymentMethodLine → summaryLine → embeddedTransactionCode → glClAccountCode → statisticalLine)
- **Status**: ✅ FIXED

### 3. Debit/Credit Calculation Logic
- **Current Implementation**: Uses account type (asset/liability/revenue/expense) and sign to determine debit/credit
- **Status**: ✅ IMPLEMENTED (needs verification with real data)

## Issues Requiring Verification ⚠️

### 1. VisualMatrix Mapping File Completeness
**Required mappings** (based on `10_14_2025JE.csv` example):

| Source Code | Target Code | Description | Expected in Output |
|-------------|-------------|-------------|--------------------|
| `GUEST LEDGER` | `10006-654` | Guest Ledger | ✓ Row 2 |
| `CITY LEDGER` | `10502-2051` | AR - City Ledger | ✓ Row 5 |
| `ADVANCE DEPOSITS` | `24000-263` | Deferred Revenue | ✓ Row 9 |
| `RC` | `40110-634` | Revenue - Direct Booking | ✓ Row 11 |
| `RD` | `40110-634` | Revenue - Direct Booking | ✓ Row 10 |
| `P` | `40120-635` | Revenues : Other Revenue | ✓ Row 12 |
| `9` | `20103-662` | Tax Payable: Tourist Tax Payable | ✓ Rows 6-8 |
| `91` | `20103-662` | Tax Payable: Tourist Tax Payable | ✓ Rows 6-8 |
| `92` | `20103-662` | Tax Payable: Tourist Tax Payable | ✓ Rows 6-8 |

**Action Required**: Verify VisualMatrix mapping file contains all these entries with correct:
- Target account codes
- Account names
- Multipliers (to transform amounts correctly)
- Property-specific mappings where needed

### 2. Amount Transformations via Multipliers
The parsed amounts differ significantly from expected output:
- `GUEST LEDGER`: Parsed **+21084.73** → Expected output **CREDIT 4337.79**
- `CITY LEDGER`: Parsed **+9014.85** → Expected output **DEBIT 393.02**
- `ADVANCE DEPOSITS`: Parsed **-7095.60** → Expected output **CREDIT 1000.00**

**Possible causes**:
1. VisualMatrix mapping file has multipliers that transform these values
2. Only "Today" column should be used (not MTD or other columns) - we verified parser uses "Today" correctly
3. There might be additional business logic needed

**Action Required**: 
- Verify multipliers in VisualMatrix mapping file
- Test with real data to confirm correct transformations

### 3. Column C (Sub Name) Format
**Current**: Using `propertyConfig.subsidiaryFullName` (e.g., "THE BARD'S INN HOTEL")
**Expected**: "Parent Company : Warren Family Hotels : Warren Resort Hotels of Oregon, Inc."

**Action Required**: 
- Update `PROPERTY_CONFIGURATIONS` to include the full hierarchical subsidiary name format
- OR verify if the current simplified format is acceptable

### 4. Statistical vs Financial Record Separation
**Current Implementation**: Uses keywords (ADR, RevPAR, Occupancy, etc.) to separate statistical from financial
**Status**: ✅ IMPLEMENTED (needs verification with real data)

## Testing Required 🧪

### 1. End-to-End Test with Real Data
**Test Case**: Process the Bard's Inn PDF that generated the `10_14_2025JE.csv` example
**Expected Output**:
- 12 rows in JE file (matching the example)
- 2 credit card deposit rows (VISA/MASTER combined + DISCOVER, AMEX separate)
- Correct debit/credit amounts
- Correct Entry IDs, dates, and property information

**Steps**:
1. Deploy updated code to dev environment
2. Upload test PDF to S3
3. Trigger Lambda
4. Download generated JE and StatJE files
5. Compare with `10_14_2025JE.csv` example

### 2. Multi-Property Test
**Test Case**: Process daily reports from multiple properties simultaneously
**Expected Behavior**:
- Single JE file with one header and all properties' data
- Single StatJE file with one header and all properties' data
- Each property uses correct property-specific configuration
- Property-specific mappings applied where available, global mappings as fallback

### 3. Edge Cases
- [ ] Empty/missing files
- [ ] Files with no mappable transactions
- [ ] Credit card totals of zero
- [ ] Negative amounts in various account types

## Next Steps 📋

1. **Verify VisualMatrix Mapping File** (CRITICAL)
   - Download from S3 or access via Lambda execution logs
   - Confirm all required source codes have mappings
   - Verify multipliers are correct

2. **Update Property Configurations** (if needed)
   - Add full hierarchical subsidiary names (Column C format)
   - Verify all 11 properties have correct information

3. **Deploy and Test**
   - Deploy to dev environment
   - Run end-to-end test with Bard's Inn PDF
   - Compare output with `10_14_2025JE.csv`
   - Adjust if discrepancies found

4. **Iterate Based on Test Results**
   - Fix any mapping issues discovered
   - Adjust debit/credit logic if needed
   - Refine property configurations

## Current Code Quality ✅
- **Tests**: 373 passed (373)
- **Coverage**: 85.01% statements, 90.72% functions
- **Linting**: 0 errors, 74 warnings (all `no-explicit-any`)
- **Formatting**: All files properly formatted
- **Security**: 0 vulnerabilities

**Ready for deployment pending verification of mapping file and property configurations.**

