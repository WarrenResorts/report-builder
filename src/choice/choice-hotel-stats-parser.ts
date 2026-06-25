/**
 * @fileoverview Choice Hotels Hotel Statistics Parser
 *
 * Parses the `Hotel Statistics_YYYY-MM-DD.csv` file exported nightly by the
 * Choice Hotels night-audit system.
 *
 * File structure (comma-separated, all fields quoted):
 *   Row 1 — Header row: each column name describes a metric.
 *            The first column is always "Business Date: M/D/YYYY".
 *   Row 2 — Data row: a single row of values corresponding to the headers.
 *
 * The RevPAR column header embeds the business date and changes each night:
 *   e.g. "Occupancy Statistics_RevPar_6/23/2026"
 * Callers should use the exported REVPAR_HEADER_PREFIX to detect this column.
 */

import { parseCsvRow } from "./choice-journal-summary-parser";

/** Pattern prefix for the RevPAR column header (date is appended nightly) */
export const REVPAR_HEADER_PREFIX = "Occupancy Statistics_RevPar_";

/** Parsed Hotel Statistics file */
export interface HotelStatsData {
  /**
   * Business date extracted from the first column header.
   * Format: YYYY-MM-DD.
   */
  businessDate: string;
  /**
   * All column values keyed by their header name.
   * The RevPAR key is normalised — the actual header is stored as-is,
   * so callers can use `getRevParValue()` for lookup.
   */
  columns: Map<string, string>;
}

/**
 * Parse the raw text content of a `Hotel Statistics_*.csv` file.
 *
 * @param rawContent - UTF-8 text content of the file
 * @returns Parsed hotel statistics data
 * @throws Error if the header or data row is missing
 */
export function parseHotelStats(rawContent: string): HotelStatsData {
  const lines = rawContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error(
      "Hotel Statistics file must have a header row and a data row",
    );
  }

  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const values = parseCsvRow(lines[1]).map((v) => v.trim());

  // First column header: "Business Date: 6/23/2026"
  const businessDate = parseBusinessDate(headers[0]);

  const columns = new Map<string, string>();
  for (let i = 0; i < headers.length; i++) {
    columns.set(headers[i], values[i] ?? "");
  }

  return { businessDate, columns };
}

/**
 * Look up the RevPAR value from a stats data map.
 * The RevPAR column header changes each day (it includes the business date),
 * so we scan for the key that starts with `REVPAR_HEADER_PREFIX`.
 *
 * @returns The string value or `undefined` if the column is not present
 */
export function getRevParValue(data: HotelStatsData): string | undefined {
  for (const [key, val] of data.columns.entries()) {
    if (key.startsWith(REVPAR_HEADER_PREFIX)) {
      return val;
    }
  }
  return undefined;
}

/**
 * Parse the business date from the first column header.
 * Input:  "Business Date: 6/23/2026"
 * Output: "2026-06-23"
 *
 * @throws Error if the date cannot be extracted
 */
function parseBusinessDate(header: string): string {
  const match = header.match(/Business Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) {
    throw new Error(
      `Cannot parse business date from Hotel Statistics header: "${header}"`,
    );
  }
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
