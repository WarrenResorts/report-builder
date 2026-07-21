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
| Target output (NetSuite JE) | `2026-06-14_JE.csv` | Same JE CSV shape as all other pipelines: `Entry`, `Date`, `Sub Name`, `Subsidiary`, `acctnumber`, `internal id`, `location`, `account name`, `Debit`, `Credit`, `Comment`, `Payment Type`. `Sub Name` uses the common hotel name (e.g. `Comfort Inn Missoula`), not the full legal subsidiary name. |
| Target output (NetSuite StatJE) | `2026-06-14_StatJE.csv` | Same StatJE CSV shape as all other pipelines. A trailing zero-value row (Occy, ADR, or RevPAR) is appended **only if** a real value for that GL code wasn't already emitted — see [Transformation rules](#transformation-rules) below. |
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

**Mapping file discovery:** `file-processor`'s Visual Matrix mapping loader (`loadVisualMatrixMapping`) explicitly excludes the `choice/` and `opera/` prefixes when scanning the mapping bucket for the newest `.xlsx`/`.xls`/`.csv` file. Without that exclusion, uploading a Choice mapping file can be picked up as the Visual Matrix mapping (whichever file has the newest `LastModified` wins), which breaks all Visual Matrix report processing with a `Sheet "VisualMatrix" not found` error. If a fourth mapping type is ever added, its prefix must be added to that same exclusion list.

---

## Transformation rules

Implemented in `src/choice/choice-transformation.ts`.

### Combined Visa/MasterCard/Discover row (JE)

`VI`, `MC`, and `DS` transaction codes are combined into a single `"Visa/MC/Discover"` JE line (mirroring the existing convention in `credit-card-processor.ts` for Visual Matrix and `opera-transformation.ts` for Opera) so the hotel's accounting system can auto-match the combined amount to the bank deposit. American Express (`AX`) is always kept on its own line.

Combining only happens when **2 or more** of the three codes are present in the Journal Summary file **and** they all resolve to the same GL account for the property. If either condition fails (e.g. only one of the three codes appears that day, or they map to different accounts), each code falls back to its own row — the combining logic can never silently merge amounts into the wrong account. If the combined amount nets to exactly zero, no row is emitted at all.

### Conditional trailing StatJE rows

Occy (`90002-419`), ADR (`90001-418`), and RevPAR (`90003-420`) are required placeholder rows for the NetSuite StatJE import — but the mapping normally provides real values for all three every day. A trailing zero-value row is appended for one of these three GL codes **only if** a real (mapped) value for that exact GL code wasn't already emitted earlier in the same run. This is a safety net for a missing mapping/stats column, not a row that should ever duplicate a real value — a previous version of this logic always appended all three, which produced duplicate zero-value Occy/ADR/RevPAR rows alongside the real ones (fixed July 2026 after hotel feedback).

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

### Override-sender bypass

Senders listed in the `email/override-sender` SSM parameter (used to bypass duplicate-detection for testing/reprocessing) can forward a Choice Hotels ZIP from their own email address without needing `__choice__` mapped for that address. `resolvePropertySlugForZip` checks whether the sender is on the override list **and** the ZIP filename matches `CHOICE_ZIP_CODE_PATTERN` before falling through to filename-based Choice routing; otherwise a non-Choice ZIP from an override sender is routed by the sender's own mapped slug as usual.

### `adm-zip` Lambda bundling

`adm-zip` uses CommonJS `require("fs")` internally, which is incompatible with the `email-processor` Lambda's ESM bundling. It must be listed in `nodeModules` in `infrastructure/lib/constructs/lambda-construct.ts` so it's installed as a separate dependency rather than bundled — removing it from that list will break `email-processor` in a way that isn't caught by unit tests (it only surfaces as a runtime `Dynamic require of "fs" is not supported` error).

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
3. **file-processor Lambda** (1 PM MST EventBridge trigger) — Detects Choice files by filename pattern via `getChoiceFileType` (`Hotel Statistics_*.csv`, `Hotel Journal Summary_*.csv`); bypasses the standard `csv-parser` and feeds raw UTF-8 content to the Choice parsers directly. The regex matches **both spaces and underscores** between words (`hotel[ _]statistics`, `hotel[ _]journal[ _]summary`), because `email-processor`'s `sanitizeFilename()` replaces spaces with underscores before the file is stored in S3 — matching on spaces only would cause every Choice file to go undetected and be silently skipped.
4. **Pairing** — `processChoiceFilePairs` matches the `hotel-statistics` and `journal-summary` files for each property + date. If either file is missing, a `MissingChoiceFile` warning is included in the summary email.
5. **Transformation** — `transformJournalSummaryToJERecords` maps `Transaction Code` values (and the three ledger column sums) to NetSuite GL lines, combining Visa/MasterCard/Discover into one row where applicable. `transformHotelStatsToStatJERecords` maps Hotel Statistics columns to StatJE lines, then appends a trailing zero-value row for any of Occy/ADR/RevPAR that wasn't already covered by a real value. See [Transformation rules](#transformation-rules) above for both.
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
