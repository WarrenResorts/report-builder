# Hotel Feedback Implementation Plan

## Date: October 15, 2025
## Source: Email feedback from hotel accounting contact

---

## Overview

This document outlines the comprehensive changes required to generate NetSuite-compatible CSV files based on detailed feedback from the hotel's accounting team.

---

## 📋 High-Level Changes Required

### 1. **FILE STRUCTURE**
- ❌ **REMOVE**: Single combined JE/StatJE file
- ✅ **CREATE**: TWO separate CSV files:
  - `{date}_JE.csv` - Journal Entries (accounting/financial data)
  - `{date}_StatJE.csv` - Statistical Entries (metrics like ADR, Occupancy, etc.)
- ✅ **ONE header row per file** (no repeating headers for multiple properties)
- ✅ **Multiple days/properties can be in same file** (separated by Entry ID)

### 2. **COLUMN FIXES - JOURNAL ENTRIES (JE)**

#### Current Sample Analysis
Comparing our generated file with `3_26_2025JE.csv`:

| Column | Current | Required | Status | Notes |
|--------|---------|----------|--------|-------|
| A: Entry | `WR420250325` | `WR420250325` | ⚠️ Needs location ID | Should include location's internal ID (24 for Bard's) |
| B: Date | `03/25/2025` | `03/25/2025` | ✅ Working | Business date in MM/DD/YYYY format |
| C: Sub Name | Generic parent company | Property-specific | ❌ Needs fix | Must be specific to each property's corporation |
| D: Subsidiary | `5` | Property-specific | ❌ Needs fix | Each property has different NetSuite Subsidiary Internal ID |
| E: acctnumber | `10006-654` | `10006` | ❌ Needs fix | Only portion BEFORE the "-" |
| F: internal id | `654` | `654` | ✅ Working | Portion AFTER the "-" (rows 10-11 confirmed working) |
| G: location | `4` | Property-specific | ⚠️ Needs mapping | Bard's = 4, need list for all properties |
| H: account name | Working per feedback | Working per feedback | ✅ Working | Pull from mapping file |
| I: Debit | Working per feedback | Working per feedback | ✅ Working | |
| J: Credit | Working per feedback | Working per feedback | ✅ Working | |
| K: Comment | Generic or empty | From Daily Report | ❌ Needs fix | Pull actual description from report |
| L: Payment Type | Populated for all | VISA/MASTER, AMEX, DISCOVER only | ⚠️ Needs fix | Only for credit cards |

### 3. **COLUMN FIXES - STATISTICAL ENTRIES (StatJE)**

Same principles apply:
- Column A (Transaction ID): Include location internal ID
- Column C (Subsidiary): Property-specific name
- Columns E-F: Split account number
- Column G (location): Property-specific ID

### 4. **DEBIT/CREDIT MULTIPLIER FIXES**

**Critical Issue**: Many transactions have inverted debit/credit values.

#### Specific Row Mappings from Email:
| Our Row | Sample Row | Issue | Required Fix |
|---------|------------|-------|--------------|
| Row 24 | Row 2 | - | Matches sample |
| Row 20 | Row 5 | - | Matches sample |
| Row 25 | Row 9 | Wrong multiplier | Should be **Credit** |
| Row 11 | Row 10 | Wrong multiplier | Should be **Debit** |
| Row 13 | Row 6 | Wrong multiplier | Should be **Credit** |
| Row 14 | Row 7 | Wrong multiplier | Should be **Credit** |
| Row 12 | Row 8 | Wrong multiplier | Should be **Credit** |
| Row 21 | Row 12 | Wrong multiplier | Should be **Credit** |
| Row 10 | Row 11 | Wrong multiplier | Should be **Credit** |

**Root Cause Analysis Needed**:
- Investigate account type rules
- Revenue accounts: typically credit
- Asset accounts: typically debit
- Liability accounts: typically credit
- Need to map account code ranges to correct debit/credit behavior

### 5. **CREDIT CARD PROCESSING CHANGES**

#### Current Problem:
- Parser extracts credit card amounts from individual transaction lines
- Should use **summary totals from first page**

#### Required Changes:
1. ✅ **Use First Page Totals**: Extract VISA/MASTER, AMEX, DISCOVER from summary section
2. ✅ **Combine for Deposits**: 
   - Row 3 in sample: VISA/MASTER + DISCOVER combined = one deposit row
   - Row 4 in sample: AMEX = separate deposit row
3. ✅ **Two deposit rows per property**:
   - Deposit 1: VISA/MASTER + DISCOVER combined
   - Deposit 2: AMEX only

**Why**: They get deposited together, makes reconciliation easier in accounting.

---

## 🗂️ Configuration Data Needed

The hotel contact will provide lists for:

### Property Mapping Configuration
```typescript
interface PropertyConfig {
  propertyName: string;
  locationInternalId: string;      // e.g., "24" for Bard's
  subsidiaryInternalId: string;    // NetSuite Subsidiary Internal ID
  subsidiaryFullName: string;      // Full corporation name
  locationName: string;            // Location name
}
```

