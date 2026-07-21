import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  loadChoiceMapping,
  parseChoiceMappingWorkbook,
  findChoiceMappingEntry,
  CHOICE_NOT_MAPPED,
  CHOICE_MAPPING_PREFIX,
  CHOICE_SHEET_NAME,
} from "./choice-mapping-loader";
import ExcelJS from "exceljs";

// ---- Mocks for loadChoiceMapping ----

vi.mock("@aws-sdk/client-s3");
vi.mock("../utils/retry");
vi.mock("../utils/logger", () => ({
  createCorrelatedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { retryS3Operation } from "../utils/retry";
const mockRetryS3 = retryS3Operation as Mock;

// S3Client is passed in from outside; retryS3Operation is fully mocked so
// s3Client.send is never actually invoked in these tests.
const stubS3Client = {} as Parameters<typeof loadChoiceMapping>[0];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal in-memory XLSX buffer with a "Choice" sheet.
 * Columns: [Src Data Code, Src Desc, Multiplier, Property Name, Glacct Code, Glacct Name, Acct Type]
 */
async function buildTestXlsx(
  rows: Array<(string | number | null)[]>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(CHOICE_SHEET_NAME);

  ws.addRow([
    "Src Data Code",
    "Src Desc",
    "Multiplier",
    "Property Name",
    "Glacct Code",
    "Glacct Name",
    "Acct Type",
  ]);
  for (const row of rows) {
    ws.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── parseChoiceMappingWorkbook ──────────────────────────────────────────────

describe("parseChoiceMappingWorkbook", () => {
  it("parses a global (no property) accounting entry", async () => {
    const buf = await buildTestXlsx([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);

    expect(mapping.has("RM")).toBe(true);
    const [entry] = mapping.get("RM")!;
    expect(entry.srcDataCode).toBe("RM");
    expect(entry.srcDesc).toBe("ROOM CHARGE");
    expect(entry.multiplier).toBe(1);
    expect(entry.propertyName).toBe("");
    expect(entry.glAcctCode).toBe("40110-634");
    expect(entry.glAcctName).toBe("Room Revenue");
    expect(entry.acctType).toBe("Accounting");
  });

  it("parses a property-specific entry", async () => {
    const buf = await buildTestXlsx([
      [
        "AX",
        "AMERICAN EXPRESS",
        -1,
        "Comfort Inn - Missoula",
        "10190-718",
        "Cash in Bank",
        "Accounting",
      ],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    const [entry] = mapping.get("AX")!;
    expect(entry.propertyName).toBe("Comfort Inn - Missoula");
    expect(entry.multiplier).toBe(-1);
  });

  it("groups multiple rows for the same Src Data Code", async () => {
    const buf = await buildTestXlsx([
      [
        "AX",
        "AMEX",
        -1,
        "Comfort Inn - Missoula",
        "10190-718",
        "Cash",
        "Accounting",
      ],
      [
        "AX",
        "AMEX",
        -1,
        "Comfort Inn & Suites - Ashland",
        "10090-701",
        "Cash",
        "Accounting",
      ],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    expect(mapping.get("AX")).toHaveLength(2);
  });

  it("parses a Statistical entry", async () => {
    const buf = await buildTestXlsx([
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
    const mapping = await parseChoiceMappingWorkbook(buf);
    const [entry] = mapping.get(
      "Occupancy Statistics_ADR for Total Occupied Rooms",
    )!;
    expect(entry.acctType).toBe("Statistical");
    expect(entry.glAcctCode).toBe("90001-418");
  });

  it("defaults missing glAcctCode to CHOICE_NOT_MAPPED", async () => {
    const buf = await buildTestXlsx([
      ["XX", "Unknown", 1, null, "", "Name", "Accounting"],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    expect(mapping.get("XX")![0].glAcctCode).toBe(CHOICE_NOT_MAPPED);
  });

  it("skips rows with no Src Data Code", async () => {
    const buf = await buildTestXlsx([
      ["", "Empty", 1, null, "10000-1", "Acct", "Accounting"],
      ["RM", "Room", 1, null, "40110-634", "Revenue", "Accounting"],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    expect(mapping.size).toBe(1);
    expect(mapping.has("RM")).toBe(true);
  });

  it("throws when the Choice sheet is absent", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("WrongSheet");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(parseChoiceMappingWorkbook(buffer)).rejects.toThrow(
      /Sheet "Choice" not found/,
    );
  });
});

// ─── findChoiceMappingEntry ───────────────────────────────────────────────────

describe("findChoiceMappingEntry", () => {
  it("returns property-specific entry when name matches", async () => {
    const buf = await buildTestXlsx([
      [
        "AX",
        "AMEX",
        -1,
        "Comfort Inn - Missoula",
        "10190-718",
        "CashMis",
        "Accounting",
      ],
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
    const mapping = await parseChoiceMappingWorkbook(buf);
    const entry = findChoiceMappingEntry(
      mapping,
      "AX",
      "Comfort Inn - Missoula",
    );
    expect(entry?.glAcctCode).toBe("10190-718");
  });

  it("falls back to global entry when property name does not match", async () => {
    const buf = await buildTestXlsx([
      ["RM", "Room Charge", 1, null, "40110-634", "Room Rev", "Accounting"],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    const entry = findChoiceMappingEntry(mapping, "RM", "Any Property");
    expect(entry?.glAcctCode).toBe("40110-634");
  });

  it("returns undefined when code is not in mapping", async () => {
    const buf = await buildTestXlsx([
      ["RM", "Room Charge", 1, null, "40110-634", "Room Rev", "Accounting"],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    expect(findChoiceMappingEntry(mapping, "MISSING", "Any")).toBeUndefined();
  });

  it("returns undefined when all entries have non-matching property names", async () => {
    const buf = await buildTestXlsx([
      [
        "LB",
        "Lounge",
        1,
        "Comfort Inn & Suites - Ashland",
        "40121-724",
        "Alcohol",
        "Accounting",
      ],
    ]);
    const mapping = await parseChoiceMappingWorkbook(buf);
    // Missoula doesn't have an LB entry and there's no global fallback
    expect(
      findChoiceMappingEntry(mapping, "LB", "Comfort Inn - Missoula"),
    ).toBeUndefined();
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe("Choice mapping constants", () => {
  it("has the expected S3 prefix", () => {
    expect(CHOICE_MAPPING_PREFIX).toBe("choice/");
  });

  it("has the expected sheet name", () => {
    expect(CHOICE_SHEET_NAME).toBe("Choice");
  });
});

// ─── loadChoiceMapping ────────────────────────────────────────────────────────

describe("loadChoiceMapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the choice/ prefix has no XLSX files", async () => {
    mockRetryS3.mockResolvedValueOnce({ Contents: [] });

    const result = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(result).toBeNull();
  });

  it("returns null when Contents is undefined", async () => {
    mockRetryS3.mockResolvedValueOnce({});

    const result = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(result).toBeNull();
  });

  it("ignores non-XLSX files and returns null when none remain", async () => {
    mockRetryS3.mockResolvedValueOnce({
      Contents: [
        { Key: `${CHOICE_MAPPING_PREFIX}readme.txt`, LastModified: new Date() },
      ],
    });

    const result = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(result).toBeNull();
  });

  it("fetches the most-recently-modified XLSX and returns a mapping", async () => {
    const buf = await buildTestXlsx([
      ["RM", "ROOM CHARGE", 1, null, "40110-634", "Room Revenue", "Accounting"],
    ]);

    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: `${CHOICE_MAPPING_PREFIX}choice-mapping.xlsx`,
            LastModified: new Date("2026-06-01"),
            Size: buf.length,
          },
        ],
      })
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(buf)),
        },
      });

    const mapping = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(mapping).not.toBeNull();
    expect(mapping!.has("RM")).toBe(true);
  });

  it("picks the newest file when multiple XLSX files exist", async () => {
    const bufNew = await buildTestXlsx([
      ["NEW", "new entry", 1, null, "99999-999", "New", "Accounting"],
    ]);

    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: `${CHOICE_MAPPING_PREFIX}old.xlsx`,
            LastModified: new Date("2026-01-01"),
          },
          {
            Key: `${CHOICE_MAPPING_PREFIX}new.xlsx`,
            LastModified: new Date("2026-06-01"),
          },
        ],
      })
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(bufNew)),
        },
      });

    const mapping = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(mapping!.has("NEW")).toBe(true);
    expect(mapping!.has("OLD")).toBe(false);
  });

  it("returns null when response body is missing", async () => {
    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: `${CHOICE_MAPPING_PREFIX}mapping.xlsx`,
            LastModified: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({ Body: null });

    const result = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(result).toBeNull();
  });

  it("returns null and logs when retryS3Operation throws", async () => {
    mockRetryS3.mockRejectedValueOnce(new Error("S3 unavailable"));

    const result = await loadChoiceMapping(stubS3Client, "test-bucket", "cid");
    expect(result).toBeNull();
  });
});
