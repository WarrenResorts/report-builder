import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TransformationEngine,
  transformFileData,
  transformMultipleFiles,
  type RawFileData,
  type TransformationConfig,
} from "./transformation-engine";
// Also import from index to test exports
import * as TransformationModule from "./index";
import type { ExcelMappingData } from "../parsers/excel-mapping-parser";

// Types for testing invalid/unknown values
type TestFileType = "pdf" | "csv" | "txt" | "unknown";
type TestDataType = "string" | "number" | "date" | "boolean" | "unknown";
type TestTransformation = "uppercase" | "lowercase" | "trim" | "currency" | "date_format" | "custom" | "unknown_transformation";

// Mock the logger
vi.mock("../utils/logger", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("TransformationEngine", () => {
  let engine: TransformationEngine;
  let mockMappingData: ExcelMappingData;
  let mockRawData: RawFileData;

  beforeEach(() => {
    engine = new TransformationEngine();

    // Create mock mapping data
    mockMappingData = {
      metadata: {
        version: "1.0.0",
        createdDate: new Date("2023-01-01"),
        lastModified: new Date("2023-12-01"),
        description: "Test mapping",
      },
      globalConfig: {
        outputFormat: "csv",
        dateFormat: "YYYY-MM-DD",
        currencyFormat: "USD",
        timezone: "UTC",
      },
      propertyMappings: [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          fileFormat: "csv",
          rules: [
            {
              sourceField: "tenant_name",
              targetField: "TenantName",
              dataType: "string",
              required: true,
              transformation: "trim",
            },
            {
              sourceField: "rent_amount",
              targetField: "RentAmount",
              dataType: "number",
              required: true,
              transformation: "currency",
              transformationParams: { precision: 2 },
            },
            {
              sourceField: "lease_date",
              targetField: "LeaseDate",
              dataType: "date",
              required: false,
              defaultValue: null,
              transformation: "date_format",
              transformationParams: { format: "YYYY-MM-DD" },
            },
          ],
        },
      ],
      customTransformations: {
        formatCurrency: (value: any, params: any) => {
          return parseFloat(value).toFixed(params.precision || 2);
        },
      },
    };

    // Create mock raw data
    mockRawData = {
      source: {
        filename: "test.csv",
        propertyId: "PROP001",
        fileType: "csv",
        parsedAt: new Date(),
      },
      content: {
        rows: [
          {
            tenant_name: "  John Doe  ",
            rent_amount: "$1,250.00",
            lease_date: "2023-01-15",
          },
          {
            tenant_name: "Jane Smith",
            rent_amount: "875.50",
            lease_date: "2023-02-01",
          },
        ],
      },
      metadata: {
        recordCount: 2,
        processingTimeMs: 100,
        warnings: [],
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("transformData", () => {
    it("should successfully transform CSV data", async () => {
      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.propertyId).toBe("PROP001");
      expect(result.propertyName).toBe("Test Property");
      expect(result.records).toHaveLength(2);

      // Check first record
      const firstRecord = result.records[0];
      expect(firstRecord.fields.TenantName).toBe("John Doe"); // Trimmed
      expect(firstRecord.fields.RentAmount).toBe("1250.00"); // Currency formatted
      expect(firstRecord.fields.LeaseDate).toBe("2023-01-15"); // Date formatted
      expect(firstRecord.metadata.sourceRowIndex).toBe(0);

      // Check second record
      const secondRecord = result.records[1];
      expect(secondRecord.fields.TenantName).toBe("Jane Smith");
      expect(secondRecord.fields.RentAmount).toBe("875.50");
      expect(secondRecord.fields.LeaseDate).toBe("2023-02-01");

      // Check metadata
      expect(result.metadata.recordCount).toBe(2);
      expect(result.metadata.sourceFileType).toBe("csv");
      expect(result.metadata.errors).toHaveLength(0);
    });

    it("should handle PDF data transformation", async () => {
      const pdfRawData: RawFileData = {
        source: {
          filename: "test.pdf",
          propertyId: "PROP001",
          fileType: "pdf",
          parsedAt: new Date(),
        },
        content: {
          text: "Property Report\nTenant: Alice Johnson\nRent: $1,500.00\nLease Date: 2023-03-01",
          pageCount: 1,
          pages: [{ pageNumber: 1, text: "content" }],
        },
        metadata: {
          recordCount: 1,
          processingTimeMs: 50,
          warnings: [],
        },
      };

      // Update mapping for PDF
      mockMappingData.propertyMappings[0].fileFormat = "pdf";
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "text",
          targetField: "RawText",
          dataType: "string",
          required: true,
        },
      ];

      const result = await engine.transformData(
        pdfRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].fields.RawText).toContain("Property Report");
    });

    it("should handle TXT data transformation", async () => {
      const txtRawData: RawFileData = {
        source: {
          filename: "test.txt",
          propertyId: "PROP001",
          fileType: "txt",
          parsedAt: new Date(),
        },
        content: {
          text: "Tenant list:\nBob Wilson - $900\nCarol Davis - $1,100",
          lines: ["Tenant list:", "Bob Wilson - $900", "Carol Davis - $1,100"],
          detectedStructure: "list",
        },
        metadata: {
          recordCount: 1,
          processingTimeMs: 30,
          warnings: [],
        },
      };

      // Update mapping for TXT
      mockMappingData.propertyMappings[0].fileFormat = "txt";
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "text",
          targetField: "Content",
          dataType: "string",
          required: true,
        },
      ];

      const result = await engine.transformData(
        txtRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].fields.Content).toContain("Tenant list");
    });

    it("should handle missing property mapping", async () => {
      const unmappedRawData = { ...mockRawData };
      unmappedRawData.source.propertyId = "UNMAPPED_PROP";

      await expect(
        engine.transformData(
          unmappedRawData,
          mockMappingData,
          "test-correlation-id",
        ),
      ).rejects.toThrow("No mapping found for property UNMAPPED_PROP");
    });

    it("should handle required field validation errors", async () => {
      const invalidRawData = { ...mockRawData };
      invalidRawData.content.rows = [
        {
          tenant_name: null, // Missing required field
          rent_amount: "$1,250.00",
          lease_date: "2023-01-15",
        },
      ];

      const config: TransformationConfig = {
        continueOnError: false,
        maxErrors: 10,
        includeDebugInfo: true,
        validationMode: "strict",
      };

      const engine = new TransformationEngine(config);

      await expect(
        engine.transformData(
          invalidRawData,
          mockMappingData,
          "test-correlation-id",
        ),
      ).rejects.toThrow("Required field tenant_name is null or undefined");
    });

    it("should continue on errors when configured", async () => {
      const mixedRawData = { ...mockRawData };
      mixedRawData.content.rows = [
        {
          tenant_name: "Valid Tenant",
          rent_amount: "$1,250.00",
          lease_date: "2023-01-15",
        },
        {
          tenant_name: null, // Invalid record
          rent_amount: "invalid_amount",
          lease_date: "invalid_date",
        },
        {
          tenant_name: "Another Valid Tenant",
          rent_amount: "$875.50",
          lease_date: "2023-02-01",
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        mixedRawData,
        mockMappingData,
        "test-correlation-id",
      );

      // Should have 2 valid records (skipped the invalid one)
      expect(result.records).toHaveLength(2);
      expect(result.metadata.errors).toHaveLength(1);
      expect(result.records[0].fields.TenantName).toBe("Valid Tenant");
      expect(result.records[1].fields.TenantName).toBe("Another Valid Tenant");
    });

    it("should apply custom transformations", async () => {
      // Add custom transformation rule
      mockMappingData.propertyMappings[0].rules.push({
        sourceField: "custom_field",
        targetField: "CustomFormatted",
        dataType: "string",
        required: false,
        transformation: "custom",
        transformationParams: {
          functionName: "formatCurrency",
          precision: 3,
        },
      });

      // Add custom field to raw data
      mockRawData.content.rows[0].custom_field = "123.456789";

      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.CustomFormatted).toBe("123.457");
    });

    it("should handle data type conversions", async () => {
      const typeTestData = { ...mockRawData };
      typeTestData.content.rows = [
        {
          tenant_name: "Test Tenant",
          rent_amount: "1000",
          lease_date: "2023-01-01",
          is_active: "true",
          score: "85.5",
        },
      ];

      // Add various data type rules
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "tenant_name",
          targetField: "Name",
          dataType: "string",
          required: true,
        },
        {
          sourceField: "rent_amount",
          targetField: "Rent",
          dataType: "number",
          required: true,
        },
        {
          sourceField: "lease_date",
          targetField: "Date",
          dataType: "date",
          required: true,
        },
        {
          sourceField: "is_active",
          targetField: "Active",
          dataType: "boolean",
          required: true,
        },
        {
          sourceField: "score",
          targetField: "Score",
          dataType: "number",
          required: true,
        },
      ];

      const result = await engine.transformData(
        typeTestData,
        mockMappingData,
        "test-correlation-id",
      );

      const record = result.records[0];
      expect(typeof record.fields.Name).toBe("string");
      expect(typeof record.fields.Rent).toBe("number");
      expect(record.fields.Date).toBeInstanceOf(Date);
      expect(typeof record.fields.Active).toBe("boolean");
      expect(typeof record.fields.Score).toBe("number");

      expect(record.fields.Name).toBe("Test Tenant");
      expect(record.fields.Rent).toBe(1000);
      expect(record.fields.Active).toBe(true);
      expect(record.fields.Score).toBe(85.5);
    });

    it("should handle validation rules", async () => {
      // Add validation rules
      mockMappingData.propertyMappings[0].rules[0].validation = {
        minLength: 2,
        maxLength: 50,
        pattern: "^[A-Za-z\\s]+$",
      };

      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      // Should pass validation
      expect(result.records).toHaveLength(2);
      expect(result.metadata.errors).toHaveLength(0);
    });

    it("should handle validation failures in lenient mode", async () => {
      // Add strict validation rule
      mockMappingData.propertyMappings[0].rules[0].validation = {
        pattern: "^[0-9]+$", // Only numbers allowed, but we have names
      };

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      // Should still process but with warnings
      expect(result.records).toHaveLength(2);
      expect(
        result.records[0].metadata.transformationWarnings.length,
      ).toBeGreaterThan(0);
    });
  });

  describe("convenience functions", () => {
    it("should work with transformFileData function", async () => {
      const result = await transformFileData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.propertyId).toBe("PROP001");
      expect(result.records).toHaveLength(2);
    });

    it("should work with transformMultipleFiles function", async () => {
      const multipleRawData = [mockRawData, { ...mockRawData }];
      multipleRawData[1].source.filename = "test2.csv";

      const results = await transformMultipleFiles(
        multipleRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(results).toHaveLength(2);
      expect(results[0].records).toHaveLength(2);
      expect(results[1].records).toHaveLength(2);
    });

    it("should handle errors in batch processing", async () => {
      const invalidRawData = {
        ...mockRawData,
        source: {
          ...mockRawData.source,
          propertyId: "INVALID_PROP",
        },
      };

      const multipleRawData = [mockRawData, invalidRawData];

      const results = await transformMultipleFiles(
        multipleRawData,
        mockMappingData,
        "test-correlation-id",
        { continueOnError: true },
      );

      // Should have one successful result (first file)
      expect(results).toHaveLength(1);
      expect(results[0].propertyId).toBe("PROP001");
    });
  });

  describe("transformation functions", () => {
    it("should handle uppercase transformation", async () => {
      mockMappingData.propertyMappings[0].rules[0].transformation = "uppercase";

      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.TenantName).toBe("  JOHN DOE  ");
    });

    it("should handle lowercase transformation", async () => {
      mockMappingData.propertyMappings[0].rules[0].transformation = "lowercase";

      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.TenantName).toBe("  john doe  ");
    });

    it("should handle date formatting", async () => {
      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.LeaseDate).toBe("2023-01-15");
    });

    it("should handle currency formatting", async () => {
      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.RentAmount).toBe("1250.00");
      expect(result.records[1].fields.RentAmount).toBe("875.50");
    });
  });

  describe("nested field extraction", () => {
    it("should extract nested field values", async () => {
      const nestedRawData = { ...mockRawData };
      nestedRawData.content.rows = [
        {
          tenant: {
            name: "John Doe",
            contact: {
              email: "john@example.com",
            },
          },
          rent_amount: "$1,250.00",
        },
      ];

      // Update mapping to use nested paths
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "tenant.name",
          targetField: "TenantName",
          dataType: "string",
          required: true,
        },
        {
          sourceField: "tenant.contact.email",
          targetField: "TenantEmail",
          dataType: "string",
          required: false,
        },
      ];

      const result = await engine.transformData(
        nestedRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.TenantName).toBe("John Doe");
      expect(result.records[0].fields.TenantEmail).toBe("john@example.com");
    });
  });

  describe("error handling", () => {
    it("should handle type conversion errors", async () => {
      const invalidTypeData = { ...mockRawData };
      invalidTypeData.content.rows = [
        {
          tenant_name: "John Doe",
          rent_amount: "not-a-number",
          lease_date: "invalid-date",
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        invalidTypeData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.metadata.errors.length).toBeGreaterThan(0);
      expect(result.metadata.errors[0].type).toBe("TRANSFORMATION_ERROR");
    });

    it("should respect max errors limit", async () => {
      const manyInvalidRecords = { ...mockRawData };
      manyInvalidRecords.content.rows = Array(20).fill({
        tenant_name: null, // Invalid
        rent_amount: "invalid",
        lease_date: "invalid",
      });

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 5,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        manyInvalidRecords,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.metadata.errors.length).toBeLessThanOrEqual(5);
      expect(result.metadata.warnings).toContain(
        "Stopped processing after 5 errors",
      );
    });
  });

  describe("edge cases and additional coverage", () => {
    it("should handle empty content arrays", async () => {
      const emptyRawData = { ...mockRawData };
      emptyRawData.content = { rows: [] };

      const result = await engine.transformData(
        emptyRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records).toHaveLength(0);
      expect(result.metadata.recordCount).toBe(0);
    });

    it("should handle content with non-array structure for CSV", async () => {
      const invalidStructureData = { ...mockRawData };
      invalidStructureData.content = { rows: "not-an-array" };

      const result = await engine.transformData(
        invalidStructureData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records).toHaveLength(0);
    });

    it("should handle TXT content with structured data array", async () => {
      const txtWithStructuredData: RawFileData = {
        source: {
          filename: "structured.txt",
          propertyId: "PROP001",
          fileType: "txt",
          parsedAt: new Date(),
        },
        content: {
          text: "Some text",
          structuredData: [
            { field1: "value1", field2: "value2" },
            { field1: "value3", field2: "value4" },
          ],
        },
        metadata: {
          recordCount: 2,
          processingTimeMs: 30,
          warnings: [],
        },
      };

      // Update mapping for TXT
      mockMappingData.propertyMappings[0].fileFormat = "txt";
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "field1",
          targetField: "Field1",
          dataType: "string",
          required: true,
        },
      ];

      const result = await engine.transformData(
        txtWithStructuredData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records).toHaveLength(2);
      expect(result.records[0].fields.Field1).toBe("value1");
      expect(result.records[1].fields.Field1).toBe("value3");
    });

    it("should handle unknown file types", async () => {
      const unknownTypeData = { ...mockRawData };
      unknownTypeData.source.fileType = "unknown" as TestFileType;

      // Update mapping to match unknown type
      mockMappingData.propertyMappings[0].fileFormat = "unknown" as TestFileType;
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "someField",
          targetField: "SomeField",
          dataType: "string",
          required: false,
        },
      ];

      const result = await engine.transformData(
        unknownTypeData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records).toHaveLength(1);
    });

    it("should handle transformation with undefined nested field", async () => {
      const nestedData = { ...mockRawData };
      nestedData.content.rows = [
        {
          tenant: {
            // Missing nested field
          },
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "tenant.missing.field",
          targetField: "MissingField",
          dataType: "string",
          required: false,
          defaultValue: "default",
        },
      ];

      const result = await engine.transformData(
        nestedData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.MissingField).toBe("default");
    });

    it("should handle custom transformation with missing function", async () => {
      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "tenant_name",
          targetField: "Name",
          dataType: "string",
          required: false,
          transformation: "custom",
          transformationParams: {
            functionName: "nonExistentFunction",
          },
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        mockRawData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(
        result.records[0].metadata.transformationWarnings.length,
      ).toBeGreaterThan(0);
    });

    it("should handle boolean conversion from numbers", async () => {
      const booleanTestData = { ...mockRawData };
      booleanTestData.content.rows = [
        {
          is_active: 1,
          is_verified: 0,
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "is_active",
          targetField: "Active",
          dataType: "boolean",
          required: true,
        },
        {
          sourceField: "is_verified",
          targetField: "Verified",
          dataType: "boolean",
          required: true,
        },
      ];

      const result = await engine.transformData(
        booleanTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.Active).toBe(true);
      expect(result.records[0].fields.Verified).toBe(false);
    });

    it("should handle validation with allowedValues that fails", async () => {
      const validationTestData = { ...mockRawData };
      validationTestData.content.rows = [
        {
          status: "invalid_status",
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "status",
          targetField: "Status",
          dataType: "string",
          required: true,
          validation: {
            allowedValues: ["active", "inactive", "pending"],
          },
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        validationTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(
        result.records[0].metadata.transformationWarnings.length,
      ).toBeGreaterThan(0);
      expect(result.records[0].metadata.transformationWarnings[0]).toContain(
        "Value not in allowed list",
      );
    });

    it("should handle validation with allowedValues that passes", async () => {
      const validationTestData = { ...mockRawData };
      validationTestData.content.rows = [
        {
          status: "active",
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "status",
          targetField: "Status",
          dataType: "string",
          required: true,
          validation: {
            allowedValues: ["active", "inactive", "pending"],
          },
        },
      ];

      const result = await engine.transformData(
        validationTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.Status).toBe("active");
      expect(result.records[0].metadata.transformationWarnings).toHaveLength(0);
    });

    it("should throw error in batch processing when continueOnError is false", async () => {
      const invalidRawData = {
        ...mockRawData,
        source: {
          ...mockRawData.source,
          propertyId: "INVALID_PROP",
        },
      };

      const multipleRawData = [mockRawData, invalidRawData];

      await expect(
        transformMultipleFiles(
          multipleRawData,
          mockMappingData,
          "test-correlation-id",
          { continueOnError: false },
        ),
      ).rejects.toThrow("No mapping found for property INVALID_PROP");
    });

    it("should handle validation with minLength failure", async () => {
      const validationTestData = { ...mockRawData };
      validationTestData.content.rows = [
        {
          name: "AB", // Too short
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "name",
          targetField: "Name",
          dataType: "string",
          required: true,
          validation: {
            minLength: 5,
          },
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        validationTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(
        result.records[0].metadata.transformationWarnings.length,
      ).toBeGreaterThan(0);
      expect(result.records[0].metadata.transformationWarnings[0]).toContain(
        "Value too short",
      );
    });

    it("should handle validation with maxLength failure", async () => {
      const validationTestData = { ...mockRawData };
      validationTestData.content.rows = [
        {
          name: "This is a very long name that exceeds the maximum length limit",
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "name",
          targetField: "Name",
          dataType: "string",
          required: true,
          validation: {
            maxLength: 10,
          },
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        validationTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(
        result.records[0].metadata.transformationWarnings.length,
      ).toBeGreaterThan(0);
      expect(result.records[0].metadata.transformationWarnings[0]).toContain(
        "Value too long",
      );
    });

    it("should handle boolean values that are already boolean", async () => {
      const booleanTestData = { ...mockRawData };
      booleanTestData.content.rows = [
        {
          is_active: true, // Already a boolean
          is_verified: false, // Already a boolean
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "is_active",
          targetField: "Active",
          dataType: "boolean",
          required: true,
        },
        {
          sourceField: "is_verified",
          targetField: "Verified",
          dataType: "boolean",
          required: true,
        },
      ];

      const result = await engine.transformData(
        booleanTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.Active).toBe(true);
      expect(result.records[0].fields.Verified).toBe(false);
    });

    it("should handle unknown data types (default case)", async () => {
      const unknownTypeData = { ...mockRawData };
      unknownTypeData.content.rows = [
        {
          custom_field: { complex: "object" },
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "custom_field",
          targetField: "CustomField",
          dataType: "unknown" as TestDataType, // Unknown type
          required: true,
        },
      ];

      const result = await engine.transformData(
        unknownTypeData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.CustomField).toEqual({
        complex: "object",
      });
    });

    it("should handle unknown transformation types (default case)", async () => {
      const transformationTestData = { ...mockRawData };
      transformationTestData.content.rows = [
        {
          name: "Test Name",
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "name",
          targetField: "Name",
          dataType: "string",
          required: true,
          transformation: "unknown_transformation" as TestTransformation, // Unknown transformation
        },
      ];

      const result = await engine.transformData(
        transformationTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.Name).toBe("Test Name"); // Should return unchanged
    });

    it("should handle date values that are already Date objects", async () => {
      const dateTestData = { ...mockRawData };
      const testDate = new Date("2023-01-15");
      dateTestData.content.rows = [
        {
          event_date: testDate, // Already a Date object
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "event_date",
          targetField: "EventDate",
          dataType: "date",
          required: true,
        },
      ];

      const result = await engine.transformData(
        dateTestData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(result.records[0].fields.EventDate).toBe(testDate);
    });

    it("should handle invalid date conversion errors", async () => {
      const invalidDateData = { ...mockRawData };
      invalidDateData.content.rows = [
        {
          invalid_date: "not-a-valid-date",
        },
      ];

      mockMappingData.propertyMappings[0].rules = [
        {
          sourceField: "invalid_date",
          targetField: "InvalidDate",
          dataType: "date",
          required: false, // Allow failure
        },
      ];

      const config: TransformationConfig = {
        continueOnError: true,
        maxErrors: 10,
        includeDebugInfo: false,
        validationMode: "lenient",
      };

      const engine = new TransformationEngine(config);
      const result = await engine.transformData(
        invalidDateData,
        mockMappingData,
        "test-correlation-id",
      );

      expect(
        result.records[0].metadata.transformationWarnings.length,
      ).toBeGreaterThan(0);
      expect(result.records[0].metadata.transformationWarnings[0]).toContain(
        "Cannot convert",
      );
    });
  });

  describe("index exports", () => {
    it("should export TransformationEngine class", () => {
      expect(TransformationModule.TransformationEngine).toBeDefined();
      expect(typeof TransformationModule.TransformationEngine).toBe("function");
    });

    it("should export convenience functions", () => {
      expect(TransformationModule.transformFileData).toBeDefined();
      expect(typeof TransformationModule.transformFileData).toBe("function");

      expect(TransformationModule.transformMultipleFiles).toBeDefined();
      expect(typeof TransformationModule.transformMultipleFiles).toBe(
        "function",
      );
    });
  });

  describe("statistics", () => {
    it("should provide transformation statistics", () => {
      const stats = engine.getStatistics();

      expect(stats).toHaveProperty("totalTransformations");
      expect(stats).toHaveProperty("averageProcessingTime");
      expect(stats).toHaveProperty("errorRate");
    });
  });
});
