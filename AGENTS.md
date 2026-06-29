# Agent Rules & Project Context

This file is the single source of truth for any AI agent working on this codebase. Read it in full at the start of every session. Also read `PROJECT_PLAN.md` for the feature roadmap and `docs/` for pipeline-specific reference.

---

## 🚨 Hard Rules — Never Break These

### Git & Commits
- **Never** run `git add`, `git commit`, or `git push` without explicit instruction from the user.
- After completing changes, state what is ready and **stop**. Wait for the user to say "commit" and/or "push".
- This applies even when changes are fully verified and tests pass.
- **Never push directly to `main`**. All changes go through a PR, no exceptions. The repo has branch protection but admin bypass is enabled — do not use it.
- Always create a feature/chore branch, push it, and open a PR via `gh pr create`.

### Making Changes
- **Never make code changes without explicit approval.** If the user asks you to investigate or assess something, do that and present findings. Wait for a "go ahead" before touching any files.
- When asked to research or analyze, present your findings and stop.
- Never run speculative or exploratory AWS commands that create, modify, or delete resources.

### AWS Operations
- **Always run `aws sts get-caller-identity` before any AWS create/update/delete operation** to confirm you are in the correct account.
- Two AWS accounts exist:
  - **Dev**: profile `dev-account` → account `237124340260`
  - **Prod**: profile `prod-account` → account `400534944857`
- SSM parameters follow the pattern `/report-builder/{environment}/...`
- Never assume which profile is active — always verify first.

### Code Quality — Before Declaring Changes Ready
Always run all four checks in sequence:
```bash
npm run build
npm run lint
npm run format:check
npm test
```
- Never lower coverage thresholds.
- Fix any errors (not warnings) before declaring ready.
- Run `npx better-npm-audit audit --level high` to verify the security audit passes locally before pushing — do not let CI be the first to catch audit failures.

---

## 📋 PR Requirements

Every PR must pass these checks or CI will fail:

