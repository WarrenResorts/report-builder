/**
 * @fileoverview NetSuite Direct Import — Payload Mapper
 *
 * Pure functions that map this project's existing `TransformedJEData` /
 * `TransformedStatJEData` records (already produced by the transformation
 * engine for every pipeline — Visual Matrix, Opera, Choice Hotels) into
 * NetSuite SuiteTalk REST payload shapes.
 *
 * Deliberately mirrors the debit/credit and statistical-record-detection
 * logic already duplicated between `journal-entry-generator.ts` and
 * `statistical-entry-generator.ts`, for the same reason those two are
 * independent: this mapper has no dependency on the CSV generators and can
 * be wired into the pipeline (or dropped) without touching them.
 */

import { PropertyConfig } from "../config/property-config";
import {
  NetSuiteJELinePayload,
  NetSuiteJournalEntryPayload,
  NetSuiteStatisticalJournalEntryPayload,
  NetSuiteStatJELinePayload,
} from "./netsuite-types";

/**
 * Minimal shape both `TransformedJEData` and `TransformedStatJEData` (and
 * their record types) satisfy. Using a local structural type here — rather
 * than importing the generator classes' types directly — keeps this module
 * decoupled from the CSV generators, matching how file-processor.ts already
 * passes the exact same underlying array to both generators today.
 */
export interface TransformedRecordInput {
  sourceCode: string;
  sourceDescription: string;
  sourceAmount: number;
  targetCode?: string;
  targetDescription?: string;
  mappedAmount?: number;
  paymentMethod?: string;
}

export interface TransformedDataInput {
  propertyId: string;
  propertyName: string;
  reportDate: string; // YYYY-MM-DD
  records: TransformedRecordInput[];
}

const STATISTICAL_KEYWORDS = [
  "ADR",
  "RevPAR",
  "Rooms Sold",
  "OOS",
  "Comps",
  "Occy",
];

/**
 * Checks if a record belongs in the Statistical Journal Entry (90xxx
 * accounts), matching the identical check in both CSV generators.
 */
export function isStatisticalRecord(record: TransformedRecordInput): boolean {
  const accountCode = record.targetCode || record.sourceCode || "";
  if (accountCode.startsWith("90")) {
    return true;
  }

  const description = (record.sourceDescription || "").toUpperCase();
  return STATISTICAL_KEYWORDS.some((keyword) =>
    description.includes(keyword.toUpperCase()),
  );
}

/**
 * Splits a "prefix-suffix" account code, e.g. "10006-654" -> { prefix:
 * "10006", suffix: "654" }. Matches both CSV generators' identical helper.
 */
export function splitAccountCode(accountCode: string): {
  prefix: string;
  suffix: string;
} {
  const parts = accountCode.split("-");
  if (parts.length >= 2) {
    return { prefix: parts[0].trim(), suffix: parts[1].trim() };
  }
  return { prefix: accountCode.trim(), suffix: "" };
}

type AccountType = "asset" | "liability" | "revenue" | "expense" | "unknown";

function getAccountType(accountPrefix: string): AccountType {
  const firstDigit = accountPrefix.charAt(0);
  if (firstDigit === "1") return "asset";
  if (firstDigit === "2") return "liability";
  if (firstDigit === "4") return "revenue";
  if (["5", "6", "7", "8"].includes(firstDigit)) return "expense";
  return "unknown";
}

/**
 * Calculates debit/credit amounts based on account type and sign, matching
 * `JournalEntryGenerator.calculateDebitCredit` exactly so NetSuite ends up
 * with the same debit/credit placement as the CSV we already email.
 */
function calculateDebitCredit(
  accountPrefix: string,
  amount: number,
): { debit: number; credit: number } {
  const absAmount = Math.abs(amount);
  const accountType = getAccountType(accountPrefix);

  let isDebit: boolean;
  switch (accountType) {
    case "asset":
      isDebit = amount >= 0;
      break;
    case "liability":
      isDebit = amount < 0;
      break;
    case "revenue":
      isDebit = amount < 0;
      break;
    case "expense":
      isDebit = amount >= 0;
      break;
    default:
      isDebit = amount >= 0;
  }

  return { debit: isDebit ? absAmount : 0, credit: isDebit ? 0 : absAmount };
}

