# Adding a New Property

This document covers every step required to onboard a new property that sends a PDF report via email for daily processing.

---

## Overview

The system processes properties in two stages:

1. **Inbound** — The property's PMS (Property Management System) sends a daily email with an attached PDF report. SES receives the email, stores the raw message in S3, and invokes the email processor Lambda, which extracts the attachment and stores it under `daily-files/{propertyId}/{date}/`.

2. **Batch** — EventBridge triggers the file processor Lambda on a schedule. It parses the PDF, looks up the property's NetSuite IDs by name, applies the Visual Matrix account mapping, generates JE and StatJE CSV reports, and emails them to the configured recipients.

Adding a new property requires changes in **three places**: the codebase, AWS SSM Parameter Store, and S3.

> **Note:** A separate **Opera / IHG** pipeline (text exports instead of this PDF flow) is in design. That work is documented in **`docs/opera-ihg-pipeline.md`** and **`PROJECT_PLAN.md`** (Phase 12)—not in this file.

---

## Step 1: Add the Property Config (Code Change)

Open `src/config/property-config.ts` and add an entry to the `PROPERTY_CONFIGURATIONS` array.

```typescript
{
  propertyName: "Your Property Name",        // Must match exactly what the PDF parser extracts
  locationInternalId: "NETSUITE_LOCATION_ID",
  subsidiaryInternalId: "NETSUITE_SUBSIDIARY_ID",
  subsidiaryFullName: "Full Legal Corporation Name",
  locationName: "Short Display Name",
  creditCardDepositAccount: "XXXXX-XXX",     // Cash account code for credit card deposits
},
```

> **Critical:** `propertyName` must match what the PDF parser extracts from the report header verbatim (case-insensitive, but exact wording). If the PDF says `"THE GRAND HOTEL"` and you enter `"Grand Hotel"`, NetSuite IDs will fall back to defaults and the journal entry will be incorrect. Verify by running the PDF through the parser manually before deploying.

**Add a unit test** in `src/config/property-config.test.ts` to confirm the new entry resolves correctly:

```typescript
it("should return config for Your Property Name", () => {
  const service = getPropertyConfigService();
  const config = service.getPropertyConfig("Your Property Name");
  expect(config).toBeDefined();
  expect(config?.locationInternalId).toBe("NETSUITE_LOCATION_ID");
});
```

---

## Step 2: Update SSM Parameter Store

Two parameters need to be updated in AWS Systems Manager Parameter Store.

### 2a. Email-to-Property Mapping

**Parameter path:** `/report-builder/{environment}/properties/email-mapping`  
**Type:** String (JSON)

Add the sender's email address and a unique property slug to the existing JSON object:

```json
{
  "existing-property@example.com": "existing-property-slug",
  "new-property-pms@example.com": "your-new-property-slug"
}
```

The `propertyId` slug determines the S3 folder path (`daily-files/{slug}/`) and should be lowercase, hyphenated, and stable — it does not need to match `propertyName` exactly.

### 2b. Verify Required Email Parameters Exist

Ensure the following parameters are already configured (they are shared across all properties):

| Parameter | Description |
|---|---|
| `/report-builder/{env}/email/incoming-address` | The SES address that receives inbound PMS emails |
| `/report-builder/{env}/email/recipients` | Comma-separated list of addresses to receive the processed report |
| `/report-builder/{env}/email/from-address` | The verified SES sender address |
| `/report-builder/{env}/ses/configuration-set` | SES configuration set name |

> See `PARAMETER_STORE_SETUP.md` for the full parameter reference.

---

## Step 3: Upload the Visual Matrix Mapping File

The file processor uses the **newest** `.xlsx`, `.xls`, or `.csv` file in the mapping files bucket to translate PDF account codes to NetSuite GL accounts.

If the new property uses a different account structure than existing properties, upload an updated mapping file to the mapping files S3 bucket:

```
s3://{project-prefix}-mapping-files-{environment}/
```

The file processor always picks the file with the **latest Last Modified date**, so uploading a new version automatically takes effect on the next run. No code change is required.

---

## Step 4: SES Configuration

### Development / Sandbox

SES sandbox mode restricts sending to **verified identities only**. You must verify:
- The **sender address** (the PMS email that sends the report)
- Any **recipient addresses** that will receive processed reports

Verify via the AWS Console under SES → Verified Identities, or using the AWS CLI:

```bash
aws ses verify-email-identity --email-address pms@example.com
```

### Production

The SES domain identity is configured by CDK during deploy. Ensure DNS records (DKIM/MX/SPF) are in place for the inbound domain. Refer to the CDK stack outputs after deploy for the required DNS values.

---

## Step 5: Run All Checks and Tests

After making code changes, run the full suite locally before opening a PR:

```bash
npm run build
npm run lint
npm run format:check
npm test
```

All 4 checks must pass and coverage thresholds must be met. Do not open a PR until they do.

---

## Step 6: Deploy

```bash
# Development
npm run deploy:dev

# Production (manual workflow dispatch only — requires explicit approval)
npm run deploy:prod
```

CDK will synthesise the infrastructure (no new constructs are added for individual properties — this is data-driven) and deploy any Lambda or IAM changes.

---

## Step 7: End-to-End Verification

Once deployed, verify the full flow:

1. **Send a test email** — Forward a sample PDF from the property's PMS sender address to the configured `incoming-address`. Check the SES receipt rule triggered and the file landed in `s3://{incoming-bucket}/daily-files/{your-new-property-slug}/{date}/`.

2. **Trigger the file processor** — Invoke the file processor Lambda manually via the AWS Console or CLI with a `businessDate` payload:
   ```json
   { "businessDate": "YYYY-MM-DD" }
   ```

3. **Check the processed bucket** — Confirm JE and StatJE CSVs were written to `s3://{processed-bucket}/`.

4. **Confirm the report email** — The configured recipients should receive an email with both CSV attachments.

5. **Validate the JE CSV** — Open the JE CSV and confirm the `locationInternalId` and `subsidiaryInternalId` match the values you entered in `property-config.ts`. If they show placeholder defaults (`"DEFAULT"`, `"9999"`), the `propertyName` in `property-config.ts` does not match what the PDF parser extracted — go back to Step 1.

---

## Checklist Summary

- [ ] Added entry to `PROPERTY_CONFIGURATIONS` in `src/config/property-config.ts`
- [ ] Verified `propertyName` matches PDF parser output exactly
- [ ] Added unit test in `src/config/property-config.test.ts`
- [ ] Updated `/report-builder/{env}/properties/email-mapping` in SSM
- [ ] Verified all shared email SSM parameters exist
- [ ] Uploaded updated Visual Matrix mapping file to S3 (if needed)
- [ ] Verified SES sender and recipient identities (sandbox) or DNS records (production)
- [ ] All local checks pass (`build`, `lint`, `format:check`, `test`)
- [ ] PR opened, CI passes, deployed to development
- [ ] End-to-end verification completed