### Title
Must follow [Conventional Commits](https://www.conventionalcommits.org/): `type: description` where type is one of `feat`, `fix`, `chore`, `docs`, `build`, `ci`, `refactor`, `test`. Subject must not start with uppercase.

### Description
Must contain all three sections exactly as written:
```
## What
## Why
## Testing
```
Missing any one of these causes `PR Validation` to fail.

### Security Scan
Runs `npx better-npm-audit audit --level high`. Only `high` and `critical` vulnerabilities block the build. The `.nsprc` file contains exclusions for high-severity issues that are genuinely unexploitable in this pipeline (currently: `tmp` via `exceljs`). Run the audit locally before pushing — if the advisory ID for a known exclusion has changed (npm re-issues advisories), update `.nsprc` before committing.

---

## 📦 Dependency Update Process

When Dependabot PRs are open:
1. **Research first** — check the changelog for every package before updating. Look for breaking API changes.
2. **Consolidate** — close all individual Dependabot PRs and do all updates in one branch (`chore/update-dependencies-{month-year}`).
3. **Update peer dependencies together** — packages like `vitest` and `@vitest/coverage-v8` are a matched pair and must be updated to the same version simultaneously. Using `--legacy-peer-deps` to work around conflicts creates an inconsistent lock file that breaks `npm ci` in CI.
4. **Verify the lock file** — always run `npm ci` locally after updating to confirm the lock file is clean.
5. **Run the full audit check** locally (`npx better-npm-audit audit --level high`) before pushing.
6. **`pdf-parse`** — do NOT update to v2. v2 is a breaking migration (class-based API, no `pagerender` callback). Tracked in PROJECT_PLAN.md Phase 13. Stay on v1 until a proper migration plan is ready.

---

## 🏗️ System Architecture

### What It Does
Receives daily hotel report emails with file attachments, parses them, transforms the data using GL account mappings, and emails JE (Journal Entry) and StatJE (Statistical Journal Entry) CSV reports to accounting.

### Two Pipelines
1. **Visual Matrix (PDF)** — 11 properties. Emails come in as PDF attachments. Parsed using `pdf-parse` with a custom `pagerender` callback that inserts pipe `|` delimiters for column detection.
2. **Opera / IHG (TXT)** — Currently 1 property (`holiday-inn-express-clover-lane`). IHG sends two `.txt` files per day: `trial_balance_*.txt` and `stat_dmy_seg_*.txt`. See `docs/opera-ihg-pipeline.md`.

### Key AWS Resources
- **Lambda functions**: `report-builder-email-processor-{env}` and `report-builder-file-processor-{env}`
- **S3 buckets** (both environments):
  - `report-builder-incoming-files-{env}-v2` — raw email attachments
  - `report-builder-processed-files-{env}-v2` — generated JE/StatJE reports
  - `report-builder-mapping-files-{env}-v2` — Excel mapping files; Opera files go in `opera/` prefix; Choice files go in `choice/` prefix
- **SSM Parameters** (production account `400534944857`):
  - `/report-builder/production/properties/email-mapping` — JSON mapping sender email → property slug
  - `/report-builder/production/properties/override-email` — if set, all reports route here instead of real recipients; NOT set in production (reports go to real recipients)
- **SES**: Receives inbound email on `aws.warrenresorthotels.com` subdomain; sends outbound reports
- **EventBridge**: Triggers `file-processor` Lambda daily at 1 PM MST

### Property Configuration
All properties are configured in `src/config/property-config.ts`. Each has:
- `propertyId` (slug, matches email-mapping value)
- `subsidiaryId` / `subsidiaryFullName` (NetSuite)
- `locationId`, `accountingPeriod`, `recipientEmails`
- `roomsAvailable` (Opera properties only — used for ADR/Occupancy/RevPAR)
- `choiceMappingName` (Choice Hotels properties only — display name as it appears in the Choice mapping workbook)

### Opera Mapping
- Loaded from the latest `.xlsx` file under `opera/` in the mapping bucket
- Supports **dual mapping**: `Map<string, OperaMappingEntry[]>` — one `TRX_CODE` can produce multiple JE lines
- The mapping file is uploaded manually to S3 when the hotel provides an updated version

### Choice Mapping
- Loaded from the latest `.xlsx` file under `choice/` in the mapping bucket
- 7-column `Choice` sheet: `Src Data Code`, `Src Desc`, `Multiplier`, `Property Name`, `Glacct Code`, `Glacct Name`, `Acct Type`
- Property-specific rows (non-blank `Property Name`) override global rows for that property
- See `docs/choice-hotels-pipeline.md` for full format reference

---

## 🌿 Git Workflow

- `main` — production-ready code, protected, requires PR
- Feature branches: `feature/`, `fix/`, `chore/`, `docs/` prefixes
- The CI/CD guard in `.github/workflows/ci-cd.yml` prevents non-feature Dependabot/chore PRs from deploying to dev when a `feature/` PR is open

### Onboarding a New Property (Visual Matrix)
See `docs/adding-a-new-property.md`.

### Onboarding a New Opera Property
1. Add sender email to SSM `email-mapping` in both dev and prod accounts
2. Add property config to `src/config/property-config.ts` with `roomsAvailable`
3. Upload the Opera mapping XLSX to `opera/` prefix in both mapping buckets

### Onboarding a New Choice Hotels Property
See `docs/choice-hotels-pipeline.md` — Operations section.
1. Add `auto_mail_delivery_system@choicehotels.com` → `__choice__` to SSM `email-mapping` (if not already present)
2. Add `choice:{code}` → property slug to SSM `email-mapping` in both accounts
3. Add property config to `src/config/property-config.ts` with `choiceMappingName`
4. Upload or update the Choice mapping XLSX to `choice/` prefix in both mapping buckets

---

## 📍 Current State (as of June 2026)

### What's Live in Production
- All 11 Visual Matrix (PDF) properties — fully operational
- `holiday-inn-express-clover-lane` (IHG/Opera) — live since June 2026

### Open Branches / PRs
- **PR #184** (`chore/update-dependencies-june-2026`) — June 2026 dependency updates; may still be in CI
- **PR #175** (`fix/pdf-parse-v2` branch) — contains only a docs update (`PROJECT_PLAN.md`); the branch name is misleading, no pdf-parse code changes were made
- **Dependabot PRs #176–#183** — to be closed once PR #184 merges (they are all superseded by it)
- **`feature/choice-hotels-pipeline`** — Choice Hotels pipeline (Phase 14); implementation complete, PR open for review

### Known Technical Debt
- `pdf-parse` v2 migration blocked — see PROJECT_PLAN.md Phase 13
- `tmp` (via `exceljs`) has a recurring high-severity advisory that keeps getting new IDs; exclusion in `.nsprc` needs to be updated each time (`1120654` as of June 2026)

### Next Feature Work
**Phase 14 — Choice Hotels pipeline** (3 properties) — implementation complete on `feature/choice-hotels-pipeline`. Before deploying:
1. Add SSM entries (`__choice__` sentinel + `choice:{code}` lookups) in both dev and prod
2. Upload the Choice mapping XLSX to `choice/` prefix in both mapping buckets
3. Deploy to dev, verify with live data, then production

**Phase 7 — Day-to-Day Comparison Engine** — the next development phase after Phase 14 is deployed.

---

## 📝 Documentation Maintenance

When making changes that affect:
- **Visual Matrix PDF pipeline** (email routing, PDF parsing, property config, SSM, SES): update `docs/adding-a-new-property.md`
- **Opera / IHG pipeline** (parsers, mapping format, S3 prefix, slug config): update `docs/opera-ihg-pipeline.md` and `PROJECT_PLAN.md` Phase 12
- **Project roadmap or completed phases**: update `PROJECT_PLAN.md`
- **These working rules**: update this file (`AGENTS.md`)