/**
 * Generates the `externalId` used to upsert a property/day's Journal Entry
 * in NetSuite, mirroring `JournalEntryGenerator`'s entry ID format
 * (`WR{locationId}{YYYYMMDD}`) so the two representations of the same day's
 * data stay traceable to each other.
 */
export function generateJEExternalId(
  locationId: string,
  reportDate: string,
): string {
  return `WR${locationId}${reportDate.replace(/-/g, "")}`;
}

/**
 * Generates the `externalId` used to upsert a property/day's Statistical
 * Journal Entry in NetSuite.
 *
 * Intentionally NOT the same string as the CSV's human-readable
 * `transactionId` field (`MM/DD/YYYY WRH{subsidiaryId}`) — that format
 * contains a space and slashes, which are unsafe in a NetSuite REST URL
 * path segment (`/record/v1/statisticaljournalentry/eid:{externalId}`).
 * This format is ID-safe while still being deterministic per property/day.
 */
export function generateStatJEExternalId(
  subsidiaryId: string,
  reportDate: string,
): string {
  return `WRH${subsidiaryId}${reportDate.replace(/-/g, "")}`;
}

/**
 * Maps a property's transformed data into a NetSuite Journal Entry payload.
 *
 * Returns `null` when there are no non-statistical records — mirrors
 * `JournalEntryGenerator`, which skips (and warns about) properties with no
 * financial records for the day rather than emitting an empty entry.
 */
export function mapToJournalEntryPayload(
  data: TransformedDataInput,
  propertyConfig: PropertyConfig,
): NetSuiteJournalEntryPayload | null {
  const financialRecords = data.records.filter(
    (record) => !isStatisticalRecord(record),
  );

  if (financialRecords.length === 0) {
    return null;
  }

  const items: NetSuiteJELinePayload[] = financialRecords.map((record) => {
    const fullAccountCode = record.targetCode || record.sourceCode || "";
    const { prefix } = splitAccountCode(fullAccountCode);
    const { debit, credit } = calculateDebitCredit(
      prefix,
      record.mappedAmount ?? record.sourceAmount,
    );

    const line: NetSuiteJELinePayload = {
      account: { id: prefix },
      location: { id: propertyConfig.locationInternalId },
    };

    if (debit) line.debit = debit;
    if (credit) line.credit = credit;

    const memo = record.targetDescription || record.sourceDescription;
    if (memo) line.memo = memo;

    return line;
  });

  return {
    externalId: generateJEExternalId(
      propertyConfig.locationInternalId,
      data.reportDate,
    ),
    tranDate: data.reportDate,
    subsidiary: { id: propertyConfig.subsidiaryInternalId },
    memo: `${propertyConfig.propertyName} — ${data.reportDate}`,
    line: { items },
  };
}

/**
 * Maps a property's transformed data into a NetSuite Statistical Journal
 * Entry payload.
 *
 * ⚠️ Best-effort field shape — see the warning on
 * `NetSuiteStatisticalJournalEntryPayload` in netsuite-types.ts. Returns
 * `null` when there are no statistical records for the day.
 */
export function mapToStatisticalJournalEntryPayload(
  data: TransformedDataInput,
  propertyConfig: PropertyConfig,
): NetSuiteStatisticalJournalEntryPayload | null {
  const statisticalRecords = data.records.filter((record) =>
    isStatisticalRecord(record),
  );

  if (statisticalRecords.length === 0) {
    return null;
  }

  const items: NetSuiteStatJELinePayload[] = statisticalRecords.map(
    (record) => {
      const fullAccountCode = record.targetCode || record.sourceCode || "";
      const { prefix } = splitAccountCode(fullAccountCode);
      const amount = Math.abs(record.mappedAmount ?? record.sourceAmount);

      const line: NetSuiteStatJELinePayload = {
        account: { id: prefix },
        amount,
        unit: "Each",
        location: { id: propertyConfig.locationInternalId },
      };

      const memo = record.targetDescription || record.sourceDescription;
      if (memo) line.memo = memo;

      return line;
    },
  );

  return {
    externalId: generateStatJEExternalId(
      propertyConfig.subsidiaryInternalId,
      data.reportDate,
    ),
    tranDate: data.reportDate,
    subsidiary: { id: propertyConfig.subsidiaryInternalId },
    memo: `${propertyConfig.propertyName} — ${data.reportDate}`,
    line: { items },
  };
}
