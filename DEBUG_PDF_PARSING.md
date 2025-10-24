# PDF Parsing Debug Mode

## Overview
Added comprehensive debugging to the AccountLineParser to diagnose regex pattern matching issues with PDF text extraction.

## What Was Added

### 1. **Startup Logging**
When parsing begins, outputs:
- Total number of lines in PDF
- All active regex patterns being used
- Pattern names and their regex expressions

### 2. **Per-Line Debugging**
For every line being parsed:
- Line number
- Raw text content (with quotes to see exact spacing)
- Line length
- Whether line contains tabs
- **Character codes** (ASCII/Unicode values of each character) - reveals hidden characters, tabs, special spaces

### 3. **Pattern Match Logging**
When a pattern successfully matches:
- Which pattern matched (ledgerLine, paymentMethodLine, etc.)
- The regex capture groups extracted

### 4. **Failed Match Logging**
When NO pattern matches a line:
- Lists all patterns that were tried
- Shows line length
- Shows first 50 and last 50 characters
- Helps identify what we're missing

## How to Use

1. **Deploy the changes** to development
2. **Trigger the Lambda** with a Bard's Inn PDF
3. **Check CloudWatch Logs** for the function

## What to Look For in Logs

### Example Output for a Problematic Line:
```
=== PARSING LINE 42 ===
Raw text: "GL ROOM TAX REV9CITY    $980.63"
Length: 31, Has tabs: false
Character codes: 71,76,32,82,79,79,77,32,84,65,88,32,82,69,86,57,67,73,84,89,32,32,32,32,36,57,56,48,46,54,51
✗ NO PATTERN MATCHED for line 42
  Tried patterns: ledgerLine, paymentMethodLine, summaryLine, embeddedTransactionCode, glClAccountCode, statisticalLine
```

### Key Information:
- **Character codes** show exact spacing (32 = space, 9 = tab)
- Can see if there are multiple spaces, tabs, or special unicode spaces
- Can count exact spacing between elements
- **First/Last 50 chars** help with very long lines

## Next Steps

1. **Collect the debug output** from a real PDF processing run
2. **Analyze the actual spacing patterns** in the PDF text
3. **Write regex that matches the real data** - not assumptions
4. **Test and iterate** until all expected lines are captured

## Example Analysis

If we see:
```
Character codes: 71,76,32,32,32,82,79,79,77
```

This tells us:
- `71,76` = "GL"
- `32,32,32` = THREE spaces (not one!)
- `82,79,79,77` = "ROOM"

We can then adjust our regex to handle multiple spaces: `GL\s{1,5}ROOM` instead of `GL\s+ROOM`

## Files Modified
- `src/parsers/account-line-parser.ts` - Added debug console.log statements (marked with `/* c8 ignore */` to exclude from coverage)

