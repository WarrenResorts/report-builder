/**
 * @fileoverview Opera Transformation
 *
 * Converts parsed Opera trial-balance and stat data into the
 * TransformedJERecord / TransformedStatJERecord shapes consumed by the existing
 * JournalEntryGenerator and StatisticalEntryGenerator.
 *
 * JE rules (from Opera mapping workbook + sample output):
 *   - Each REVENUE / NON REVENUE transaction → credit line via Opera mapping
 *   - PAYMENT transactions → debit line via Opera mapping (Multiplier = -1)
 *   - Direct Billing (TRX_CODE 9002) creates a separate AR City Ledger debit
 *     from the AR_LED_DEBIT column rather than from TB_AMOUNT
 *   - Visa (9004) + MasterCard (9005) share XRefKey "GstPMSMCV" → combined JE line
 *   - INTERNAL transactions → skipped
 *   - TRX_CODEs with Glacct Code = "Not Mapped" → skipped
 *   - Guest Ledger balance (guestLedgerBalance from trial balance summary) →
 *     debit to account 10006-654 as offsetting entry
 *
 * StatJE rules (from sample output):
 *   - Rooms Available  → 90009-789 (from property config roomsAvailable)
 *   - Rooms Sold       → 90006-423 per market segment (all segments, including zeros)
 *   - Occy             → 90002-419 (zero for now — data not reliably available)
 *   - ADR              → 90001-418 (zero for now)
 *   - RevPAR           → 90003-420 (zero for now)
 */

import type { TransformedJERecord } from "../output/journal-entry-generator";
import type { TransformedStatJERecord } from "../output/statistical-entry-generator";
import type { TrialBalanceData } from "./opera-trial-balance-parser";
import type { StatDmySegData } from "./opera-stat-parser";
import type { OperaMapping } from "./opera-mapping-loader";
import type { PropertyConfig } from "../config/property-config";
import { NOT_MAPPED } from "./opera-mapping-loader";

// ------- Fixed GL accounts for special-case JE lines -------

/** Net Guest Ledger balance debit (offsetting entry for the day) */
const GUEST_LEDGER_ACCOUNT = "10006-654";
/** AR City Ledger debit for Direct Billing payments */
const AR_CITY_LEDGER_ACCOUNT = "10502-2051";

/** XRefKey shared by Visa and MasterCard — combine into one "Visa/Master" line */
const VISA_MASTER_XREF = "GstPMSMCV";

// ------- Fixed statistical account codes -------

const STAT_ACCOUNTS = {
  roomsAvailable: { code: "90009-789", name: "Rooms Available" },
  roomsSold: { code: "90006-423", name: "Rooms Sold - Direct Booking" },
  occy: { code: "90002-419", name: "Occy" },
  adr: { code: "90001-418", name: "ADR" },
  revpar: { code: "90003-420", name: "RevPAR" },
};

/**
 * Build JE records from a parsed trial balance + Opera mapping.
 *
 * @returns Array of TransformedJERecord ready for JournalEntryGenerator
 */
