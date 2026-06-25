# Choice Hotels pipeline (technical design)

This document describes the inbound file types, mapping workbook, and implementation details for properties whose PMS sends **Choice Hotels daily Night Audit reports** as ZIP attachments.

It is **not** the checklist for onboarding a PDF pipeline property—that lives in **`docs/adding-a-new-property.md`**.

---

## Reference materials (file formats)

| Role | Example filename (inside ZIP) | What it is |
|------|-------------------------------|------------|
| Daily inbound — accounting | `Hotel Journal Summary_2026-06-14.csv` | Transaction-level CSV with columns including `Transaction Code`, `Totals`, `Guest Ledger`, `AR Ledger`, `AdvDep Ledger`, and many more. Most JE amounts come from the `Totals` column; the three ledger columns are summed across all rows. |
| Daily inbound — statistics | `Hotel Statistics_2026-06-14.csv` | Single-row CSV (plus a header row) where each column represents an occupancy statistic. Column header names match the mapping's `Src Data Code` keys. The RevPAR column header changes daily: `Occupancy Statistics_RevPar_{M/D/YYYY}`. |
| ZIP wrapper | `All_Night_Audit_Reports_WA244_HOTEL STATS_2026-06-23.zip` | Both CSV files arrive in a single ZIP per property per day, emailed from the shared address `AUTO_MAIL_DELIVERY_SYSTEM@choicehotels.com`. |
| Target output (NetSuite JE) | `2026-06-14_JE.csv` | Same JE CSV shape as all other pipelines: `Entry`, `Date`, `Sub Name`, `Subsidiary`, `acctnumber`, `internal id`, `location`, `account name`, `Debit`, `Credit`, `Comment`, `Payment Type`. |
| Target output (NetSuite StatJE) | `2026-06-14_StatJE.csv` | Same StatJE CSV shape as all other pipelines. Three trailing zero-value rows (Occy, ADR, RevPAR) are always appended after the main stat rows. |
| **Choice → NetSuite mapping** | `choice-mapping.xlsx` | Excel workbook on S3 under the `choice/` prefix. The newest file (by `LastModified`) is always used. See [Choice mapping workbook](#choice-mapping-workbook) below. |

---

## Choice mapping workbook

The workbook contains a single sheet named **`Choice`** with the following seven columns:

| # | Column | Description |
|---|--------|-------------|
| 1 | `Src Data Code` | Source lookup key — matches a `Transaction Code` value in the Journal Summary, a ledger column name (`Guest Ledger`, `AR Ledger`, `AdvDep Ledger`), or a column header from the Hotel Statistics file. For RevPAR the key is `Occupancy Statistics_RevPar_(Date)` where `(Date)` is a literal placeholder. |
| 2 | `Src Desc` | Human-readable description for the mapping entry. |
| 3 | `Multiplier` | Numeric multiplier applied to the source amount before writing to NetSuite (typically `1` or `-1`). |
| 4 | `Property Name` | When blank/null → **global** entry (applies to all properties). When non-blank → **property-specific override** that takes precedence over the global entry for that property. Match is done against `PropertyConfig.choiceMappingName`. |
| 5 | `Glacct Code` | NetSuite account number (e.g. `40110-634`). Empty string is treated as `Not Mapped` and the row is skipped. |
| 6 | `Glacct Name` | NetSuite account name. |
| 7 | `Acct Type` | `Accounting` → JE record; `Statistical` → StatJE record. |

**RevPAR date resolution:** The `(Date)` placeholder in the `Src Data Code` for RevPAR is matched against the actual date-stamped column header in the Hotel Statistics file using the `REVPAR_HEADER_PREFIX` constant (`Occupancy Statistics_RevPar_`).

**Lookup precedence:** property-specific entry → global entry → `undefined` (row skipped).

---

## Inbound ZIP routing

All three Choice Hotels properties share a single sender address: `AUTO_MAIL_DELIVERY_SYSTEM@choicehotels.com`.

### SSM email-mapping entries (both dev and prod)

| Key | Value |
|-----|-------|
| `auto_mail_delivery_system@choicehotels.com` | `__choice__` (sentinel) |
| `choice:mt118` | `comfort-inn-missoula` |
| `choice:or258` | `comfort-inn-suites-ashland` |
| `choice:wa244` | `comfort-inn-suites-spokane-valley` |

### Routing flow (email-processor)

1. SES delivers the email; `email-processor` sees the sender mapped to `__choice__`.
2. The ZIP attachment filename (e.g. `All_Night_Audit_Reports_WA244_HOTEL STATS_2026-06-23.zip`) is matched against `CHOICE_ZIP_CODE_PATTERN` to extract `WA244`.
3. A second SSM lookup using `choice:wa244` resolves the property slug.
4. `adm-zip` extracts each document entry from the ZIP; non-document files and directory entries are skipped.
5. Each valid CSV is stored individually under `daily-files/{propertySlug}/{date}/` in the incoming S3 bucket with `sourceZip` metadata.

---

## Properties

| Property slug | Choice property code | NetSuite subsidiary ID | NetSuite location ID | choiceMappingName |
|---------------|---------------------|------------------------|----------------------|-------------------|
| `comfort-inn-missoula` | MT118 | 37 | 21 | `Comfort Inn - Missoula` |
| `comfort-inn-suites-ashland` | OR258 | 28 | 22 | `Comfort Inn & Suites - Ashland` |
| `comfort-inn-suites-spokane-valley` | WA244 | 30 | 23 | `Comfort Inn & Suites - Spokane Valley` |

---

## End-to-end processing flow

1. **Email received** — SES delivers the daily Night Audit email from `AUTO_MAIL_DELIVERY_SYSTEM@choicehotels.com` to the inbound SES rule.
2. **email-processor Lambda** — Recognises the Choice sentinel, extracts both CSVs from the ZIP, stores them under the property slug.
3. **file-processor Lambda** (1 PM MST EventBridge trigger) — Detects Choice files by filename pattern (`Hotel Statistics_*.csv`, `Hotel Journal Summary_*.csv`); bypasses the standard `csv-parser` and feeds raw UTF-8 content to the Choice parsers directly.
4. **Pairing** — `processChoiceFilePairs` matches the `hotel-statistics` and `journal-summary` files for each property + date. If either file is missing, a `MissingChoiceFile` warning is included in the summary email.
5. **Transformation** — `transformJournalSummaryToJERecords` maps `Transaction Code` values (and the three ledger column sums) to NetSuite GL lines. `transformHotelStatsToStatJERecords` maps Hotel Statistics columns to StatJE lines, then appends three trailing zero-value rows (Occy, ADR, RevPAR).
6. **Output** — `JournalEntryGenerator` and `StatisticalEntryGenerator` write the CSVs to the processed S3 bucket; `ReportEmailSender` emails the reports to the configured recipients.

---

## Source modules

| Module | Location |
|--------|----------|
| Journal Summary parser | `src/choice/choice-journal-summary-parser.ts` |
| Hotel Statistics parser | `src/choice/choice-hotel-stats-parser.ts` |
| Mapping loader | `src/choice/choice-mapping-loader.ts` |
| Transformation | `src/choice/choice-transformation.ts` |
| Barrel export | `src/choice/index.ts` |
| ZIP routing (email-processor) | `src/lambda/email-processor.ts` — `processZipAttachment`, `resolvePropertySlugForZip` |
| File detection & pairing (file-processor) | `src/lambda/file-processor.ts` — `getChoiceFileType`, `processChoiceFilePairs` |

---

## Operations — onboarding a new Choice Hotels property

1. Add the sender address sentinel to SSM `email-mapping` in **both** dev and prod accounts (if not already present):
   - `auto_mail_delivery_system@choicehotels.com` → `__choice__`
2. Add the `choice:{code}` → slug entry to SSM `email-mapping` in both accounts (e.g. `choice:xx000` → `my-new-property`).
3. Add the property config to `src/config/property-config.ts` with the correct `subsidiaryInternalId`, `locationInternalId`, and `choiceMappingName`.
4. Ensure the Choice mapping XLSX in the `choice/` prefix of both mapping buckets includes rows for the new property (property-specific overrides where needed).
5. Deploy to dev, verify, then deploy to prod.
