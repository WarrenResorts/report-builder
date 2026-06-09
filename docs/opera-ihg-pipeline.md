# Opera / IHG pipeline (technical design)

This document describes the **new** inbound file types, mapping workbook, and implementation notes for properties whose PMS sends **Opera-style daily text exports** instead of a Visual Matrix PDF.

It is **not** the checklist for onboarding another property on the existing PDF pipeline—that remains in **`docs/adding-a-new-property.md`**.

**Ordered implementation steps** live in **`PROJECT_PLAN.md`** (Phase 12).

---

## Reference materials (sample files)

| Role | Example filename | What it is |
|------|------------------|------------|
| Daily inbound (Opera) | `trial_balance5459309.txt` | Trial balance / transaction detail: CSV-style rows with `TRX_CODE`, `DESCRIPTION`, ledger debit/credit columns, `TRX_DATE` (e.g. `07-APR-26`), then additional sections (balance codes, totals) after the main transaction block. |
| Daily inbound (Opera) | `stat_dmy_seg5459310.txt` | Statistical / market-segment style export: CSV-style header with segment codes and day/MTD/YTD room and revenue metrics; segment detail rows plus summary rows at the bottom. |
| Target output (NetSuite JE) | `4_8_2026JE.csv` | Same **JE CSV** shape the batch job already produces: columns such as `Entry`, `Date`, `Sub Name`, `Subsidiary`, `acctnumber`, `internal id`, `location`, `account name`, `Debit`, `Credit`, `Comment`, `Payment Type`. |
| Target output (NetSuite Stat JE) | `4_8_2026StatJE.csv` | Same **Statistical JE CSV** shape as today: statistical `acctNumber` lines (e.g. rooms sold / ADR style accounts) tied to subsidiary and location. |
| **Opera → NetSuite mapping (authoritative)** | `WARRENRESORTS_Opera_2025_02_13_18_40_01.xlsx` | Excel workbook that maps Opera transaction codes to NetSuite GL lines (see [Opera mapping workbook](#opera-mapping-workbook) below). Deploy the latest version under the Opera mapping prefix in the mapping-files bucket when this pipeline is implemented. |

---

## Opera mapping workbook

The file `WARRENRESORTS_Opera_2025_02_13_18_40_01.xlsx` defines the **Opera mapping** format: one worksheet named **`Opera`**, **120 data rows** plus a header row, **22 columns**. It is conceptually similar to the Visual Matrix mapping (source codes → NetSuite GL) but keyed on **Opera** fields, not `Src Acct Code` from PDFs.

**Columns (in order):**

1. `Rec Id` — Row / record identifier in the mapping tool  
2. `System` — Source system (sample rows use `OPERA`)  
3. `TRX_CODE` — Opera transaction code (join key to inbound `trial_balance*.txt` column `TRX_CODE`)  
4. `TRX_TYPE` — Opera category (sample file includes `REVENUE`, `NON REVENUE`, `PAYMENT`, `INTERNAL`)  
5. `SUB_GRP_1`  
6. `Descr` — Opera description (aligns with inbound `DESCRIPTION` on trial balance detail lines; use together with `TRX_CODE` when descriptions need to disambiguate)  
7. `Xref Key`  
8. `Allow User Edit Flag`  
9. `Ignore Mapping`  
10. `Multiplier`  
11. `Acct Id`  
12. `Property Id` — Numeric property id inside the mapping (including `0` for global rows in the sample); **not** the same as the email/S3 **slug** used for `daily-files/{slug}/`  
13. `Property Name`  
14. `Glacct Code` — NetSuite account number stem (e.g. `40110-634`)  
15. `Glacct Suffix` — Internal id suffix when present (e.g. `18`)  
16. `Glacct Name`  
17. `Acct Sub Type Name`  
18. `Acct Type Name`  
19. `Dept Code`  
20. `Dept Name`  
21. `Created`  
22. `Updated`  

**Lookup rule for JE from trial balance:** For each transaction row in the trial balance file, resolve the NetSuite line using **`TRX_CODE`** (required) and optionally **`DESCRIPTION`** ↔ **`Descr`** for validation or disambiguation, then emit debit/credit using the same JE generator conventions as the Visual Matrix path (`Glacct Code` / `Glacct Suffix` → `acctnumber` / `internal id` in the JE CSV).

**Statistical JE (`stat_dmy_seg*.txt`):** This workbook is **transaction-code oriented** and matches the **trial balance** extract. Statistical journal lines (segment / rooms metrics) may need an **additional** mapping artifact (second sheet, second file, or dedicated stat account table) once segment-to-stat-account rules are finalized—the sample `4_8_2026StatJE.csv` still defines the required **output** shape.

---

## End-to-end objective

1. A property’s scheduled sender delivers an email (one or more attachments per business day) to the existing SES inbound address.
2. The **email processor** resolves **property slug** from the sender address via `/report-builder/{env}/properties/email-mapping` and stores attachments under `daily-files/{property-slug}/{date}/`.
3. The **file processor** detects **Opera file types**, parses `trial_balance*.txt` and `stat_dmy_seg*.txt`, loads the **Opera-specific mapping** (not the Visual Matrix mapping), and fills the existing **journal entry** and **statistical entry** generators so outputs match the current JE / StatJE CSV format and delivery behavior (S3 + email to configured recipients).

---

## Property identifier from the sending email

For Opera/IHG, the authoritative hotel identifier for NetSuite config should match the **email-mapping slug** (the value stored under `daily-files/{propertyId}/`), not attachment filenames or the mapping workbook’s `Property Id`.

**Implementation options:**

- **Option A (minimal schema change):** `PROPERTY_CONFIGURATIONS` entries whose `propertyName` equals the email-mapping slug for each Opera property; Opera parsers must **not** overwrite `propertyId` with content from the file.
- **Option B (clearer model):** An explicit field (e.g. `emailSlug` or `inboundPropertyId`) on each config row and resolution in `PropertyConfigService` when the pipeline is Opera/IHG.

Duplicate detection and reporting should use the **same stable string** as the S3 path segment.

---

## Separate mapping storage (vs Visual Matrix)

The Visual Matrix path uses the **newest** `.xlsx` / `.xls` / `.csv` in the mapping-files bucket globally. Opera must use a **separate** selection rule (reserved S3 prefix such as `opera/` or a filename convention) so VM and Opera uploads cannot override each other.

Document the chosen prefix and any new SSM parameters here once implemented.

---

## Engineering checklist (high level)

1. **Attachment handling** — Confirm the email processor accepts Opera attachment extensions (`.txt`, and any others IHG sends); extend allowed types if needed.
2. **Parsers** — Add parsers for `trial_balance*.txt` and `stat_dmy_seg*.txt` (CSV parsing, quoted fields if present, header vs transaction block vs footer sections, business date from `TRX_DATE` or filename + validation).
3. **Pairing** — For a given `propertyId` + calendar folder date, require **both** files when both are expected, or define rules when only one is present.
4. **Mapping layer** — Load the Opera XLSX (columns above); map trial-balance lines to JE line items via `TRX_CODE` / `DESCRIPTION`; add or load a separate stat mapping for `stat_dmy_seg*.txt` → StatJE if not covered by the same file.
5. **Property config resolution** — Wire Opera path to **email slug → NetSuite IDs**; add tests for slug-based resolution.
6. **Routing in `FileProcessor`** — Branch: if file is Opera type, skip `applyVisualMatrixMappings` / VM-only credit-card heuristics where inappropriate; run Opera transform instead.
7. **Operations** — Per Opera property: sender address and slug in SSM `email-mapping`, mapping file in S3 under the Opera prefix, SES identities as required.
