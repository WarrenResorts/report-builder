import { describe, it, expect } from "vitest";
import {
  transformJournalSummaryToJERecords,
  transformHotelStatsToStatJERecords,
  parseStatAmount,
  buildRevParHeader,
} from "./choice-transformation";
import { parseChoiceMappingWorkbook } from "./choice-mapping-loader";
import { REVPAR_HEADER_PREFIX } from "./choice-hotel-stats-parser";
import type { JournalSummaryData } from "./choice-journal-summary-parser";
import type { HotelStatsData } from "./choice-hotel-stats-parser";
import ExcelJS from "exceljs";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

async function buildMapping(rows: Array<(string | number | null)[]>) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Choice");
  ws.addRow([
    "Src Data Code",
    "Src Desc",
    "Multiplier",
    "Property Name",
    "Glacct Code",
    "Glacct Name",
    "Acct Type",
  ]);
  for (const row of rows) ws.addRow(row);
  const buf = Buffer.from(await workbook.xlsx.writeBuffer());
  return parseChoiceMappingWorkbook(buf);
}

// ─── parseStatAmount ─────────────────────────────────────────────────────────

describe("parseStatAmount", () => {
  it("strips percent sign", () => {
    expect(parseStatAmount("60.66%")).toBeCloseTo(60.66);
  });

  it("parses plain decimal", () => {
    expect(parseStatAmount("202.52")).toBeCloseTo(202.52);
  });

  it("parses integer", () => {
    expect(parseStatAmount("37")).toBe(37);
  });

  it("returns 0 for empty string", () => {
    expect(parseStatAmount("")).toBe(0);
  });
});

// ─── buildRevParHeader ────────────────────────────────────────────────────────

describe("buildRevParHeader", () => {
  it("strips leading zeros from month and day", () => {
    expect(buildRevParHeader("2026-06-14")).toBe(
      `${REVPAR_HEADER_PREFIX}6/14/2026`,
    );
  });

  it("handles single-digit month/day", () => {
    expect(buildRevParHeader("2026-01-05")).toBe(
      `${REVPAR_HEADER_PREFIX}1/5/2026`,
    );
  });
});

// ─── transformJournalSummaryToJERecords ───────────────────────────────────────

