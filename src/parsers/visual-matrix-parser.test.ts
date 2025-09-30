import { describe, it, expect, beforeEach } from "vitest";
import { VisualMatrixParser } from "./visual-matrix-parser";
import * as ExcelJS from "exceljs";

describe("VisualMatrixParser", () => {
  let parser: VisualMatrixParser;

  beforeEach(() => {
    parser = new VisualMatrixParser();
  });

  describe("Parser Configuration", () => {
    it("should have correct parser info", () => {
      expect(parser.parserInfo.name).toBe("VisualMatrixParser");
      expect(parser.parserInfo.version).toBe("1.0.0");
      expect(parser.fileType).toBe("xlsx");
    });

    it("should support Excel file types", () => {
      expect(parser.canParse("test.xlsx")).toBe(true);
      expect(parser.canParse("test.xls")).toBe(true);
      expect(parser.canParse("test.csv")).toBe(true); // CSV files can be Excel format
      expect(parser.canParse("test.pdf")).toBe(false);
      expect(parser.canParse("test.txt")).toBe(false);
    });
  });

  describe("Excel File Parsing", () => {
    it("should parse valid VisualMatrix Excel file", async () => {
      // Create a mock Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      // Add headers
      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      // Add sample data
      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);
      worksheet.addRow([
        2,
        "2001",
        "Food Sales",
        "FOOD-SALES",
        201,
        0,
        "",
        "4020",
        "",
        "Food & Beverage Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.mappings).toHaveLength(2);

      const mapping1 = result.data!.mappings[0];
      expect(mapping1.recId).toBe(1);
      expect(mapping1.srcAcctCode).toBe("1001");
      expect(mapping1.srcAcctDesc).toBe("Room Revenue");
      expect(mapping1.acctCode).toBe("4010");
      expect(mapping1.acctName).toBe("Room Revenue");

      expect(result.data!.metadata.totalMappings).toBe(2);
      expect(result.data!.metadata.uniqueSourceCodes).toBe(2);
      expect(result.data!.metadata.uniqueTargetCodes).toBe(2);
    });

    it("should handle Excel file with wrong sheet name", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("WrongSheetName");
      worksheet.addRow(["Col1", "Col2"]);
      worksheet.addRow(["Data1", "Data2"]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Sheet "VisualMatrix" not found');
    });

    it("should handle Excel file with missing required columns", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      // Add incomplete headers
      worksheet.addRow(["Rec Id", "Some Other Column"]);
      worksheet.addRow([1, "Some Data"]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Missing required columns");
    });

    it("should handle empty Excel file", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      // Add headers only
      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(0);
      expect(result.metadata.warnings).toContain(
        "No data rows found in VisualMatrix sheet",
      );
    });

    it("should filter out invalid rows", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      // Add valid row
      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      // Add invalid row (missing source code)
      worksheet.addRow([
        2,
        "",
        "Invalid Row",
        "INVALID",
        102,
        0,
        "",
        "4020",
        "",
        "Invalid",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      // Add another valid row
      worksheet.addRow([
        3,
        "3001",
        "Tax Revenue",
        "TAX-REV",
        301,
        0,
        "",
        "4030",
        "",
        "Tax Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(2); // Only valid rows
      expect(result.metadata.warnings).toContain(
        "Skipped 1 invalid rows (missing required fields)",
      );
    });
  });

  describe("Configuration Options", () => {
    it("should use custom sheet name", async () => {
      const customParser = new VisualMatrixParser({ sheetName: "CustomSheet" });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("CustomSheet");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await customParser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(1);
    });

    it("should filter by property ID when configured", async () => {
      const propertyParser = new VisualMatrixParser({ propertyIdFilter: 123 });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      // Add row for property 123
      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        123,
        "Test Property",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      // Add row for property 456 (should be filtered out)
      worksheet.addRow([
        2,
        "2001",
        "Food Sales",
        "FOOD-SALES",
        201,
        456,
        "Other Property",
        "4020",
        "",
        "Food Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      // Add row for property 0 (global, should be included)
      worksheet.addRow([
        3,
        "3001",
        "Tax Revenue",
        "TAX-REV",
        301,
        0,
        "",
        "4030",
        "",
        "Tax Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await propertyParser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(2); // Property 123 + global (property 0)

      const propertyIds = result.data!.mappings.map((m) => m.propertyId);
      expect(propertyIds).toContain(123);
      expect(propertyIds).toContain(0);
      expect(propertyIds).not.toContain(456);
    });

    it("should exclude empty mappings when configured", async () => {
      const strictParser = new VisualMatrixParser({
        includeEmptyMappings: false,
      });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      // Add valid mapping
      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      // Add mapping with empty target code
      worksheet.addRow([
        2,
        "2001",
        "Food Sales",
        "FOOD-SALES",
        201,
        0,
        "",
        "",
        "",
        "",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await strictParser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(1); // Only the valid mapping
    });
  });

  describe("Lookup Maps", () => {
    it("should create correct lookup maps", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);

      // Test source code lookup
      const sourceMapping = result.data!.sourceCodeMap.get("1001");
      expect(sourceMapping).toBeDefined();
      expect(sourceMapping!.acctCode).toBe("4010");

      // Test target code lookup
      const targetMapping = result.data!.targetCodeMap.get("4010");
      expect(targetMapping).toBeDefined();
      expect(targetMapping!.srcAcctCode).toBe("1001");
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid Excel file", async () => {
      const invalidBuffer = Buffer.from("This is not an Excel file");

      const result = await parser.parseFromBuffer(invalidBuffer, "test.xlsx");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PARSING_ERROR");
      expect(result.error?.message).toContain(
        "Failed to parse VisualMatrix file",
      );
    });

    it("should handle empty buffer", async () => {
      const emptyBuffer = Buffer.alloc(0);

      const result = await parser.parseFromBuffer(emptyBuffer, "test.xlsx");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PARSING_ERROR");
    });

    it("should handle file with no worksheets", async () => {
      const workbook = new ExcelJS.Workbook();
      // Don't add any worksheets
      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Sheet "VisualMatrix" not found');
    });
  });

  describe("Data Validation", () => {
    it("should validate mapping completeness", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      // Add complete mapping
      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      // Add incomplete mapping (missing target account code)
      worksheet.addRow([
        2,
        "2001",
        "Food Sales",
        "FOOD-SALES",
        201,
        0,
        "",
        null,
        "",
        "Food Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(1); // Only complete mapping
      expect(result.metadata.warnings).toContain(
        "Skipped 1 invalid rows (missing required fields)",
      );
    });

    it("should handle date parsing errors gracefully", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        0,
        "",
        "4010",
        "",
        "Room Revenue",
        1,
        "invalid-date",
        "another-invalid-date",
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);
      expect(result.data!.mappings).toHaveLength(1);

      // Should have default dates for invalid date values
      const mapping = result.data!.mappings[0];
      expect(mapping.created).toBeInstanceOf(Date);
      expect(mapping.updated).toBeInstanceOf(Date);
    });
  });

  describe("Metadata Generation", () => {
    it("should generate accurate metadata", async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("VisualMatrix");

      worksheet.addRow([
        "Rec Id",
        "Src Acct Code",
        "Src Acct Desc",
        "Xref Key",
        "Acct Id",
        "Property Id",
        "Property Name",
        "Acct Code",
        "Acct Suffix",
        "Acct Name",
        "Multiplier",
        "Created",
        "Updated",
      ]);

      // Add mappings with some duplicates to test unique counts
      worksheet.addRow([
        1,
        "1001",
        "Room Revenue",
        "ROOM-REV",
        101,
        123,
        "Test Property",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      worksheet.addRow([
        2,
        "1001",
        "Room Revenue Duplicate",
        "ROOM-REV-2",
        102,
        123,
        "Test Property",
        "4010",
        "",
        "Room Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      worksheet.addRow([
        3,
        "2001",
        "Food Sales",
        "FOOD-SALES",
        201,
        0,
        "",
        "4020",
        "",
        "Food Revenue",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parser.parseFromBuffer(
        Buffer.from(buffer),
        "test.xlsx",
      );

      expect(result.success).toBe(true);

      const metadata = result.data!.metadata;
      expect(metadata.totalMappings).toBe(3);
      expect(metadata.uniqueSourceCodes).toBe(2); // '1001' and '2001'
      expect(metadata.uniqueTargetCodes).toBe(2); // '4010' and '4020'
      expect(metadata.hasPropertySpecificMappings).toBe(true); // Property 123 exists
      expect(metadata.lastUpdated).toBeInstanceOf(Date);
    });
  });
});
