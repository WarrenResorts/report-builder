# Duplicate File Detection Feature

## Overview
The file processor now includes automatic duplicate detection and removal to prevent processing the same report multiple times if a property accidentally sends the same file multiple times.

## How It Works

### Detection Logic
Files are considered duplicates if they have:
1. **Same Property ID** - Must be from the same property
2. **Same Filename** - Exact filename match
3. **Same File Size** - Byte-for-byte size match

### Processing Flow
```
1. Query S3 for files from last 24 hours
2. Group files by: property ID + filename + size
3. For each group with multiple files:
   - Sort by LastModified timestamp (most recent first)
   - Keep the most recent file
   - Archive older duplicates to duplicates/ folder
4. Continue normal processing with deduplicated files
```

### What Happens to Duplicates

Duplicates are **NOT deleted** - they are archived for audit purposes:

1. **Original Location**: `daily-files/PROP123/2024-01-15/report.pdf`
2. **Archived To**: `duplicates/PROP123/2024-01-15/2025-10-23T21-30-45-000Z_report.pdf`

Each archived file includes metadata:
- `originalKey`: Original S3 key
- `originalLastModified`: Original upload timestamp
- `markedAsDuplicate`: When it was detected as duplicate
- `reason`: "duplicate_file_detected"

### Logging

The system logs duplicate detection with full details:

```json
{
  "level": "INFO",
  "operation": "duplicate_detection",
  "totalFiles": 5,
  "uniqueFiles": 3,
  "duplicatesFound": 2
}
```

For each duplicate group found:
```json
{
  "level": "INFO",
  "message": "Duplicate files detected",
  "groupKey": "PROP123|report.pdf|1000",
  "totalCount": 3,
  "keepingFile": "daily-files/PROP123/2024-01-15/report.pdf",
  "keepingTimestamp": "2024-01-15T10:10:00Z",
  "duplicateCount": 2,
  "duplicateKeys": ["...", "..."]
}
```

## Example Scenarios

### Scenario 1: Property Sends Report 3 Times
**Files Received:**
- `daily-files/PROP123/2024-01-15/daily-report.pdf` @ 10:00 AM (older)
- `daily-files/PROP123/2024-01-15/daily-report.pdf` @ 10:05 AM (middle)
- `daily-files/PROP123/2024-01-15/daily-report.pdf` @ 10:10 AM (newest)

**Result:**
- ✅ Processes: 10:10 AM version (most recent)
- 📦 Archives: 10:00 AM and 10:05 AM versions

### Scenario 2: Same Filename, Different Sizes
**Files Received:**
- `daily-files/PROP123/2024-01-15/report.pdf` @ 10:00 AM - 1000 bytes
- `daily-files/PROP123/2024-01-15/report.pdf` @ 10:05 AM - 2000 bytes

**Result:**
- ✅ Processes: BOTH files (different sizes = different content)
- 📦 Archives: Nothing

### Scenario 3: Same Filename, Different Properties
**Files Received:**
- `daily-files/PROP123/2024-01-15/report.pdf` @ 10:00 AM
- `daily-files/PROP456/2024-01-15/report.pdf` @ 10:05 AM

**Result:**
- ✅ Processes: BOTH files (different properties)
- 📦 Archives: Nothing

## Benefits

1. **Prevents Double-Counting**: Credit card totals won't be multiplied if the same report is sent 3 times
2. **Saves Processing Time**: Don't parse the same PDF multiple times
3. **Audit Trail**: All duplicates are preserved in the duplicates/ folder
4. **Automatic**: No manual intervention needed
5. **Smart Detection**: Uses file size + filename + property, not just filename

## Configuration

No configuration needed! The feature is automatically enabled.

## Error Handling

If archiving a duplicate fails (e.g., S3 permission issues):
- Error is logged but doesn't stop processing
- Processing continues with the kept file
- Other duplicates are still archived if possible

## Performance Impact

Minimal:
- Duplicate detection: O(n) where n = number of files
- Happens before expensive PDF parsing
- Typically processes in < 100ms for 50 files