describe("transformJournalSummaryToJERecords", () => {
  const MISSOULA = "Comfort Inn - Missoula";

  const baseSummary: JournalSummaryData = {
    transactions: [
      {
        transactionCode: "RM",
        totals: 8355.4,
        guestLedger: 8355.4,
        arLedger: 0,
        advDepLedger: 0,
      },
      {
        transactionCode: "AX",
        totals: -3789.05,
        guestLedger: -3789.05,
        arLedger: 0,
        advDepLedger: 0,
      },
      {
        transactionCode: "T1",
        totals: 551.92,
        guestLedger: 551.92,
        arLedger: 0,
        advDepLedger: 0,
      },
    ],
    guestLedgerSum: -14426.4,
    arLedgerSum: 0,
    advDepLedgerSum: 316.34,
  };

  it("emits a JE record for a globally mapped transaction code", async () => {
    const mapping = await buildMapping([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records).toHaveLength(1);
    expect(records[0].targetCode).toBe("40110-634");
    expect(records[0].mappedAmount).toBeCloseTo(8355.4);
    expect(records[0].sourceDescription).toBe("ROOM CHARGE");
  });

  it("applies the multiplier from the mapping", async () => {
    const mapping = await buildMapping([
      [
        "AX",
        "AMERICAN EXPRESS",
        -1,
        MISSOULA,
        "10190-718",
        "Cash",
        "Accounting",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records).toHaveLength(1);
    // -3789.05 × -1 = 3789.05
    expect(records[0].mappedAmount).toBeCloseTo(3789.05);
  });

  it("resolves property-specific entry over global entry", async () => {
    const mapping = await buildMapping([
      ["AX", "AMEX", -1, MISSOULA, "10190-718", "CashMis", "Accounting"],
      [
        "AX",
        "AMEX",
        -1,
        "Comfort Inn & Suites - Ashland",
        "10090-701",
        "CashAsh",
        "Accounting",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records[0].targetCode).toBe("10190-718");
  });

  it("skips transactions with zero net amount after multiplier", async () => {
    const zeroSummary: JournalSummaryData = {
      transactions: [
        {
          transactionCode: "RM",
          totals: 0,
          guestLedger: 0,
          arLedger: 0,
          advDepLedger: 0,
        },
      ],
      guestLedgerSum: 0,
      arLedgerSum: 0,
      advDepLedgerSum: 0,
    };
    const mapping = await buildMapping([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
    ]);
    expect(
      transformJournalSummaryToJERecords(zeroSummary, mapping, MISSOULA),
    ).toHaveLength(0);
  });

  it("skips unmapped transaction codes", async () => {
    const mapping = await buildMapping([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
    ]);
    const summaryWithUnmapped: JournalSummaryData = {
      ...baseSummary,
      transactions: [
        {
          transactionCode: "RM",
          totals: 100,
          guestLedger: 100,
          arLedger: 0,
          advDepLedger: 0,
        },
        {
          transactionCode: "UNKNOWN",
          totals: 50,
          guestLedger: 50,
          arLedger: 0,
          advDepLedger: 0,
        },
      ],
    };
    const records = transformJournalSummaryToJERecords(
      summaryWithUnmapped,
      mapping,
      MISSOULA,
    );
    expect(records.map((r) => r.sourceCode)).not.toContain("UNKNOWN");
  });

  it("skips transaction code mapped to CHOICE_NOT_MAPPED", async () => {
    const mapping = await buildMapping([
      ["RM", "ROOM CHARGE", 1, null, "", "Room Revenue", "Accounting"],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records.map((r) => r.sourceCode)).not.toContain("RM");
  });

  it("skips ledger key mapped to CHOICE_NOT_MAPPED", async () => {
    const mapping = await buildMapping([
      [
        "Guest Ledger",
        "Guest Ledger Sum",
        1,
        null,
        "",
        "Guest Ledger",
        "Accounting",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records).toHaveLength(0);
  });

  it("emits Guest Ledger record from column sum", async () => {
    const mapping = await buildMapping([
      [
        "Guest Ledger",
        "Sum of Guest Ledger Column",
        1,
        null,
        "10006-654",
        "Guest Ledger",
        "Accounting",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records).toHaveLength(1);
    expect(records[0].targetCode).toBe("10006-654");
    expect(records[0].mappedAmount).toBeCloseTo(-14426.4);
  });

  it("emits AdvDep Ledger record from column sum", async () => {
    const mapping = await buildMapping([
      [
        "AdvDep Ledger",
        "Sum of AdvDep Ledger Column",
        1,
        null,
        "24000-263",
        "Deferred Revenue",
        "Accounting",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    expect(records).toHaveLength(1);
    expect(records[0].mappedAmount).toBeCloseTo(316.34);
  });

  it("skips AR Ledger when sum is zero", async () => {
    const mapping = await buildMapping([
      [
        "AR Ledger",
        "Sum of AR Ledger Column",
        1,
        null,
        "10502-2051",
        "City Ledger",
        "Accounting",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    // arLedgerSum = 0 → should be skipped
    expect(records).toHaveLength(0);
  });

  it("does not emit Statistical entries", async () => {
    const mapping = await buildMapping([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
      [
        "Occupancy Statistics_ADR for Total Occupied Rooms",
        "ADR",
        1,
        null,
        "90001-418",
        "ADR",
        "Statistical",
      ],
    ]);
    const records = transformJournalSummaryToJERecords(
      baseSummary,
      mapping,
      MISSOULA,
    );
    const statRecords = records.filter((r) => r.targetCode?.startsWith("90"));
    expect(statRecords).toHaveLength(0);
  });
});

// ─── transformHotelStatsToStatJERecords ───────────────────────────────────────

describe("transformHotelStatsToStatJERecords", () => {
  const businessDate = "2026-06-14";
  const revParHeader = buildRevParHeader(businessDate);

  const baseStats: HotelStatsData = {
    businessDate,
    columns: new Map([
      ["Room Statistics_Total Rooms", "61"],
      ["Total Occupied Rooms", "37"],
      ["Comp Rooms", "0"],
      ["Occupancy Statistics_Occ% of Total Rooms", "60.66%"],
      ["Occupancy Statistics_ADR for Total Occupied Rooms", "202.52"],
      [revParHeader, "122.84"],
      ["Room Statistics_Out Of Order", "0"],
    ]),
  };

  it("emits ADR record with correct amount", async () => {
    const mapping = await buildMapping([
      [
        "Occupancy Statistics_ADR for Total Occupied Rooms",
        "ADR",
        1,
        null,
        "90001-418",
        "ADR",
        "Statistical",
      ],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);
    const adr = records.find((r) => r.targetCode === "90001-418");
    expect(adr?.mappedAmount).toBeCloseTo(202.52);
  });

  it("strips percentage sign when parsing Occupancy", async () => {
    const mapping = await buildMapping([
      [
        "Occupancy Statistics_Occ% of Total Rooms",
        "Occupancy",
        1,
        null,
        "90002-419",
        "Occy",
        "Statistical",
      ],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);
    const occy = records.find((r) => r.targetCode === "90002-419");
    expect(occy?.mappedAmount).toBeCloseTo(60.66);
  });

  it("resolves RevPAR via date-based prefix matching", async () => {
    const mapping = await buildMapping([
      [
        `Occupancy Statistics_RevPar_(Date)`,
        "REVPAR",
        1,
        null,
        "90003-420",
        "RevPAR",
        "Statistical",
      ],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);
    const revpar = records.find((r) => r.targetCode === "90003-420");
    expect(revpar?.mappedAmount).toBeCloseTo(122.84);
  });

  it("always appends three trailing zero rows", async () => {
    const mapping = await buildMapping([
      [
        "Occupancy Statistics_ADR for Total Occupied Rooms",
        "ADR",
        1,
        null,
        "90001-418",
        "ADR",
        "Statistical",
      ],
      [
        "Occupancy Statistics_Occ% of Total Rooms",
        "Occupancy",
        1,
        null,
        "90002-419",
        "Occy",
        "Statistical",
      ],
      [
        `Occupancy Statistics_RevPar_(Date)`,
        "REVPAR",
        1,
        null,
        "90003-420",
        "RevPAR",
        "Statistical",
      ],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);

    // 3 real records + 3 trailing zero rows = 6
    expect(records).toHaveLength(6);

    const lastThree = records.slice(-3);
    expect(lastThree.every((r) => r.mappedAmount === 0)).toBe(true);
    expect(lastThree.map((r) => r.targetCode)).toEqual([
      "90002-419", // Occy
      "90001-418", // ADR
      "90003-420", // RevPAR
    ]);
  });

  it("skips stat entries with no matching column in stats file", async () => {
    const mapping = await buildMapping([
      [
        "NonExistentColumn",
        "Missing",
        1,
        null,
        "90009-633",
        "Rooms Available",
        "Statistical",
      ],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);
    // Only the 3 trailing rows should be emitted
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.mappedAmount === 0)).toBe(true);
  });

  it("does not emit Accounting entries", async () => {
    const mapping = await buildMapping([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);
    // Only trailing zeros — no accounting records
    const accountingRecords = records.filter(
      (r) => !r.targetCode?.startsWith("90"),
    );
    expect(accountingRecords).toHaveLength(0);
  });

  it("skips Statistical entry mapped to CHOICE_NOT_MAPPED", async () => {
    const mapping = await buildMapping([
      [
        "Occupancy Statistics_ADR for Total Occupied Rooms",
        "ADR",
        1,
        null,
        "",
        "ADR",
        "Statistical",
      ],
    ]);
    const records = transformHotelStatsToStatJERecords(baseStats, mapping);
    // All three trailing zeros should still be emitted; the ADR stat entry itself skipped
    expect(records.every((r) => r.mappedAmount === 0)).toBe(true);
  });
});
