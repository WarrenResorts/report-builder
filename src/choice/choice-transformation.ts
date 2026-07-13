/**
 * @fileoverview Choice Hotels Transformation
 *
 * Converts parsed Journal Summary and Hotel Statistics data into the
 * TransformedJERecord / TransformedStatJERecord shapes consumed by the
 * existing JournalEntryGenerator and StatisticalEntryGenerator.
 *
 * JE transformation rules:
 *  • For most transaction codes the amount comes from the "Totals" column.
 *  • Guest Ledger, AR Ledger, and AdvDep Ledger use the *column sum* across
 *    all rows — these are mapped via special keys in the mapping file.
 *  • The multiplier from the mapping is applied before emitting the record.
 *  • Rows that resolve to CHOICE_NOT_MAPPED or that have zero net amounts
 *    are omitted.
 *
 * StatJE transformation rules:
 *  • Each Statistical mapping entry is looked up against the Hotel Statistics
 *    column map (exact match, except RevPAR which uses prefix matching).
 *  • Percentage values (e.g. "60.66%") are stripped of the "%" before parsing.
 *  • Occupancy, ADR, and RevPAR are required placeholder rows in the NetSuite
 *    StatJE import: a trailing zero row is appended for each of these three
 *    GL codes only if a real (mapped) value wasn't already emitted above —
 *    this is a safety net for a missing mapping/stats column, not a row that
 *    should ever duplicate a real value.
 */

import { JournalSummaryData } from "./choice-journal-summary-parser";
import {
  HotelStatsData,
  getRevParValue,
  REVPAR_HEADER_PREFIX,
} from "./choice-hotel-stats-parser";
import {
  ChoiceMapping,
  ChoiceMappingEntry,
  CHOICE_NOT_MAPPED,
  REVPAR_DATE_PLACEHOLDER,
  findChoiceMappingEntry,
} from "./choice-mapping-loader";
import { TransformedJERecord } from "../output/journal-entry-generator";
import { TransformedStatJERecord } from "../output/statistical-entry-generator";

// ─── Ledger source codes ──────────────────────────────────────────────────────

/** Keys in the mapping file that correspond to Journal Summary ledger column sums */
const LEDGER_KEYS = ["Guest Ledger", "AR Ledger", "AdvDep Ledger"] as const;
type LedgerKey = (typeof LEDGER_KEYS)[number];

// ─── Combined credit card codes ───────────────────────────────────────────────

/**
 * Transaction codes combined into a single "Visa/MC/Discover" JE line, mirroring
 * the existing convention in credit-card-processor.ts (Visual Matrix) and
 * opera-transformation.ts (Opera): these three settle together on the bank
 * statement, so combining them lets the hotel's accounting system auto-match
 * the deposit. American Express is intentionally excluded — it settles
 * separately from the Visa/MC/Discover batch.
 *
 * Combining only happens when 2+ of these codes are present in the Journal
 * Summary file AND all resolve to the same GL account for the property; if
 * either condition fails, each code falls back to its own row (unchanged
 * behavior), so this can never silently merge amounts into the wrong account.
 */
const COMBINED_CARD_CODES = new Set(["VI", "MC", "DS"]);
const COMBINED_CARD_LABEL = "Visa/MC/Discover";

// ─── StatJE trailing rows ─────────────────────────────────────────────────────

/**
 * Placeholder StatJE rows appended after the real stat records, but only for
 * a GL code that wasn't already emitted with a real value. NetSuite expects
 * these rows to be present even when the mapping/stats data is missing them,
 * but the Choice mapping always provides real values for Occy/ADR/RevPAR, so
 * in practice these rows are almost never actually emitted.
 */
const TRAILING_STAT_ROWS: Array<{ glAcctCode: string; glAcctName: string }> = [
  { glAcctCode: "90002-419", glAcctName: "Occy" },
  { glAcctCode: "90001-418", glAcctName: "ADR" },
  { glAcctCode: "90003-420", glAcctName: "RevPAR" },
];

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Transform a parsed Journal Summary into JE records suitable for the
 * JournalEntryGenerator.
 *
 * @param journalSummary - Parsed Journal Summary file
 * @param mapping - Full Choice mapping
 * @param mappingPropertyName - Display name as it appears in the mapping workbook
 *        (e.g. "Comfort Inn - Missoula").  Used to resolve property-specific
 *        cash-in-bank accounts.
 * @returns Array of transformed JE records
 */
