/**
 * @fileoverview Choice Hotels Journal Summary Parser
 *
 * Parses the `Hotel Journal Summary_YYYY-MM-DD.csv` file exported nightly by
 * the Choice Hotels night-audit system.
 *
 * File structure (comma-separated, all fields quoted):
 *   Row 1 — Header: Transaction Code, Postings, Corrections, Adjustments,
 *            Totals, Guest Ledger, AR Ledger, AdvDep Ledger, Transactions,
 *            Post, Corr, Adj
 *   Rows 2..N — One data row per transaction code
 *   Last row  — Footer "*Revenues do not include taxes" (skipped)
 *
 * Negative amounts appear in two formats depending on property:
 *   - Plain negative:       -3,789.05
 *   - Parentheses negative: (3,789.05)
 *
 * Most JE accounts use the value from the "Totals" column.
 * Three special ledger accounts use the *column-sum* across all data rows:
 *   - Guest Ledger  → 10006-654
 *   - AR Ledger     → 10502-2051
 *   - AdvDep Ledger → 24000-263
 */

/** A single transaction code row from the Journal Summary */
export interface JournalSummaryTransaction {
  /** Choice transaction code (e.g. "RM", "AX", "T1") */
  transactionCode: string;
  /** Net amount from the Totals column */
  totals: number;
  /** Amount in the Guest Ledger column (may differ from Totals for split payments) */
  guestLedger: number;
  /** Amount in the AR Ledger column */
  arLedger: number;
  /** Amount in the AdvDep Ledger column */
  advDepLedger: number;
}

/** Parsed Journal Summary file */
export interface JournalSummaryData {
  /** All data rows (footer excluded) */
  transactions: JournalSummaryTransaction[];
  /** Sum of the Guest Ledger column across all rows */
  guestLedgerSum: number;
  /** Sum of the AR Ledger column across all rows */
  arLedgerSum: number;
  /** Sum of the AdvDep Ledger column across all rows */
  advDepLedgerSum: number;
}

/**
 * Parse the raw text content of a `Hotel Journal Summary_*.csv` file.
 *
 * @param rawContent - UTF-8 text content of the file
 * @returns Parsed journal summary data
 * @throws Error if the header row is missing required columns
 */
export function parseJournalSummary(rawContent: string): JournalSummaryData {
  const lines = rawContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("Journal Summary file has no data rows");
  }

  const headerCols = parseCsvRow(lines[0]).map((h) => h.trim());

  const idxCode = headerCols.indexOf("Transaction Code");
  const idxTotals = headerCols.indexOf("Totals");
  const idxGuest = headerCols.indexOf("Guest Ledger");
  const idxAR = headerCols.indexOf("AR Ledger");
  const idxAdvDep = headerCols.indexOf("AdvDep Ledger");

  if (idxCode === -1 || idxTotals === -1 || idxGuest === -1) {
    throw new Error(
      "Journal Summary header is missing required columns " +
        "(Transaction Code, Totals, Guest Ledger)",
    );
  }

  const transactions: JournalSummaryTransaction[] = [];
  let guestLedgerSum = 0;
  let arLedgerSum = 0;
  let advDepLedgerSum = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const code = (cols[idxCode] ?? "").trim();

    // Skip footer row and any blank codes
    if (!code || code.startsWith("*")) continue;

    const totals = parseAmount(cols[idxTotals] ?? "0");
    const guestLedger = parseAmount(cols[idxGuest] ?? "0");
    const arLedger = idxAR !== -1 ? parseAmount(cols[idxAR] ?? "0") : 0;
    const advDepLedger =
      idxAdvDep !== -1 ? parseAmount(cols[idxAdvDep] ?? "0") : 0;

    transactions.push({
      transactionCode: code,
      totals,
      guestLedger,
      arLedger,
      advDepLedger,
    });

    guestLedgerSum += guestLedger;
    arLedgerSum += arLedger;
    advDepLedgerSum += advDepLedger;
  }

  return { transactions, guestLedgerSum, arLedgerSum, advDepLedgerSum };
}

/**
 * Parse a numeric amount that may be formatted as:
 *   - Plain negative:       -3,789.05  or  -162.98
 *   - Parentheses negative: (3,789.05) or  (162.98)
 *   - Plain positive:        8,355.40  or   100
 * Commas are stripped before parsing.
 */
export function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  // Parenthesised negative: (1,234.56) → -1234.56
  const parenMatch = trimmed.match(/^\(([0-9,]+(?:\.[0-9]+)?)\)$/);
  if (parenMatch) {
    return -parseFloat(parenMatch[1].replace(/,/g, ""));
  }

  return parseFloat(trimmed.replace(/,/g, "")) || 0;
}

/**
 * Minimal CSV row parser that handles double-quoted fields containing
 * commas and escaped quotes.  Choice Hotels files quote all fields.
 */
export function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
