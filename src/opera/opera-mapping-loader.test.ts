import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  loadOperaMapping,
  parseOperaMappingWorkbook,
  NOT_MAPPED,
} from "./opera-mapping-loader";
import * as ExcelJS from "exceljs";

// ---- Mocks for loadOperaMapping ----

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

// S3Client is passed in from outside; we just use a plain stub since
// retryS3Operation is fully mocked and never invokes s3Client.send.
const stubS3Client = {} as Parameters<typeof loadOperaMapping>[0];

// ---- Helper: build in-memory XLSX workbook buffer ----

async function buildTestWorkbook(
  rows: Array<{
    tRXCode: string;
    tRXType?: string;
    description?: string;
    xRefKey?: string;
    multiplier?: number;
    glAcctCode?: string;
    glAcctName?: string;
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Opera");

  ws.addRow([
    "Rec Id",
    "System",
    "TRX_CODE",
    "TRX_TYPE",
    "SUB_GRP_1",
    "Descr",
    "Xref Key",
    "Allow User Edit Flag",
    "Ignore Mapping",
    "Multiplier",
    "Acct Id",
    "Property Id",
    "Property Name",
    "Glacct Code",
    "Glacct Suffix",
    "Glacct Name",
  ]);

  for (const r of rows) {
    ws.addRow([
      1,
      "OPERA",
      r.tRXCode,
      r.tRXType ?? "REVENUE",
      "",
      r.description ?? r.tRXCode,
      r.xRefKey ?? "",
      "Y",
      "",
      r.multiplier ?? 1,
      0,
      0,
      "",
      r.glAcctCode ?? NOT_MAPPED,
      "",
      r.glAcctName ?? "",
    ]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// loadOperaMapping — S3 integration path
// ============================================================

describe("loadOperaMapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the opera/ prefix has no XLSX files", async () => {
    mockRetryS3.mockResolvedValueOnce({ Contents: [] });

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-1",
    );
    expect(result).toBeNull();
  });

  it("returns null when Contents is missing from the listing response", async () => {
    mockRetryS3.mockResolvedValueOnce({});

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-2",
    );
    expect(result).toBeNull();
  });

  it("downloads the most-recent XLSX and returns the parsed mapping", async () => {
    const xlsxBuffer = await buildTestWorkbook([
      { tRXCode: "1000", glAcctCode: "40110-634", glAcctName: "Room Revenue" },
    ]);

    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "opera/WARRENRESORTS_Opera.xlsx",
            LastModified: new Date("2026-04-07"),
            Size: xlsxBuffer.length,
          },
        ],
      })
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: async () => new Uint8Array(xlsxBuffer),
        },
      });

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-3",
    );

    expect(result).not.toBeNull();
    expect(result!.get("1000")?.glAcctCode).toBe("40110-634");
  });

  it("skips non-XLSX files and only downloads the XLSX", async () => {
    const xlsxBuffer = await buildTestWorkbook([{ tRXCode: "9003" }]);

    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "opera/readme.txt",
            LastModified: new Date("2026-04-08"),
            Size: 50,
          },
          {
            Key: "opera/WARRENRESORTS_Opera.xlsx",
            LastModified: new Date("2026-04-07"),
            Size: xlsxBuffer.length,
          },
        ],
      })
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: async () => new Uint8Array(xlsxBuffer),
        },
      });

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-4",
    );
    expect(result).not.toBeNull();
  });

  it("selects the most recent XLSX when multiple are present", async () => {
    // older.xlsx has TRX_CODE "OLD", newer.xlsx has TRX_CODE "NEW"
    const olderBuffer = await buildTestWorkbook([
      { tRXCode: "OLD", glAcctCode: "99999-001" },
    ]);
    const newerBuffer = await buildTestWorkbook([
      { tRXCode: "NEW", glAcctCode: "40110-634" },
    ]);

    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "opera/older.xlsx",
            LastModified: new Date("2025-01-01"),
            Size: olderBuffer.length,
          },
          {
            Key: "opera/newer.xlsx",
            LastModified: new Date("2026-04-07"),
            Size: newerBuffer.length,
          },
        ],
      })
      .mockResolvedValueOnce({
        Body: {
          // The function sorts descending by LastModified and picks index 0 → newer
          transformToByteArray: async () => new Uint8Array(newerBuffer),
        },
      });

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-5",
    );
    expect(result!.has("NEW")).toBe(true);
    expect(result!.has("OLD")).toBe(false);
  });

  it("returns null when the S3 download body is undefined", async () => {
    mockRetryS3
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "opera/file.xlsx",
            LastModified: new Date(),
            Size: 100,
          },
        ],
      })
      .mockResolvedValueOnce({ Body: undefined });

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-6",
    );
    expect(result).toBeNull();
  });

  it("returns null when retryS3Operation throws an error", async () => {
    mockRetryS3.mockRejectedValueOnce(new Error("S3 network failure"));

    const result = await loadOperaMapping(
      stubS3Client,
      "test-bucket",
      "corr-7",
    );
    expect(result).toBeNull();
  });
});

