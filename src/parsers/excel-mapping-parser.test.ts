import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExcelMappingParser } from "./excel-mapping-parser";
import type { ExcelMappingData } from "./excel-mapping-parser";

// Mock ExcelJS module
vi.mock("exceljs", () => ({
  Workbook: vi.fn(() => ({
    xlsx: {
      read: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    },
    getWorksheet: vi.fn(),
  })),
}));

import { Workbook, Worksheet } from "exceljs";

// For accessing private methods in tests, we use 'any' casting
// This is a test-specific compromise - the intersection type approach
// causes TypeScript to reduce the type to 'never' due to private method conflicts

// Mock workbook interface - don't extend Workbook to avoid conflicts
interface MockWorkbook {
  xlsx: {
    read: (stream: NodeJS.ReadableStream) => Promise<void>;
    load: (buffer: Buffer) => Promise<void>;
  };
  getWorksheet: (name: string) => any;
}

const MockWorkbook = Workbook as unknown as new () => MockWorkbook;

describe("ExcelMappingParser", () => {
  let parser: ExcelMappingParser;
  let mockWorkbookInstance: MockWorkbook;

  // Utility function to create mock Excel buffer
  const createMockExcelBuffer = () => Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP signature

  // Generic mock worksheet creator - replaces 13 specific functions with 1 flexible one
  const createMockWorksheet = (rows: Record<string, unknown>[]) => ({
    actualRowCount: rows.length + 1,
    getRow: vi.fn((rowNum: number) => {
      if (rowNum === 0) return { eachCell: vi.fn() };

      if (rowNum === 1) {
        // Header row
        return {
          eachCell: vi.fn((callback) => {
            const headers = Object.keys(rows[0] || {});
            headers.forEach((header, index) => {
              callback({ text: header }, index + 1);
            });
          }),
        };
      }

      // Data rows
      const dataRow = rows[rowNum - 2];
      if (dataRow) {
        return {
          eachCell: vi.fn((callback) => {
            Object.values(dataRow).forEach((value, index) => {
              const cellValue = value instanceof Date ? value : String(value);
              const cellType =
                value instanceof Date ? 6 : typeof value === "number" ? 1 : 2;
              callback(
                {
                  text: String(value),
                  value: cellValue,
                  type: cellType,
                },
                index + 1,
              );
            });
          }),
        };
      }

      return { eachCell: vi.fn() };
    }),
  });

  // Setup mock workbook with sheets
  const setupMockWorkbook = (sheets: Record<string, Record<string, unknown>[]>) => {
    mockWorkbookInstance.getWorksheet = vi.fn((name: string) =>
      sheets[name] ? createMockWorksheet(sheets[name]) : undefined,
    );
  };

  beforeEach(() => {
    parser = new ExcelMappingParser();
    vi.clearAllMocks();

    mockWorkbookInstance = {
      xlsx: {
        read: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
      },
      getWorksheet: vi.fn(),
    };

    (MockWorkbook as any).mockImplementation(() => mockWorkbookInstance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("canParse", () => {
    it("should return true for Excel files by extension", () => {
      expect(parser.canParse("mapping.xlsx")).toBe(true);
      expect(parser.canParse("mapping.xls")).toBe(true);
    });

    it("should return false for non-Excel files", () => {
      expect(parser.canParse("mapping.csv")).toBe(false);
      expect(parser.canParse("mapping.txt")).toBe(false);
    });

    it("should detect Excel content by buffer analysis", () => {
      const excelBuffer = createMockExcelBuffer();
      expect(parser.canParse("unknown", excelBuffer)).toBe(true);
    });
  });

  describe("parseFromBuffer", () => {
    it("should parse a complete Excel mapping file successfully", async () => {
      setupMockWorkbook({
        Metadata: [
          {
            key: "version",
            value: "1.0",
          },
          {
            key: "description",
            value: "Test mapping file",
          },
        ],
        Config: [
          {
            key: "timezone",
            value: "UTC",
          },
          {
            key: "dateFormat",
            value: "YYYY-MM-DD",
          },
        ],
        Mappings: [
          {
            propertyId: "PROP001",
            propertyName: "Test Property",
            fileFormat: "all",
            sourceField: "test_field",
            targetField: "TestField",
            dataType: "string",
            required: "true",
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
      );

      expect(result.success).toBe(true);
      const data = result.data as unknown as ExcelMappingData;
      expect(data.metadata.version).toBe("1.0");
      expect(data.globalConfig.timezone).toBe("UTC");
      expect(data.propertyMappings).toHaveLength(1);
      expect(data.propertyMappings[0].propertyId).toBe("PROP001");
    });

    it("should handle missing optional sheets when allowMissingSheets is true", async () => {
      setupMockWorkbook({
        Mappings: [
          {
            propertyId: "PROP001",
            sourceField: "test",
            targetField: "Test",
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
        { parserOptions: { allowMissingSheets: true } },
      );

      expect(result.success).toBe(true);
    });

    it("should fail when required mappings sheet is missing", async () => {
      setupMockWorkbook({});

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Required mappings sheet");
    });

    it("should handle file size limits", async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB (exceeds 10MB limit)
      const result = await parser.parseFromBuffer(largeBuffer, "large.xlsx");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FILE_TOO_LARGE");
    });

    it("should validate transformation rules when validateRules is true", async () => {
      setupMockWorkbook({
        Mappings: [
          {
            propertyId: "PROP001",
            sourceField: "", // Invalid: missing sourceField
            targetField: "Test",
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
        { parserOptions: { validateRules: true } },
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("missing sourceField");
    });

    it("should validate transformation rules and fail on missing targetField", async () => {
      setupMockWorkbook({
        Mappings: [
          {
            propertyId: "PROP001",
            sourceField: "test",
            targetField: "", // Invalid: missing targetField
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
        { parserOptions: { validateRules: true } },
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("missing targetField");
    });

    it("should validate transformation rules and fail on invalid data type", async () => {
      setupMockWorkbook({
        Mappings: [
          {
            propertyId: "PROP001",
            sourceField: "test_field",
            targetField: "TestField",
            dataType: "invalidType", // Invalid data type
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
        { parserOptions: { validateRules: true } },
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid data type");
    });

    it("should validate transformation rules and fail on missing propertyId", () => {
      const invalidMappings = [{ propertyId: "", rules: [] }];
      expect(() =>
        (parser as any).validateMappingRules(
          invalidMappings,
        ),
      ).toThrow("missing propertyId");
    });

    it("should use custom sheet names when provided", async () => {
      setupMockWorkbook({
        PropertyMappings: [
          {
            propertyId: "PROP001",
            sourceField: "test",
            targetField: "Test",
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
        {
          parserOptions: {
            customSheetNames: { mappings: "PropertyMappings" },
          },
        },
      );

      expect(result.success).toBe(true);
    });
  });

  describe("parseFromString", () => {
    it("should throw error for string input", async () => {
      await expect(
        parser.parseFromString("test", "mapping.xlsx"),
      ).rejects.toThrow("Excel mapping parser does not support string input");
    });
  });

  describe("getDefaultConfig", () => {
    it("should return appropriate default configuration", () => {
      const config = parser.getDefaultConfig();
      expect(config.timeoutMs).toBe(30000);
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024); // 10MB
    });
  });

  describe("data extraction methods", () => {
    it("should extract metadata correctly", () => {
      const mockWorkbook = {
        getWorksheet: vi.fn(() =>
          createMockWorksheet([
            {
              key: "version",
              value: "1.0",
            },
            {
              key: "description",
              value: "Test mapping file",
            },
            {
              key: "createdDate",
              value: "2023-12-01",
            },
          ]),
        ),
      };

      const result = (parser as any).extractMetadata(
        mockWorkbook,
        {},
      );

      expect(result.version).toBe("1.0");
      expect(result.description).toBe("Test mapping file");
      expect(result.createdDate).toBeInstanceOf(Date);
      expect(result.lastModified).toBeInstanceOf(Date);
    });

    it("should extract global configuration correctly", () => {
      const mockWorkbook = {
        getWorksheet: vi.fn(() =>
          createMockWorksheet([
            {
              key: "timezone",
              value: "UTC",
            },
            {
              key: "dateFormat",
              value: "YYYY-MM-DD",
            },
          ]),
        ),
      };

      const result = (parser as any).extractGlobalConfig(
        mockWorkbook,
        {},
      );

      expect(result.timezone).toBe("UTC");
      expect(result.dateFormat).toBe("YYYY-MM-DD");
    });

    it("should extract property mappings correctly", async () => {
      setupMockWorkbook({
        Metadata: [{ key: "version", value: "1.0" }],
        Config: [{ key: "timezone", value: "UTC" }],
        Mappings: [
          {
            propertyId: "PROP001",
            propertyName: "Test Property",
            fileFormat: "all",
            sourceField: "test_field",
            targetField: "TestField",
            dataType: "string",
            required: "true",
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
      );

      expect(result.success).toBe(true);
      const data = result.data as unknown as ExcelMappingData;
      expect(data.propertyMappings).toHaveLength(1);
      expect(data.propertyMappings[0].propertyId).toBe("PROP001");
      expect(data.propertyMappings[0].propertyName).toBe("Test Property");
      expect(data.propertyMappings[0].fileFormat).toBe("all");
    });

    it("should handle custom transformations", async () => {
      setupMockWorkbook({
        Mappings: [
          {
            propertyId: "PROP001",
            sourceField: "test",
            targetField: "Test",
          },
        ],
      });

      const result = await parser.parseFromBuffer(
        createMockExcelBuffer(),
        "mapping.xlsx",
      );

      expect(result.success).toBe(true);
      const data = result.data as unknown as ExcelMappingData;
      expect(data.customTransformations).toEqual({});
    });
  });

  describe("helper methods", () => {
    it("should parse boolean values correctly", () => {
      const testCases = [
        { input: "true", expected: true },
        { input: "false", expected: false },
        { input: "yes", expected: true },
        { input: "no", expected: false },
        { input: "1", expected: true },
        { input: "0", expected: false },
        { input: null, expected: false },
        { input: undefined, expected: false },
      ];

      testCases.forEach(({ input, expected }) => {
        expect((parser as any).parseBoolean(input)).toBe(
          expected,
        );
      });
    });

    it("should parse JSON values correctly", () => {
      expect(
        (parser as any).parseJSON('{"key": "value"}'),
      ).toEqual({
        key: "value",
      });
      expect(
        (parser as any).parseJSON("invalid"),
      ).toBeUndefined();
    });

    it("should parse array values correctly", () => {
      expect(
        (parser as any).parseArray("item1,item2,item3"),
      ).toEqual(["item1", "item2", "item3"]);
      expect(
        (parser as any).parseArray("single"),
      ).toEqual(["single"]);
      expect(
        (parser as any).parseArray(""),
      ).toBeUndefined();
      expect(
        (parser as any).parseArray(null),
      ).toBeUndefined();
    });

    it("should parse dates correctly", () => {
      const testDate = new Date("2023-12-25");
      expect((parser as any).parseDate(testDate)).toBe(
        testDate,
      );
      expect(
        (parser as any).parseDate("2023-12-25"),
      ).toEqual(new Date("2023-12-25"));
      expect(
        (parser as any).parseDate("invalid date"),
      ).toBeNull();
    });

    it("should parse arrays correctly and handle edge cases", () => {
      // String cases
      expect(
        (parser as any).parseArray("item1,item2,item3"),
      ).toEqual(["item1", "item2", "item3"]);
      expect(
        (parser as any).parseArray("single"),
      ).toEqual(["single"]);
      expect(
        (parser as any).parseArray("a, b, c"),
      ).toEqual(["a", "b", "c"]);

      // Array cases
      expect((parser as any).parseArray([])).toEqual([]);
      expect(
        (parser as any).parseArray(["existing", "array"]),
      ).toEqual(["existing", "array"]);

      // Edge cases
      expect(
        (parser as any).parseArray(""),
      ).toBeUndefined();
      expect((parser as any).parseArray("  ")).toEqual(
        [],
      );
      expect(
        (parser as any).parseArray(null),
      ).toBeUndefined();
      expect(
        (parser as any).parseArray(undefined),
      ).toBeUndefined();
      expect(
        (parser as any).parseArray(123),
      ).toBeUndefined();
    });

    it("should parse validation rules with different options", () => {
      // Test allowedValues
      const rowWithAllowedValues = { allowedValues: "option1,option2,option3" };
      const result1 = (parser as any).parseValidation(
        rowWithAllowedValues,
      );
      expect(result1?.allowedValues).toEqual(["option1", "option2", "option3"]);

      // Test maxLength
      const rowWithMaxLength = { maxLength: "100" };
      const result2 = (parser as any).parseValidation(
        rowWithMaxLength,
      );
      expect(result2?.maxLength).toBe(100);

      // Test pattern
      const rowWithPattern = { pattern: "^[A-Z]+$" };
      const result3 = (parser as any).parseValidation(
        rowWithPattern,
      );
      expect(result3?.pattern).toBe("^[A-Z]+$");

      // Test minLength
      const rowWithMinLength = { minLength: "5" };
      const result4 = (parser as any).parseValidation(
        rowWithMinLength,
      );
      expect(result4?.minLength).toBe(5);
    });

    it("should handle alternative column names", () => {
      // Test alternative dataType column names
      const rowWithDataType = {
        propertyId: "PROP001",
        sourceField: "test_field",
        targetField: "TestField",
        DataType: "number",
      };

      const result = (
        parser as any
      ).parseTransformationRule(rowWithDataType);
      expect(result.dataType).toBe("number");

      // Test default dataType fallback
      const rowWithoutDataType = {
        propertyId: "PROP001",
        sourceField: "test_field3",
        targetField: "TestField3",
      };

      const result2 = (
        parser as any
      ).parseTransformationRule(rowWithoutDataType);
      expect(result2.dataType).toBe("string");
    });

    it("should handle different cell types in worksheetToJson", () => {
      const mockWorksheet = {
        actualRowCount: 2,
        getRow: vi.fn((rowNum: number) => {
          if (rowNum === 1) {
            return {
              eachCell: vi.fn((callback) => {
                callback(
                  {
                    type: 6,
                    value: new Date("2023-01-01"),
                    text: "2023-01-01",
                  },
                  1,
                );
                callback({ type: 1, value: 42.5, text: "42.5" }, 2);
                callback(
                  { type: 2, value: "text value", text: "text value" },
                  3,
                );
              }),
            };
          }
          return { eachCell: vi.fn() };
        }),
      };

      const result = (parser as any).worksheetToJson(
        mockWorksheet,
        ["date", "number", "text"],
      );

      expect(result).toHaveLength(1);
      expect(result[0].date).toBeInstanceOf(Date);
      expect(result[0].number).toBe(42.5);
      expect(result[0].text).toBe("text value");
    });

    it("should handle edge cases in worksheetToJson", () => {
      expect(
        (parser as any).worksheetToJson(null),
      ).toEqual([]);
      expect(
        (parser as any).worksheetToJson(undefined),
      ).toEqual([]);

      const emptyWorksheet = { actualRowCount: 0, getRow: vi.fn() };
      expect(
        (parser as any).worksheetToJson(emptyWorksheet),
      ).toEqual([]);
    });

    it("should handle alternative column names in property mappings", () => {
      const mockWorkbook1 = {
        getWorksheet: vi.fn(() =>
          createMockWorksheet([
            {
              propertyId: "PROP001",
              PropertyName: "Alternative Property Name",
              FileFormat: "pdf",
            },
          ]),
        ),
      };

      const result = (
        parser as any
      ).extractPropertyMappings(mockWorkbook1, {});
      expect(result[0].propertyName).toBe("Alternative Property Name");
      expect(result[0].fileFormat).toBe("pdf");
    });

    it("should extract custom transformations", () => {
      const mockWorkbook = {
        getWorksheet: vi.fn(() =>
          createMockWorksheet([
            {
              name: "customTransform1",
              description: "Custom transformation description",
              parameters: '{"param1": "value1"}',
              code: "return data.toUpperCase();",
            },
          ]),
        ),
      };

      const result = (
        parser as any
      ).extractCustomTransformations(mockWorkbook, {});
      expect(result.customTransform1.description).toBe(
        "Custom transformation description",
      );
      expect(result.customTransform1.parameters).toEqual({ param1: "value1" });
      expect(result.customTransform1.code).toBe("return data.toUpperCase();");
    });

    it("should handle missing required sheets with allowMissingSheets false", () => {
      const mockWorkbook = { getWorksheet: vi.fn(() => null) };

      expect(() =>
        (parser as any).extractMetadata(mockWorkbook, {
          allowMissingSheets: false,
        }),
      ).toThrow("Required metadata sheet");

      expect(() =>
        (parser as any).extractGlobalConfig(
          mockWorkbook,
          {
            allowMissingSheets: false,
          },
        ),
      ).toThrow("Required config sheet");
    });
  });

  describe("error handling", () => {
    it("should determine correct error codes", () => {
      expect(
        (parser as any).determineErrorCode(
          new Error("timed out"),
        ),
      ).toBe("TIMEOUT");
      expect(
        (parser as any).determineErrorCode(
          new Error("Excel mapping parsing timed out"),
        ),
      ).toBe("TIMEOUT");
      expect(
        (parser as any).determineErrorCode(
          new Error("sheet not found"),
        ),
      ).toBe("INVALID_FORMAT");
      expect(
        (parser as any).determineErrorCode(
          new Error("missing sourceField"),
        ),
      ).toBe("INVALID_FORMAT");
      expect(
        (parser as any).determineErrorCode(
          new Error("exceeds maximum"),
        ),
      ).toBe("FILE_TOO_LARGE");
      expect(
        (parser as any).determineErrorCode(
          new Error("other error"),
        ),
      ).toBe("PARSING_ERROR");
    });
  });
});
