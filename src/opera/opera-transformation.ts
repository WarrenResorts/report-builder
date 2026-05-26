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
 *   - Visa (9004) + MasterCard (9005) share XRefKey "GstPMSMCV" → combined JE line
 *   - INTERNAL transactions → skipped
 *   - TRX_CODEs with Glacct Code = "Not Mapped" → skipped
 *   - Summary block entries (CS_ / CF_ / CP_ codes from TrialBalanceData.summaryEntries)
 *     are looked up in the mapping and grouped by XRef Key (or glAcctCode when no XRef
 *     Key is set). Within each group the values are netted (multiplier applied per entry)
 *     and one JE line is emitted per group when the net is non-zero. This drives:
 *       • Guest Ledger (10006-654): CS_GUEST_LED_DEBIT_REP + CS_GUEST_LED_CREDIT_REP
 *       • AR City Ledger (10502-2051): CS_AR_LED_DEBIT_REP + CS_AR_LED_CREDIT_REP  (XRef "GstXfer")
 *       • Deferred Revenue (24000-263): CS_DEPOSIT_LED_DEBIT_REP + CS_DEPOSIT_LED_CREDIT_REP (XRef "AdvDepToGstLedger")
 *     The mapping spreadsheet controls which CS_ codes are included and which account
 *     they map to. Multiplier must be set correctly per account type in the spreadsheet
 *     (assets: 1, liabilities: -1) so the JE generator places amounts in the right column.
 *
 * StatJE rules (from sample output):
 *   - Rooms Available  → 90009-789 (from property config roomsAvailable)
 *   - Rooms Sold       → 90006-423 per market segment (all segments, including zeros)
 *   - ADR              → 90001-418  = Room Revenue ÷ Rooms Sold
 *   - Occy             → 90002-419  = Rooms Sold ÷ roomsAvailable  (as decimal, e.g. 0.6538)
 *   - RevPAR           → 90003-420  = Room Revenue ÷ roomsAvailable
 *   ADR/Occy/RevPAR are calculated from trial balance data when provided; otherwise zero.
 *   Room Revenue = sum of TB_AMOUNT for TRX_CODEs in ROOM_REVENUE_TRX_CODES.
 */

import type { TransformedJERecord } from "../output/journal-entry-generator";
import type { TransformedStatJERecord } from "../output/statistical-entry-generator";
import type { TrialBalanceData } from "./opera-trial-balance-parser";
import type { StatDmySegData } from "./opera-stat-parser";
import type { OperaMapping, OperaMappingEntry } from "./opera-mapping-loader";
import type { PropertyConfig } from "../config/property-config";
import { NOT_MAPPED } from "./opera-mapping-loader";

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
 * Opera TRX_CODEs that contribute to Room Revenue for ADR / RevPAR calculations.
 * All of these map to account 40110-634 (Revenue - Direct Booking) in the mapping
 * spreadsheet. Confirmed by hotel accounting team.
 */
const ROOM_REVENUE_TRX_CODES = new Set([
  "1000",
  "1005",
  "1007",
  "1008",
  "1025",
  "1026",
  "1309",
  "1310",
  "1334",
  "1335",
]);

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

  // --- Block 1: regular transaction rows ---
  for (const tx of trialBalance.transactions) {
    // Skip INTERNAL transactions entirely
    if (tx.tRXType === "INTERNAL") continue;

    const mappingEntry = operaMapping.get(tx.tRXCode);

    // Skip if no mapping or explicitly not mapped
    if (!mappingEntry || mappingEntry.glAcctCode === NOT_MAPPED) continue;

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

  // --- Block 2: summary block entries (CS_ / CF_ / CP_ codes) ---
  // Group entries by XRef Key (or glAcctCode when no XRef Key is set), net the
  // values within each group (multiplier applied per entry), and emit one JE line
  // per group when the net is non-zero.
  const summaryGroups = new Map<
    string,
    { netAmount: number; mappingEntry: OperaMappingEntry }
  >();

  for (const [csCode, csValue] of trialBalance.summaryEntries) {
    const mappingEntry = operaMapping.get(csCode);
    if (!mappingEntry || mappingEntry.glAcctCode === NOT_MAPPED) continue;

    const groupKey = mappingEntry.xRefKey || mappingEntry.glAcctCode;
    const contribution = csValue * mappingEntry.multiplier;
    const existing = summaryGroups.get(groupKey);
    if (existing) {
      existing.netAmount += contribution;
    } else {
      summaryGroups.set(groupKey, { netAmount: contribution, mappingEntry });
    }
  }

  for (const [, group] of summaryGroups) {
    if (group.netAmount === 0) continue;
    records.push({
      sourceCode: group.mappingEntry.glAcctCode,
      sourceDescription: group.mappingEntry.glAcctName,
      sourceAmount: group.netAmount,
      targetCode: group.mappingEntry.glAcctCode,
      targetDescription: group.mappingEntry.glAcctName,
      mappedAmount: group.netAmount,
      paymentMethod: undefined,
      originalLine: undefined,
    });
  }

  return records;
}

/**
 * Build StatJE records from parsed stat data, property config, and optionally
 * trial balance data (required for ADR / Occy / RevPAR calculation).
 *
 * When trialBalance is supplied and roomsAvailable is configured, ADR, Occy,
 * and RevPAR are computed from that day's transactions; otherwise zero is used.
 *
 * @returns Array of TransformedStatJERecord ready for StatisticalEntryGenerator
 */
export function transformStatDmySegToStatJERecords(
  statData: StatDmySegData,
  propertyConfig: PropertyConfig,
  trialBalance?: TrialBalanceData,
): TransformedStatJERecord[] {
  const records: TransformedStatJERecord[] = [];

  const roomsAvailable = propertyConfig.roomsAvailable ?? 0;
  const roomsSold = statData.totalRoomsOccupied;

  // Calculate room revenue, ADR, Occy, RevPAR when trial balance is available
  let adr = 0;
  let occy = 0;
  let revpar = 0;

  if (trialBalance && roomsAvailable > 0) {
    const roomRevenue = trialBalance.transactions
      .filter((tx) => ROOM_REVENUE_TRX_CODES.has(tx.tRXCode))
      .reduce((sum, tx) => sum + tx.tBAmount, 0);

    adr = roomsSold > 0 ? roomRevenue / roomsSold : 0;
    occy = roomsSold / roomsAvailable;
    revpar = roomRevenue / roomsAvailable;
  }

  // Rooms Available (from property config — not in the stat file)
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

  records.push({
    sourceCode: STAT_ACCOUNTS.adr.code,
    sourceDescription: STAT_ACCOUNTS.adr.name,
    sourceAmount: adr,
    targetCode: STAT_ACCOUNTS.adr.code,
    targetDescription: STAT_ACCOUNTS.adr.name,
    mappedAmount: adr,
  });

  records.push({
    sourceCode: STAT_ACCOUNTS.occy.code,
    sourceDescription: STAT_ACCOUNTS.occy.name,
    sourceAmount: occy,
    targetCode: STAT_ACCOUNTS.occy.code,
    targetDescription: STAT_ACCOUNTS.occy.name,
    mappedAmount: occy,
  });

  records.push({
    sourceCode: STAT_ACCOUNTS.revpar.code,
    sourceDescription: STAT_ACCOUNTS.revpar.name,
    sourceAmount: revpar,
    targetCode: STAT_ACCOUNTS.revpar.code,
    targetDescription: STAT_ACCOUNTS.revpar.name,
    mappedAmount: revpar,
  });

  return records;
}