// ============================================================
// parseOperaMappingWorkbook — pure XLSX parsing
// ============================================================

describe("parseOperaMappingWorkbook", () => {
  it("parses a basic mapping workbook", async () => {
    const buf = await buildTestWorkbook([
      {
        tRXCode: "1000",
        tRXType: "REVENUE",
        glAcctCode: "40110-634",
        glAcctName: "Room Revenue",
      },
      {
        tRXCode: "9004",
        tRXType: "PAYMENT",
        multiplier: -1,
        xRefKey: "GstPMSMCV",
        glAcctCode: "10030-531",
      },
    ]);

    const mapping = await parseOperaMappingWorkbook(buf);
    expect(mapping.size).toBe(2);

    const room = mapping.get("1000")!;
    expect(room.glAcctCode).toBe("40110-634");
    expect(room.tRXType).toBe("REVENUE");
    expect(room.multiplier).toBe(1);

    const visa = mapping.get("9004")!;
    expect(visa.multiplier).toBe(-1);
    expect(visa.xRefKey).toBe("GstPMSMCV");
  });

  it("marks empty Glacct Code as Not Mapped", async () => {
    const buf = await buildTestWorkbook([{ tRXCode: "9002", glAcctCode: "" }]);
    const mapping = await parseOperaMappingWorkbook(buf);
    expect(mapping.get("9002")?.glAcctCode).toBe(NOT_MAPPED);
  });

  it("deduplicates TRX_CODEs, keeping first occurrence", async () => {
    const buf = await buildTestWorkbook([
      { tRXCode: "1000", glAcctCode: "40110-634" },
      { tRXCode: "1000", glAcctCode: "99999-001" },
    ]);
    const mapping = await parseOperaMappingWorkbook(buf);
    expect(mapping.size).toBe(1);
    expect(mapping.get("1000")?.glAcctCode).toBe("40110-634");
  });

  it("handles null/undefined cell values gracefully", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Opera");
    ws.addRow([
      "Rec Id",
      "System",
      "TRX_CODE",
      "TRX_TYPE",
      "SUB_GRP_1",
      "Descr",
      "Xref Key",
      "Allow",
      "Ignore",
      "Multiplier",
      "Acct Id",
      "Prop Id",
      "Prop Name",
      "Glacct Code",
      "Glacct Suffix",
      "Glacct Name",
    ]);
    const row = ws.addRow([
      1,
      "OPERA",
      "5000",
      "REVENUE",
      undefined,
      undefined,
      undefined,
      "Y",
      "",
      1,
      0,
      0,
      undefined,
      "40200-700",
      "",
      undefined,
    ]);
    void row;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const mapping = await parseOperaMappingWorkbook(buffer);
    const entry = mapping.get("5000")!;
    expect(entry).toBeDefined();
    expect(entry.description).toBe("");
    expect(entry.xRefKey).toBe("");
    expect(entry.glAcctName).toBe("");
  });

  it("throws when the Opera sheet is missing", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("WrongSheet");
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseOperaMappingWorkbook(buffer)).rejects.toThrow(
      /Sheet "Opera" not found/,
    );
  });
});
