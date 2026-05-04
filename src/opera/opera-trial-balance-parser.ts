/**
 * @fileoverview Opera Trial Balance Parser
 *
 * Parses the `trial_balance*.txt` file exported by Opera PMS.
 *
 * File structure (comma-separated, no quoting):
 *   Block 1 — Header row + transaction rows (one per TRX_CODE)
 *   Block 2 — CHK_BAL_* balance-check rows (key,value pairs; ignored)
 *   Block 3 — Single summary totals row with a different header
 *
 * Business date is taken from the TRX_DATE column of the first transaction row
 * (format "DD-MON-YY", e.g. "07-APR-26").
 *
 * The Guest Ledger balance (CS_TB_AMOUNT_REP from the summary block) becomes
 * the offsetting debit entry in the JE output.
 */

/** Month abbreviation → zero-padded month number */
const MONTH_MAP: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

/** A single transaction row from the trial balance */
export interface TrialBalanceTransaction {
  /** Opera transaction code (e.g. "1000", "9003") */
  tRXCode: string;
  /** Human-readable description (e.g. "*Accommodation", "American Express") */
  description: string;
  /** Category: "REVENUE" | "NON REVENUE" | "PAYMENT" | "INTERNAL" */
  tRXType: string;
  /** Net transaction amount (negative for payments) */
  tBAmount: number;
  /** Business date string in YYYY-MM-DD format */
  tRXDate: string;
  /**
   * A/R ledger debit amount — non-zero for Direct Billing/City Ledger payments.
   * Used to create the AR City Ledger JE debit entry.
   */
  arLedDebit: number;
}

/** Parsed trial balance file */
export interface TrialBalanceData {
  /** Business date in YYYY-MM-DD format (from TRX_DATE of first transaction) */
  businessDate: string;
  /** Individual transaction rows */
  transactions: TrialBalanceTransaction[];
  /**
   * Net Guest Ledger balance for the day (CS_TB_AMOUNT_REP from summary block).
   * This becomes the offsetting Debit to account 10006 in the JE.
   */
  guestLedgerBalance: number;
}

/**
 * Parse the raw text content of a `trial_balance*.txt` file.
 *
 * @param rawContent - UTF-8 text content of the file
 * @returns Parsed trial balance data
 * @throws Error if the file cannot be parsed or no transactions are found
 */
export function parseTrialBalance(rawContent: string): TrialBalanceData {
  const lines = rawContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("Trial balance file has no data rows");
  }

  // --- Block 1: header + transaction rows ---
  // The header is the first non-empty line; it contains "TRX_CODE" and "TRX_DATE"
  const headerLine = lines[0];
  const headers = splitCsvRow(headerLine);

  const idxTRXCode = headers.indexOf("TRX_CODE");
  const idxDescription = headers.indexOf("DESCRIPTION");
  const idxTRXType = headers.indexOf("TRX_TYPE");
  const idxTBAmount = headers.indexOf("TB_AMOUNT");
  const idxTRXDate = headers.indexOf("TRX_DATE");
  const idxARLedDebit = headers.indexOf("AR_LED_DEBIT");

  if (idxTRXCode === -1 || idxTBAmount === -1 || idxTRXDate === -1) {
    throw new Error(
      "Trial balance header is missing required columns (TRX_CODE, TB_AMOUNT, TRX_DATE)",
    );
  }

  const transactions: TrialBalanceTransaction[] = [];
  let businessDate = "";
  let guestLedgerBalance = 0;

  // Three logical blocks in the file:
  //   1. Transaction rows (parsed columns matching the header)
  //   2. CHK_BAL_* balance-check rows (key,value pairs — skipped)
  //   3. Summary block: a second header row starting with "CS_TB_AMOUNT_REP",
  //      followed by a single data row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Block 3: summary header detected
    if (line.startsWith("CS_TB_AMOUNT_REP,") || line === "CS_TB_AMOUNT_REP") {
      const summaryHeaders = splitCsvRow(line);
      const summaryDataLine = lines[i + 1];
      if (summaryDataLine) {
        const summaryValues = splitCsvRow(summaryDataLine);
        const idxBalance = summaryHeaders.indexOf("CS_TB_AMOUNT_REP");
        if (idxBalance !== -1 && summaryValues[idxBalance] !== undefined) {
          guestLedgerBalance = parseFloat(summaryValues[idxBalance]) || 0;
        }
      }
      break;
    }

    // Block 2: CHK_BAL_* rows — skip silently (do NOT break; summary block follows)
    if (line.startsWith("CHK_BAL_")) continue;

    // Block 1: transaction rows
    // Only require enough columns to reach the last needed index; the actual
    // files have many trailing C_* columns that are sparsely populated, so
    // data rows often have far fewer columns than the header.
    const cols = splitCsvRow(line);
    const minRequired =
      Math.max(
        idxTRXCode,
        idxTBAmount,
        idxTRXDate,
        idxDescription,
        idxTRXType,
      ) + 1;
    if (cols.length < minRequired) continue;

    const tRXCode = (cols[idxTRXCode] ?? "").trim();
    const tRXType = (cols[idxTRXType] ?? "").trim();

    if (!tRXCode || /^(CF_|CS_|CP_|CHK_)/.test(tRXCode)) continue;

    const tRXDateRaw = (cols[idxTRXDate] ?? "").trim();
    const parsedDate = parseOperaDate(tRXDateRaw);
    if (!parsedDate) continue;

    if (!businessDate) businessDate = parsedDate;

    const tBAmount =
      parseFloat((cols[idxTBAmount] ?? "0").replace(/,/g, "")) || 0;
    const arLedDebit =
      idxARLedDebit !== -1
        ? parseFloat((cols[idxARLedDebit] ?? "0").replace(/,/g, "")) || 0
        : 0;

    transactions.push({
      tRXCode,
      description: (cols[idxDescription] ?? "").trim(),
      tRXType,
      tBAmount,
      tRXDate: parsedDate,
      arLedDebit,
    });
  }

  if (!businessDate && transactions.length > 0) {
    businessDate = transactions[0].tRXDate;
  }

  if (!businessDate) {
    throw new Error("Could not extract business date from trial balance");
  }

  return { businessDate, transactions, guestLedgerBalance };
}

/**
 * Parse Opera date format "DD-MON-YY" → "YYYY-MM-DD".
 * Returns null for unrecognised formats.
 */
export function parseOperaDate(raw: string): string | null {
  // e.g. "07-APR-26" → "2026-04-07"
  const match = raw.match(/^(\d{1,2})-([A-Z]{3})-(\d{2})$/i);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = MONTH_MAP[match[2].toUpperCase()];
  if (!month) return null;
  const year = `20${match[3]}`;
  return `${year}-${month}-${day}`;
}

/**
 * Minimal CSV row splitter that handles unquoted comma-separated values.
 * Opera trial balance files do not quote fields.
 */
function splitCsvRow(line: string): string[] {
  return line.split(",");
}