export function transformJournalSummaryToJERecords(
  journalSummary: JournalSummaryData,
  mapping: ChoiceMapping,
  mappingPropertyName: string,
): TransformedJERecord[] {
  const records: TransformedJERecord[] = [];

  // ── Combined Visa/MasterCard/Discover row ───────────────────────────────────
  // See COMBINED_CARD_CODES doc comment above for the rationale and fallback
  // conditions. cardsResolveToSameAccount starts true and is only flipped to
  // false if two of the codes resolve to different GL accounts.
  const cardAmounts: number[] = [];
  let combinedCardEntry: ChoiceMappingEntry | undefined;
  let cardsResolveToSameAccount = true;

  for (const tx of journalSummary.transactions) {
    if (!COMBINED_CARD_CODES.has(tx.transactionCode)) continue;

    const entry = findChoiceMappingEntry(
      mapping,
      tx.transactionCode,
      mappingPropertyName,
    );
    if (!entry || entry.glAcctCode === CHOICE_NOT_MAPPED) continue;

    if (
      combinedCardEntry &&
      entry.glAcctCode !== combinedCardEntry.glAcctCode
    ) {
      cardsResolveToSameAccount = false;
    }
    combinedCardEntry = entry;
    cardAmounts.push(tx.totals * entry.multiplier);
  }

  const shouldCombineCards =
    cardsResolveToSameAccount && cardAmounts.length >= 2 && !!combinedCardEntry;

  if (shouldCombineCards && combinedCardEntry) {
    const combinedAmount = cardAmounts.reduce((sum, a) => sum + a, 0);
    if (combinedAmount !== 0) {
      records.push({
        sourceCode: "VI+MC+DS",
        sourceDescription: COMBINED_CARD_LABEL,
        sourceAmount: combinedAmount,
        targetCode: combinedCardEntry.glAcctCode,
        targetDescription: combinedCardEntry.glAcctName,
        mappedAmount: combinedAmount,
        paymentMethod: COMBINED_CARD_LABEL,
      });
    }
  }

  // ── Standard transaction code rows ──────────────────────────────────────────
  for (const tx of journalSummary.transactions) {
    // Visa/MC/Discover are already accounted for in the combined row above.
    if (shouldCombineCards && COMBINED_CARD_CODES.has(tx.transactionCode)) {
      continue;
    }

    const entry = findChoiceMappingEntry(
      mapping,
      tx.transactionCode,
      mappingPropertyName,
    );

    if (!entry) continue;
    if (entry.glAcctCode === CHOICE_NOT_MAPPED) continue;

    const rawAmount = tx.totals * entry.multiplier;
    if (rawAmount === 0) continue;

    const paymentMethod =
      tx.transactionCode === "AX" ? "American Express" : undefined;

    records.push(
      buildJERecord(tx.transactionCode, entry, rawAmount, paymentMethod),
    );
  }

  // ── Ledger column sums ───────────────────────────────────────────────────────
  const ledgerSums: Record<LedgerKey, number> = {
    "Guest Ledger": journalSummary.guestLedgerSum,
    "AR Ledger": journalSummary.arLedgerSum,
    "AdvDep Ledger": journalSummary.advDepLedgerSum,
  };

  for (const key of LEDGER_KEYS) {
    const sum = ledgerSums[key];
    if (sum === 0) continue;

    const entry = findChoiceMappingEntry(mapping, key, mappingPropertyName);
    if (!entry) continue;
    if (entry.glAcctCode === CHOICE_NOT_MAPPED) continue;

    const rawAmount = sum * entry.multiplier;
    if (rawAmount === 0) continue;

    records.push(buildJERecord(key, entry, rawAmount));
  }

  return records;
}