export function transformTrialBalanceToJERecords(
  trialBalance: TrialBalanceData,
  operaMapping: OperaMapping,
  _propertyConfig: PropertyConfig,
): TransformedJERecord[] {
  const records: TransformedJERecord[] = [];

  // Accumulate combined Visa/Master amount before adding as single line
  let visaMasterAmount = 0;
  let visaMasterMappingEntry =
    operaMapping.get("9004") ?? operaMapping.get("9005");

  for (const tx of trialBalance.transactions) {
    // Skip INTERNAL transactions entirely
    if (tx.tRXType === "INTERNAL") continue;

    const mappingEntry = operaMapping.get(tx.tRXCode);

    // Skip if no mapping or explicitly not mapped
    if (!mappingEntry || mappingEntry.glAcctCode === NOT_MAPPED) {
      // Special case: Direct Billing (9002) has AR_LED_DEBIT even though it's Not Mapped
      if (tx.tRXCode === "9002" && tx.arLedDebit > 0) {
        records.push({
          sourceCode: tx.tRXCode,
          sourceDescription: tx.description,
          sourceAmount: tx.arLedDebit,
          targetCode: AR_CITY_LEDGER_ACCOUNT,
          targetDescription: "AR - City Ledger",
          mappedAmount: tx.arLedDebit,
          paymentMethod: undefined,
          originalLine: undefined,
        });
      }
      continue;
    }

    // Combine Visa + MasterCard (same XRefKey) into a single line
    if (mappingEntry.xRefKey === VISA_MASTER_XREF) {
      visaMasterAmount += tx.tBAmount * mappingEntry.multiplier;
      visaMasterMappingEntry = mappingEntry;
      continue;
    }

    const mappedAmount = tx.tBAmount * mappingEntry.multiplier;

    // Determine payment type label for credit card entries
    let paymentMethod: string | undefined;
    if (tx.tRXCode === "9003") paymentMethod = "American Express";

    records.push({
      sourceCode: tx.tRXCode,
      sourceDescription: tx.description,
      sourceAmount: tx.tBAmount,
      targetCode: mappingEntry.glAcctCode,
      targetDescription: mappingEntry.glAcctName,
      mappedAmount,
      paymentMethod,
      originalLine: undefined,
    });
  }

  // Emit combined Visa/Master line if any amount accumulated
  if (visaMasterAmount !== 0 && visaMasterMappingEntry) {
    records.push({
      sourceCode: "9004",
      sourceDescription: "Visa/Master",
      sourceAmount: visaMasterAmount,
      targetCode: visaMasterMappingEntry.glAcctCode,
      targetDescription: visaMasterMappingEntry.glAcctName,
      mappedAmount: visaMasterAmount,
      paymentMethod: "Visa/Master",
      originalLine: undefined,
    });
  }

  // Guest Ledger balance line — debit offsetting entry
  if (trialBalance.guestLedgerBalance !== 0) {
    records.push({
      sourceCode: "GUEST_LEDGER",
      sourceDescription: "Guest Ledger",
      sourceAmount: trialBalance.guestLedgerBalance,
      targetCode: GUEST_LEDGER_ACCOUNT,
      targetDescription: "Guest Ledger",
      mappedAmount: trialBalance.guestLedgerBalance,
      paymentMethod: undefined,
      originalLine: undefined,
    });
  }

  return records;
}

/**
 * Build StatJE records from parsed stat data + property config.
 *
 * @returns Array of TransformedStatJERecord ready for StatisticalEntryGenerator
 */
export function transformStatDmySegToStatJERecords(
  statData: StatDmySegData,
  propertyConfig: PropertyConfig,
): TransformedStatJERecord[] {
  const records: TransformedStatJERecord[] = [];

  // Rooms Available (from property config — not in the stat file)
  const roomsAvailable = propertyConfig.roomsAvailable ?? 0;
  records.push({
    sourceCode: STAT_ACCOUNTS.roomsAvailable.code,
    sourceDescription: STAT_ACCOUNTS.roomsAvailable.name,
    sourceAmount: roomsAvailable,
    targetCode: STAT_ACCOUNTS.roomsAvailable.code,
    targetDescription: STAT_ACCOUNTS.roomsAvailable.name,
    mappedAmount: roomsAvailable,
  });

  // Rooms Sold — one row per market segment (including zeros)
  for (const segment of statData.segments) {
    records.push({
      sourceCode: STAT_ACCOUNTS.roomsSold.code,
      sourceDescription: STAT_ACCOUNTS.roomsSold.name,
      sourceAmount: segment.roomsDay,
      targetCode: STAT_ACCOUNTS.roomsSold.code,
      targetDescription: STAT_ACCOUNTS.roomsSold.name,
      mappedAmount: segment.roomsDay,
    });
  }

  // Occy, ADR, RevPAR — zero for now (data not reliably available in stat file)
  records.push({
    sourceCode: STAT_ACCOUNTS.occy.code,
    sourceDescription: STAT_ACCOUNTS.occy.name,
    sourceAmount: 0,
    targetCode: STAT_ACCOUNTS.occy.code,
    targetDescription: STAT_ACCOUNTS.occy.name,
    mappedAmount: 0,
  });

  records.push({
    sourceCode: STAT_ACCOUNTS.adr.code,
    sourceDescription: STAT_ACCOUNTS.adr.name,
    sourceAmount: 0,
    targetCode: STAT_ACCOUNTS.adr.code,
    targetDescription: STAT_ACCOUNTS.adr.name,
    mappedAmount: 0,
  });

  records.push({
    sourceCode: STAT_ACCOUNTS.revpar.code,
    sourceDescription: STAT_ACCOUNTS.revpar.name,
    sourceAmount: 0,
    targetCode: STAT_ACCOUNTS.revpar.code,
    targetDescription: STAT_ACCOUNTS.revpar.name,
    mappedAmount: 0,
  });

  return records;
}