**Example for Bard's Inn**:
```typescript
{
  propertyName: "THE BARD'S INN HOTEL",
  locationInternalId: "24",
  subsidiaryInternalId: "5", // Need to confirm
  subsidiaryFullName: "Parent Company : Warren Family Hotels : Warren Resort Hotels, Inc.",
  locationName: "Bard's Inn"
}
```

### Mapping File Enhancement
**Option 1**: Parse existing format "10006-654"
- Split on "-" to get prefix and internal ID

**Option 2**: Add columns to Excel mapping file
- Column: `Account Prefix` (e.g., "10006")
- Column: `Internal ID` (e.g., "654")

**Recommendation**: Use Option 1 initially, offer Option 2 if parsing issues arise.

---

## 🔧 Implementation Steps

### Phase 1: File Structure & Configuration
1. Create `PropertyConfigService` to manage property-specific data
2. Split `JEStatCSVGenerator` into:
   - `JournalEntryGenerator` (JE file)
   - `StatisticalEntryGenerator` (StatJE file)
3. Update `FileProcessor` to generate TWO separate S3 uploads
4. Ensure only ONE header row per file type

### Phase 2: Column Fixes
1. Update Entry ID generation to include location internal ID
2. Implement property-specific subsidiary name lookup
3. Implement property-specific subsidiary ID lookup
4. Split account number into prefix and internal ID
5. Fix location ID to be property-specific
6. Update comment field to pull from Daily Report description

### Phase 3: Credit Card Processing
1. Update `AccountLineParser` to identify and extract first-page summary totals
2. Create credit card bundling logic:
   - Bundle VISA/MASTER + DISCOVER
   - Keep AMEX separate
3. Generate deposit rows using bundled totals
4. Ensure Payment Type column only populates for credit cards

### Phase 4: Debit/Credit Logic
1. Analyze account code ranges to determine natural debit/credit
2. Create account type classification system:
   - Assets (10xxx): Natural debit
   - Liabilities (20xxx): Natural credit
   - Revenue (40xxx): Natural credit
   - Statistical (90xxx): N/A
3. Update transformation engine to apply correct multipliers
4. Test against 8 specific row examples from feedback

### Phase 5: Testing & Validation
1. Test with Bard's Inn data (sample we have)
2. Verify output matches `3_26_2025JE.csv` and `3_26_2025StatJE.csv` exactly
3. Test with multiple properties in one file
4. Test with multiple days in one file
5. Validate all column mappings
6. Validate all debit/credit signs

---

## 📊 Success Criteria

### File Format
- ✅ Two separate files generated per run
- ✅ JE file contains only financial transactions
- ✅ StatJE file contains only statistical metrics
- ✅ ONE header row per file (no repeating)
- ✅ Multiple properties/days properly separated by Entry ID

### Column Accuracy
- ✅ All 12 JE columns match sample format exactly
- ✅ All 12 StatJE columns match sample format exactly
- ✅ Account numbers properly split (prefix vs internal ID)
- ✅ Property-specific IDs and names populated correctly

### Credit Card Processing
- ✅ Two credit card deposit rows per property
- ✅ VISA/MASTER + DISCOVER combined correctly
- ✅ AMEX separate
- ✅ Amounts match first-page summary totals

### Debit/Credit Logic
- ✅ All 8 specific row examples match sample
- ✅ Revenue accounts show as credits
- ✅ Asset accounts show as debits
- ✅ No inverted multipliers

### Business Logic
- ✅ NetSuite can import JE file successfully
- ✅ NetSuite can import StatJE file successfully
- ✅ Accounting team can reconcile credit card deposits easily
- ✅ All properties process correctly with their specific IDs

---

## 🚨 Critical Notes

1. **Separate Files**: NetSuite CSV importer can only handle one entry type at a time
2. **Single Header**: Column headers cannot repeat within a file
3. **Credit Cards**: MUST use first-page totals, not individual transactions
4. **Bundling**: VISA/MASTER + DISCOVER together for easier reconciliation
5. **Property IDs**: Each property needs its own configuration for IDs and names
6. **Multipliers**: Current logic is inverting many debit/credit values

---

## 📝 Questions for Hotel Contact

1. Can you provide the complete list of:
   - Property names
   - Location Internal IDs
   - Subsidiary Internal IDs
   - Subsidiary full names

2. Would you like us to add separate columns in the VisualMatrix mapping file for account prefix and internal ID, or should we continue parsing the "10006-654" format?

3. Are there specific account code ranges that should always be debits vs credits, or should we infer from the account type?

4. For statistical entries, do the same property-specific rules apply?

---

## 🎯 Next Steps

1. ✅ Create this implementation plan
2. ⏳ Wait for property configuration data from hotel contact
3. ⏳ Begin Phase 1: File structure changes
4. ⏳ Implement phases 2-4 sequentially
5. ⏳ Test and validate with real data
6. ⏳ Deploy and have hotel contact verify NetSuite import

---

## Timeline Estimate

- **Phase 1**: 2-3 hours (file structure, config service)
- **Phase 2**: 2-3 hours (column fixes)
- **Phase 3**: 2-3 hours (credit card processing)
- **Phase 4**: 3-4 hours (debit/credit logic + testing)
- **Phase 5**: 2-3 hours (comprehensive testing)

**Total**: ~12-16 hours of development + testing

**Dependencies**: Property configuration data from hotel contact