/**
 * Transform parsed Hotel Statistics into StatJE records suitable for the
 * StatisticalEntryGenerator.
 *
 * A trailing zero-value row for Occy, ADR, or RevPAR is appended only when a
 * real record for that GL code wasn't already emitted (see TRAILING_STAT_ROWS
 * doc comment) — real records are never duplicated by a zero-value row.
 *
 * @param statsData - Parsed Hotel Statistics file
 * @param mapping - Full Choice mapping
 * @returns Array of transformed StatJE records (real values + any missing placeholders)
 */
export function transformHotelStatsToStatJERecords(
  statsData: HotelStatsData,
  mapping: ChoiceMapping,
): TransformedStatJERecord[] {
  const records: TransformedStatJERecord[] = [];

  for (const [srcCode, entries] of mapping.entries()) {
    const entry = entries[0]; // Statistical entries are always global (no property filter needed)
    if (!entry || entry.acctType !== "Statistical") continue;
    if (entry.glAcctCode === CHOICE_NOT_MAPPED) continue;

    // Resolve the actual column value from the stats file
    const rawValue = resolveStatColumn(srcCode, statsData);
    if (rawValue === undefined) continue;

    const amount = parseStatAmount(rawValue);
    const mappedAmount = amount * entry.multiplier;

    records.push({
      sourceCode: srcCode,
      sourceDescription: entry.glAcctName,
      sourceAmount: mappedAmount,
      targetCode: entry.glAcctCode,
      targetDescription: entry.glAcctName,
      mappedAmount,
    });
  }

  // Append a trailing zero row for Occy/ADR/RevPAR only when a real record
  // for that GL code wasn't already emitted above. This is a safety net for
  // a missing mapping/stats column — it must never duplicate a real value.
  const emittedTargetCodes = new Set(records.map((r) => r.targetCode));
  for (const { glAcctCode, glAcctName } of TRAILING_STAT_ROWS) {
    if (emittedTargetCodes.has(glAcctCode)) continue;

    records.push({
      sourceCode: glAcctCode,
      sourceDescription: glAcctName,
      sourceAmount: 0,
      targetCode: glAcctCode,
      targetDescription: glAcctName,
      mappedAmount: 0,
    });
  }

  return records;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Build a TransformedJERecord from a mapping entry and computed amount */
function buildJERecord(
  sourceCode: string,
  entry: ChoiceMappingEntry,
  amount: number,
  paymentMethod?: string,
): TransformedJERecord {
  return {
    sourceCode,
    sourceDescription: entry.srcDesc,
    sourceAmount: amount,
    targetCode: entry.glAcctCode,
    targetDescription: entry.glAcctName,
    mappedAmount: amount,
    paymentMethod,
  };
}

/**
 * Resolve the raw string value for a statistical mapping entry.
 *
 * The RevPAR mapping key in the workbook ends with `(Date)`, which is a
 * placeholder for the actual business date embedded in the column header.
 * All other keys must match exactly.
 */
function resolveStatColumn(
  srcCode: string,
  statsData: HotelStatsData,
): string | undefined {
  // RevPAR: strip the (Date) placeholder and use prefix matching
  if (srcCode.endsWith(REVPAR_DATE_PLACEHOLDER)) {
    return getRevParValue(statsData);
  }

  // Otherwise look up by the column's exact header name
  return statsData.columns.get(srcCode);
}

/**
 * Parse a statistical value that may include a trailing "%" character.
 * Examples: "60.66%", "202.52", "37", "0"
 */
export function parseStatAmount(raw: string): number {
  const stripped = raw.trim().replace(/%$/, "");
  return parseFloat(stripped) || 0;
}

/**
 * Derive the RevPAR column header for a given date.
 * Used in tests and documentation.
 *
 * @param businessDate - YYYY-MM-DD format
 * @returns Full column header e.g. "Occupancy Statistics_RevPar_6/23/2026"
 */
export function buildRevParHeader(businessDate: string): string {
  const [year, month, day] = businessDate.split("-");
  // Format: M/D/YYYY (no zero-padding, matching Choice Hotels output)
  return `${REVPAR_HEADER_PREFIX}${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
}
