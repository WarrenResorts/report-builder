import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CSVGenerator,
  generateCSV,
  generateMultipleCSVs,
  type CSVGeneratorConfig,
} from "./csv-generator";
import type { TransformedData } from "../transformation/transformation-engine";

// Mock the logger
vi.mock("../utils/logger", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

describe("CSV Generator Unit Tests", () => {
  let generator: CSVGenerator;
  let mockTransformedData: TransformedData;

  beforeEach(() => {
    generator = new CSVGenerator();

    // Create mock transformed data
    mockTransformedData = {
      propertyId: "PROP001",
      propertyName: "Test Property",
      records: [
        {
          recordId: "rec-001",
          fields: {
            Name: "John Doe",
            Age: 30,
            Email: "john@example.com",
            Active: true,
            Salary: 75000.5,
            StartDate: new Date("2023-01-01T12:00:00"), // Use noon to avoid timezone issues
          },
          metadata: {
            sourceRowIndex: 0,
            transformationWarnings: [],
          },
        },
        {
          recordId: "rec-002",
          fields: {
            Name: "Jane Smith",
            Age: 25,
            Email: "jane@example.com",
            Active: false,
            Salary: 65000.0,
            StartDate: new Date("2023-02-01T12:00:00"), // Use noon to avoid timezone issues
          },
          metadata: {
            sourceRowIndex: 1,
            transformationWarnings: ["Age converted from string"],
          },
        },
      ],
      metadata: {
        sourceFile: "test1.csv",
        sourceFileType: "csv",
        transformedAt: new Date("2023-01-15T10:00:00Z"),
        recordCount: 2,
        transformationTimeMs: 60000,
        appliedRules: 5,
        warnings: [],
        errors: [],
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateCSV", () => {
    it("should generate CSV with headers by default", async () => {
      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toBeDefined();
      expect(result.stats).toBeDefined();

      const lines = result.csvContent!.split("\n");
      expect(lines[0]).toContain("Active,Age,Email,Name,Salary,StartDate"); // Headers in alphabetical order
      expect(lines[1]).toContain(
        'true,30,john@example.com,"John Doe",75000.5,2023-01-01',
      );
      expect(lines[2]).toContain(
        'false,25,jane@example.com,"Jane Smith",65000,2023-02-01',
      );
    });

    it("should generate CSV without headers when configured", async () => {
      const config: CSVGeneratorConfig = { includeHeaders: false };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      const lines = result.csvContent!.split("\n");
      expect(lines[0]).toContain(
        'true,30,john@example.com,"John Doe",75000.5,2023-01-01',
      );
      expect(lines[0]).not.toContain("Active,Age,Email"); // No headers
    });

    it("should use custom field ordering when provided", async () => {
      const config: CSVGeneratorConfig = {
        fieldOrder: ["Name", "Email", "Age", "Active", "Salary", "StartDate"],
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      const lines = result.csvContent!.split("\n");
      expect(lines[0]).toBe("Name,Email,Age,Active,Salary,StartDate");
      expect(lines[1]).toContain(
        '"John Doe",john@example.com,30,true,75000.5,2023-01-01',
      );
    });

    it("should handle custom delimiter and quote characters", async () => {
      const config: CSVGeneratorConfig = {
        delimiter: ";",
        quote: "'",
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain(";"); // Custom delimiter
      expect(result.csvContent).toContain("'John Doe'"); // Custom quote character
    });

    it("should handle different line endings", async () => {
      const config: CSVGeneratorConfig = {
        lineEnding: "\r\n",
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("\r\n");
    });

    it("should include metadata fields when configured", async () => {
      const config: CSVGeneratorConfig = {
        includeMetadata: true,
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("_recordId");
      expect(result.csvContent).toContain("_sourceFile");
      expect(result.csvContent).toContain("_processingDate");
      expect(result.csvContent).toContain("_warnings");
    });

    it("should sanitize field values when enabled", async () => {
      const dataWithSpecialChars: TransformedData = {
        ...mockTransformedData,
        records: [
          {
            recordId: "rec-001",
            sourceFile: "test.csv",
            processingDate: "2023-01-15",
            fields: {
              Name: "John\x00Doe\x01", // Contains null bytes and control characters
              Description: "  Multiple   spaces  ", // Multiple spaces
            },
            metadata: {
              originalRowIndex: 0,
              transformationWarnings: [],
              validationErrors: [],
            },
          },
        ],
      };

      const result = await generator.generateCSV(
        dataWithSpecialChars,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("JohnDoe"); // Control characters removed
      expect(result.csvContent).toContain("Multiple spaces"); // Multiple spaces normalized
      expect(result.stats!.sanitizedValues).toBeGreaterThan(0);
    });

    it("should truncate long field values", async () => {
      const config: CSVGeneratorConfig = {
        maxFieldLength: 10,
      };
      generator = new CSVGenerator(config);

      const dataWithLongField: TransformedData = {
        ...mockTransformedData,
        records: [
          {
            recordId: "rec-001",
            sourceFile: "test.csv",
            processingDate: "2023-01-15",
            fields: {
              LongField: "This is a very long field that should be truncated",
            },
            metadata: {
              originalRowIndex: 0,
              transformationWarnings: [],
              validationErrors: [],
            },
          },
        ],
      };

      const result = await generator.generateCSV(
        dataWithLongField,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("This is...");
      expect(result.stats!.truncatedValues).toBe(1);
    });

    it("should handle empty data gracefully", async () => {
      const emptyData: TransformedData = {
        ...mockTransformedData,
        records: [],
      };

      const result = await generator.generateCSV(
        emptyData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toBe(""); // Empty with headers disabled for empty data
      expect(result.stats!.totalRecords).toBe(0);
      expect(result.stats!.fieldCount).toBe(0);
    });

    it("should handle complex data types", async () => {
      const complexData: TransformedData = {
        ...mockTransformedData,
        records: [
          {
            recordId: "rec-001",
            sourceFile: "test.csv",
            processingDate: "2023-01-15",
            fields: {
              NullValue: null,
              UndefinedValue: undefined,
              BooleanTrue: true,
              BooleanFalse: false,
              NumberZero: 0,
              NumberFloat: 123.45,
              DateValue: new Date("2023-01-15T12:00:00"), // Use noon to avoid timezone issues
              ObjectValue: { key: "value", nested: { data: 123 } },
              ArrayValue: [1, 2, 3],
            },
            metadata: {
              originalRowIndex: 0,
              transformationWarnings: [],
              validationErrors: [],
            },
          },
        ],
      };

      const result = await generator.generateCSV(
        complexData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("true"); // Boolean true
      expect(result.csvContent).toContain("false"); // Boolean false
      expect(result.csvContent).toContain("0"); // Number zero
      expect(result.csvContent).toContain("123.45"); // Float
      expect(result.csvContent).toContain("2023-01-15"); // Date formatted
      expect(result.csvContent).toContain('""key"":""value""'); // Object serialized (quotes escaped)
      expect(result.csvContent).toContain("[1,2,3]"); // Array serialized
    });

    it("should quote fields with special characters", async () => {
      const specialData: TransformedData = {
        ...mockTransformedData,
        records: [
          {
            recordId: "rec-001",
            sourceFile: "test.csv",
            processingDate: "2023-01-15",
            fields: {
              WithComma: "Value, with comma",
              WithQuote: 'Value "with quote"',
              WithNewline: "Value\nwith newline",
              WithSpaces: " Value with leading/trailing spaces ",
            },
            metadata: {
              originalRowIndex: 0,
              transformationWarnings: [],
              validationErrors: [],
            },
          },
        ],
      };

      const result = await generator.generateCSV(
        specialData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain('"Value, with comma"'); // Comma quoted
      expect(result.csvContent).toContain('"Value ""with quote"""'); // Quote escaped
      expect(result.csvContent).toContain('"Value with newline"'); // Newline quoted (but \n becomes space due to sanitization)
      expect(result.csvContent).toContain(
        '"Value with leading/trailing spaces"',
      ); // Spaces quoted and trimmed
    });

    it("should handle quote all option", async () => {
      const config: CSVGeneratorConfig = {
        quoteAll: true,
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      const lines = result.csvContent!.split("\n");
      // All fields should be quoted
      expect(lines[1]).toMatch(
        /^"[^"]*","[^"]*","[^"]*","[^"]*","[^"]*","[^"]*"$/,
      );
    });

    it("should provide accurate statistics", async () => {
      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.stats).toEqual({
        totalRecords: 2,
        fieldCount: 6,
        includedFields: [
          "Active",
          "Age",
          "Email",
          "Name",
          "Salary",
          "StartDate",
        ],
        sanitizedValues: 0,
        truncatedValues: 0,
        processingTimeMs: expect.any(Number),
        outputSizeBytes: expect.any(Number),
      });
      expect(result.stats!.processingTimeMs).toBeGreaterThan(0);
      expect(result.stats!.outputSizeBytes).toBeGreaterThan(0);
    });

    it("should handle errors gracefully", async () => {
      // Create data that will cause an error during processing
      const invalidData = {
        ...mockTransformedData,
        records: [
          {
            recordId: "rec-001",
            sourceFile: "test.csv",
            processingDate: "2023-01-15",
            fields: {
              // Create a circular reference that will fail JSON.stringify
              CircularRef: {} as Record<string, unknown>,
            },
            metadata: {
              originalRowIndex: 0,
              transformationWarnings: [],
              validationErrors: [],
            },
          },
        ],
      };

      // Create circular reference
      invalidData.records[0].fields.CircularRef.self =
        invalidData.records[0].fields.CircularRef;

      const result = await generator.generateCSV(
        invalidData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true); // Should handle the error and continue
      expect(result.csvContent).toContain("[Object]"); // Fallback for circular reference
    });
  });

  describe("generateMultipleCSVs", () => {
    it("should generate CSVs for multiple transformed data files", async () => {
      const multipleData = [
        mockTransformedData,
        {
          ...mockTransformedData,
          propertyId: "PROP002",
          metadata: {
            ...mockTransformedData.metadata,
            transformedAt: new Date("2023-01-16T10:00:00Z"),
          },
        },
      ];

      const results = await generator.generateMultipleCSVs(
        multipleData,
        "test-correlation-id",
      );

      expect(results.size).toBe(2);
      expect(results.has("PROP001_2023-01-15")).toBe(true);
      expect(results.has("PROP002_2023-01-16")).toBe(true);

      const result1 = results.get("PROP001_2023-01-15");
      const result2 = results.get("PROP002_2023-01-16");

      expect(result1!.success).toBe(true);
      expect(result2!.success).toBe(true);
    });
  });

  describe("convenience functions", () => {
    it("should work with generateCSV convenience function", async () => {
      const result = await generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    it("should work with generateMultipleCSVs convenience function", async () => {
      const multipleData = [mockTransformedData];
      const results = await generateMultipleCSVs(
        multipleData,
        "test-correlation-id",
      );

      expect(results.size).toBe(1);
      expect(results.has("PROP001_2023-01-15")).toBe(true);
    });

    it("should accept custom configuration in convenience functions", async () => {
      const config: CSVGeneratorConfig = {
        includeHeaders: false,
        delimiter: ";",
      };

      const result = await generateCSV(
        mockTransformedData,
        "test-correlation-id",
        config,
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain(";");
      expect(result.csvContent).not.toMatch(/^Active,Age,Email/); // No headers
    });
  });

  describe("getDefaultConfig", () => {
    it("should return correct default configuration", () => {
      const defaultConfig = CSVGenerator.getDefaultConfig();

      expect(defaultConfig).toEqual({
        delimiter: ",",
        quote: '"',
        lineEnding: "\n",
        includeHeaders: true,
        fieldOrder: [],
        sanitizeValues: true,
        maxFieldLength: 32767,
        includeMetadata: false,
        dateFormat: "YYYY-MM-DD",
        quoteAll: false,
      });
    });
  });

  describe("custom date formatting", () => {
    it("should format dates according to custom format", async () => {
      const config: CSVGeneratorConfig = {
        dateFormat: "DD/MM/YYYY",
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.csvContent).toContain("01/01/2023"); // Custom date format
      expect(result.csvContent).toContain("01/02/2023"); // Custom date format
    });
  });

  describe("field ordering edge cases", () => {
    it("should handle partial field ordering", async () => {
      const config: CSVGeneratorConfig = {
        fieldOrder: ["Name", "Email"], // Only specify some fields
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      const lines = result.csvContent!.split("\n");
      const headers = lines[0].split(",");

      // Name and Email should be first, others alphabetically after
      expect(headers[0]).toBe("Name");
      expect(headers[1]).toBe("Email");
      expect(headers.slice(2)).toEqual([
        "Active",
        "Age",
        "Salary",
        "StartDate",
      ]);
    });

    it("should handle field ordering with non-existent fields", async () => {
      const config: CSVGeneratorConfig = {
        fieldOrder: ["NonExistent", "Name", "Email"],
      };
      generator = new CSVGenerator(config);

      const result = await generator.generateCSV(
        mockTransformedData,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      const lines = result.csvContent!.split("\n");
      const headers = lines[0].split(",");

      // Should skip non-existent field and continue with existing ones
      expect(headers[0]).toBe("Name");
      expect(headers[1]).toBe("Email");
    });
  });
});
