import { describe, it, expect } from "vitest";
import {
  parseJournalSummary,
  parseAmount,
  parseCsvRow,
} from "./choice-journal-summary-parser";

// ─── parseCsvRow ──────────────────────────────────────────────────────────────

describe("parseCsvRow", () => {
  it("parses simple unquoted fields", () => {
    expect(parseCsvRow("AX,0,0,0")).toEqual(["AX", "0", "0", "0"]);
  });

  it("parses quoted fields containing commas", () => {
    expect(parseCsvRow('AX,"-3,789.05",0,0')).toEqual([
      "AX",
      "-3,789.05",
      "0",
      "0",
    ]);
  });

  it("parses escaped double-quotes inside quoted field", () => {
    expect(parseCsvRow('"say ""hello""",next')).toEqual([
      'say "hello"',
      "next",
    ]);
  });

  it("handles empty fields", () => {
    expect(parseCsvRow("a,,c")).toEqual(["a", "", "c"]);
  });

  it("parses fully-quoted row like Choice Hotels header", () => {
    expect(
      parseCsvRow(
        '"Transaction Code","Postings","Corrections","Adjustments","Totals"',
      ),
    ).toEqual([
      "Transaction Code",
      "Postings",
      "Corrections",
      "Adjustments",
      "Totals",
    ]);
  });
});

// ─── parseAmount ─────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  it("parses plain positive amount", () => {
    expect(parseAmount("8355.40")).toBeCloseTo(8355.4);
  });

  it("parses amount with comma separators", () => {
    expect(parseAmount("8,355.40")).toBeCloseTo(8355.4);
  });

  it("parses plain negative amount", () => {
    expect(parseAmount("-3,789.05")).toBeCloseTo(-3789.05);
  });

  it("parses parenthesised negative amount", () => {
    expect(parseAmount("(1,172.25)")).toBeCloseTo(-1172.25);
  });

  it("parses zero", () => {
    expect(parseAmount("0")).toBe(0);
  });

  it("parses empty string as zero", () => {
    expect(parseAmount("")).toBe(0);
  });

  it("parses simple negative without commas", () => {
    expect(parseAmount("-162.98")).toBeCloseTo(-162.98);
  });
});

// ─── parseJournalSummary ─────────────────────────────────────────────────────

describe("parseJournalSummary", () => {
  // Minimal fixture built from the Choice MT118 sample (6/14/2026)
  const FIXTURE = [
    "Transaction Code,Postings,Corrections,Adjustments,Totals,Guest Ledger,AR Ledger,AdvDep Ledger,Transactions,Post,Corr,Adj",
    'AX,"-3,789.05",0,0,"-3,789.05","-3,789.05",0,0,11,11,0,0',
    "CA,-162.98,0,0,-162.98,-162.98,0,0,1,1,0,0",
    'MC,"-4,070.87",0,221.45,"-3,849.42","-3,987.86",0,138.44,14,13,0,1',
    "NS,0,0,-862.16,-862.16,-862.16,0,0,4,0,0,4",
    "PET,100,0,-25,75,75,0,0,5,4,0,1",
    'RM,"8,666.27",0,-310.87,"8,355.40","8,355.40",0,0,56,53,0,3',
    "T1,576.79,0,-24.87,551.92,551.92,0,0,46,43,0,3",
    "T5,212,0,-4,208,208,0,0,54,53,0,1",
    'VI,"-15,331.48",0,694.71,"-14,636.77","-14,814.67",0,177.9,39,34,0,5',
    "*Revenues do not include taxes,,,,,,,,,,,",
    ",,,,,,,,,,,",
  ].join("\n");

  it("parses all transaction codes", () => {
    const result = parseJournalSummary(FIXTURE);
    expect(result.transactions).toHaveLength(9);
    const codes = result.transactions.map((t) => t.transactionCode);
    expect(codes).toEqual([
      "AX",
      "CA",
      "MC",
      "NS",
      "PET",
      "RM",
      "T1",
      "T5",
      "VI",
    ]);
  });

  it("correctly reads Totals column", () => {
    const result = parseJournalSummary(FIXTURE);
    const ax = result.transactions.find((t) => t.transactionCode === "AX")!;
    expect(ax.totals).toBeCloseTo(-3789.05);
    const rm = result.transactions.find((t) => t.transactionCode === "RM")!;
    expect(rm.totals).toBeCloseTo(8355.4);
  });

  it("skips footer row starting with *", () => {
    const result = parseJournalSummary(FIXTURE);
    const codes = result.transactions.map((t) => t.transactionCode);
    expect(codes).not.toContain("*Revenues do not include taxes");
  });

  it("skips blank-code rows", () => {
    const result = parseJournalSummary(FIXTURE);
    expect(result.transactions.every((t) => t.transactionCode !== "")).toBe(
      true,
    );
  });

  it("sums Guest Ledger column correctly", () => {
    const result = parseJournalSummary(FIXTURE);
    // AX:-3789.05 + CA:-162.98 + MC:-3987.86 + NS:-862.16 + PET:75 +
    // RM:8355.40 + T1:551.92 + T5:208 + VI:-14814.67 = -14426.40
    expect(result.guestLedgerSum).toBeCloseTo(-14426.4);
  });

  it("sums AR Ledger column as zero (all zeros in fixture)", () => {
    const result = parseJournalSummary(FIXTURE);
    expect(result.arLedgerSum).toBe(0);
  });

  it("sums AdvDep Ledger column correctly", () => {
    const result = parseJournalSummary(FIXTURE);
    // MC:138.44 + VI:177.9 = 316.34
    expect(result.advDepLedgerSum).toBeCloseTo(316.34);
  });

  it("throws on file with no data rows", () => {
    expect(() => parseJournalSummary("")).toThrow();
    expect(() => parseJournalSummary("Header only row")).toThrow();
  });

  it("throws when required headers are missing", () => {
    const bad = "CodeOnly,SomeOther\nAX,100";
    expect(() => parseJournalSummary(bad)).toThrow(
      /Transaction Code, Totals, Guest Ledger/,
    );
  });

  it("handles Windows CRLF line endings", () => {
    const crlfFixture = FIXTURE.replace(/\n/g, "\r\n");
    const result = parseJournalSummary(crlfFixture);
    expect(result.transactions).toHaveLength(9);
  });
});
