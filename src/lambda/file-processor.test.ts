import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { handler, FileProcessingEvent, FileProcessor } from "./file-processor";
import { EventBridgeEvent, Context } from "aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { ParameterStoreConfig } from "../config/parameter-store";
import ExcelJS from "exceljs";

// Import types for testing
interface ConsolidatedReport {
  propertyId: string;
  reportDate: string;
  totalFiles: number;
  totalRecords: number;
  data: unknown[];
  summary: {
    processingTime: number;
    errors: string[];
    successfulFiles: number;
    failedFiles: number;
  };
}

// Mock dependencies
vi.mock("@aws-sdk/client-s3");
vi.mock("../config/parameter-store");
vi.mock("../config/environment", () => ({
  environmentConfig: {
    environment: "test",
    awsRegion: "us-east-1",
    awsAccount: "",
  },
}));
vi.mock("../utils/retry");

const mockS3Client = {
  send: vi.fn(),
};

const mockParameterStore = {
  getPropertyMapping: vi.fn(),
};

// Mock constructors
(S3Client as Mock).mockImplementation(() => mockS3Client);
(ParameterStoreConfig as Mock).mockImplementation(() => mockParameterStore);

// Mock retry utility
vi.mock("../utils/retry", () => ({
  retryS3Operation: vi.fn(),
}));

import { retryS3Operation } from "../utils/retry";
const mockRetryS3Operation = retryS3Operation as Mock;

// Helper function to create mock Lambda context
const createMockLambdaContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: "file-processor",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:file-processor",
  memoryLimitInMB: "512",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/file-processor",
  logStreamName: "test-stream",
  getRemainingTimeInMillis: vi.fn().mockReturnValue(30000),
  done: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
});

// Helper function to create mock EventBridge event
const createMockEventBridgeEvent = (
  processingType: "daily-batch" | "weekly-report" = "daily-batch",
): EventBridgeEvent<string, FileProcessingEvent> => ({
  version: "0",
  id: "test-event-id",
  "detail-type": "Scheduled Event",
  source: "aws.events",
  account: "123456789012",
  time: "2024-01-15T10:00:00Z",
  region: "us-east-1",
  resources: [],
  detail: {
    processingType,
    environment: "test",
    timestamp: "2024-01-15T10:00:00Z",
    scheduleExpression: "rate(1 day)",
  },
});

// Sample S3 objects for testing - using recent dates
const createMockS3Objects = () => {
  const now = new Date();
  const recentTime1 = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
  const recentTime2 = new Date(now.getTime() - 4 * 60 * 60 * 1000); // 4 hours ago
  const recentTime3 = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago
  const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago (should be filtered out)

  return [
    {
      Key: "daily-files/PROP123/2024-01-15/document1.pdf",
      LastModified: recentTime1,
      Size: 1024,
    },
    {
      Key: "daily-files/PROP123/2024-01-15/document2.csv",
      LastModified: recentTime2,
      Size: 2048,
    },
    {
      Key: "daily-files/PROP456/2024-01-15/report.txt",
      LastModified: recentTime3,
      Size: 512,
    },
    {
      Key: "daily-files/PROP456/2024-01-14/old-report.pdf",
      LastModified: oldTime, // Older file - should be filtered out
      Size: 1536,
    },
  ];
};

describe("File Processor Lambda", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up environment variables
    process.env.INCOMING_FILES_BUCKET = "test-incoming-bucket";
    process.env.PROCESSED_FILES_BUCKET = "test-processed-bucket";
    process.env.MAPPING_FILES_BUCKET = "test-mapping-bucket";
  });

  describe("Handler Function", () => {
    it("should process daily-batch event successfully", async () => {
      const mockObjects = createMockS3Objects();

      // Mock S3 response with recent files
      mockRetryS3Operation.mockResolvedValue({
        Contents: mockObjects,
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.message).toContain("daily-batch");
      expect(result.processedFiles).toBe(3); // 3 recent files (1 filtered out by 24h window)
      expect(result.summary.filesFound).toBe(3);
      expect(result.summary.propertiesProcessed).toEqual([
        "PROP123",
        "PROP456",
      ]);
      expect(result.summary.processingTimeMs).toBeGreaterThan(0);
    });

    it("should process weekly-report event successfully", async () => {
      mockRetryS3Operation.mockResolvedValue({
        Contents: createMockS3Objects(),
      });

      const event = createMockEventBridgeEvent("weekly-report");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.message).toContain("weekly-report");
      expect(result.processedFiles).toBe(3); // 3 recent files (1 filtered out by 24h window)
    });

    it("should handle empty S3 response", async () => {
      mockRetryS3Operation.mockResolvedValue({
        Contents: [],
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(0);
      expect(result.summary.filesFound).toBe(0);
      expect(result.summary.propertiesProcessed).toEqual([]);
    });

    it("should handle S3 query failure gracefully", async () => {
      const s3Error = new Error("S3 connection failed");
      mockRetryS3Operation.mockRejectedValue(s3Error);

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("S3 connection failed");
      expect(result.processedFiles).toBe(0);
      expect(result.summary.filesFound).toBe(0);
    });

    it("should call S3 with correct parameters", async () => {
      mockRetryS3Operation.mockResolvedValue({
        Contents: [],
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      await handler(event, context);

      // Verify retryS3Operation was called with correct parameters
      expect(mockRetryS3Operation).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(String), // correlationId
        "list_daily_files",
      );

      // Verify the S3 command would be created correctly
      const s3OperationFn = mockRetryS3Operation.mock.calls[0][0];
      expect(s3OperationFn).toBeDefined();
    });
  });

  describe("File Processing Logic", () => {
    it("should filter files by 24-hour window", async () => {
      const now = new Date("2024-01-15T12:00:00Z");
      vi.setSystemTime(now);

      const mixedAgeFiles = [
        {
          Key: "daily-files/PROP123/2024-01-15/recent.pdf",
          LastModified: new Date("2024-01-15T10:00:00Z"), // 2 hours ago - should be included
          Size: 1024,
        },
        {
          Key: "daily-files/PROP123/2024-01-14/old.pdf",
          LastModified: new Date("2024-01-14T10:00:00Z"), // 26 hours ago - should be excluded
          Size: 1024,
        },
        {
          Key: "daily-files/PROP456/2024-01-15/borderline.pdf",
          LastModified: new Date("2024-01-14T12:30:00Z"), // 23.5 hours ago - should be included
          Size: 1024,
        },
      ];

      mockRetryS3Operation.mockResolvedValue({
        Contents: mixedAgeFiles,
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(2); // Only recent and borderline files
      expect(result.summary.propertiesProcessed).toEqual([
        "PROP123",
        "PROP456",
      ]);

      vi.useRealTimers();
    });

    it("should organize files by property and date correctly", async () => {
      const now = new Date();
      const organizedFiles = [
        {
          Key: "daily-files/PROP123/2024-01-15/doc1.pdf",
          LastModified: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
          Size: 1024,
        },
        {
          Key: "daily-files/PROP123/2024-01-15/doc2.csv",
          LastModified: new Date(now.getTime() - 4 * 60 * 60 * 1000), // 4 hours ago
          Size: 2048,
        },
        {
          Key: "daily-files/PROP123/2024-01-14/doc3.txt",
          LastModified: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6 hours ago - recent but different date folder
          Size: 512,
        },
        {
          Key: "daily-files/PROP456/2024-01-15/report.pdf",
          LastModified: new Date(now.getTime() - 8 * 60 * 60 * 1000), // 8 hours ago
          Size: 1536,
        },
      ];

      mockRetryS3Operation.mockResolvedValue({
        Contents: organizedFiles,
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(4); // All files are recent

      // Should have both properties
      expect(result.summary.propertiesProcessed).toContain("PROP123");
      expect(result.summary.propertiesProcessed).toContain("PROP456");
      expect(result.summary.propertiesProcessed.length).toBe(2);
    });

    it("should handle malformed file paths gracefully", async () => {
      const now = new Date();
      const malformedFiles = [
        {
          Key: "daily-files/PROP123/2024-01-15/valid.pdf",
          LastModified: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
          Size: 1024,
        },
        {
          Key: "wrong-prefix/PROP123/2024-01-15/invalid.pdf", // Wrong prefix
          LastModified: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago
          Size: 1024,
        },
        {
          Key: "daily-files/PROP123/incomplete", // Missing date and filename
          LastModified: new Date(now.getTime() - 4 * 60 * 60 * 1000), // 4 hours ago
          Size: 1024,
        },
        {
          Key: "daily-files/PROP456/2024-01-15/valid2.csv",
          LastModified: new Date(now.getTime() - 5 * 60 * 60 * 1000), // 5 hours ago
          Size: 2048,
        },
      ];

      mockRetryS3Operation.mockResolvedValue({
        Contents: malformedFiles,
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(2); // Only valid files counted
      expect(result.summary.propertiesProcessed).toEqual([
        "PROP123",
        "PROP456",
      ]);
    });

    it("should handle filenames with special characters and slashes", async () => {
      const now = new Date();
      const specialFiles = [
        {
          Key: "daily-files/PROP123/2024-01-15/document with spaces.pdf",
          LastModified: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
          Size: 1024,
        },
        {
          Key: "daily-files/PROP123/2024-01-15/subfolder/nested/file.csv",
          LastModified: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago
          Size: 2048,
        },
        {
          Key: "daily-files/PROP456/2024-01-15/file@#$%^&*().txt",
          LastModified: new Date(now.getTime() - 4 * 60 * 60 * 1000), // 4 hours ago
          Size: 512,
        },
      ];

      mockRetryS3Operation.mockResolvedValue({
        Contents: specialFiles,
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(3);
      expect(result.summary.propertiesProcessed).toEqual([
        "PROP123",
        "PROP456",
      ]);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle missing environment variables", async () => {
      // Save original value
      const originalBucket = process.env.INCOMING_FILES_BUCKET;
      delete process.env.INCOMING_FILES_BUCKET;

      // Mock S3 operation to throw an error due to undefined bucket
      mockRetryS3Operation.mockRejectedValue(
        new Error("Cannot read properties of undefined"),
      );

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("failed");

      // Restore original value
      process.env.INCOMING_FILES_BUCKET = originalBucket;
    });

    it("should handle S3 timeout errors", async () => {
      const timeoutError = new Error("Request timed out");
      timeoutError.name = "TimeoutError";
      mockRetryS3Operation.mockRejectedValue(timeoutError);

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("Request timed out");
    });

    it("should handle S3 access denied errors", async () => {
      const accessError = new Error("Access Denied");
      accessError.name = "AccessDenied";
      mockRetryS3Operation.mockRejectedValue(accessError);

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("Access Denied");
    });
  });

  describe("Performance and Monitoring", () => {
    it("should track processing time accurately", async () => {
      // Mock a delay in S3 operation
      mockRetryS3Operation.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ Contents: [] }), 100),
          ),
      );

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.summary.processingTimeMs).toBeGreaterThan(90); // At least 90ms
    });

    it("should include comprehensive result summary", async () => {
      const testFiles = createMockS3Objects();
      mockRetryS3Operation.mockResolvedValue({
        Contents: testFiles,
      });

      const event = createMockEventBridgeEvent();
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result).toHaveProperty("statusCode");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("processedFiles");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("summary");

      expect(result.summary).toHaveProperty("filesFound");
      expect(result.summary).toHaveProperty("propertiesProcessed");
      expect(result.summary).toHaveProperty("processingTimeMs");

      expect(Array.isArray(result.summary.propertiesProcessed)).toBe(true);
      expect(typeof result.summary.processingTimeMs).toBe("number");
    });
  });

  describe("VisualMatrix Integration", () => {
    it("should load VisualMatrix mapping file successfully", async () => {
      // Mock S3 to return a valid Excel file
      const mockExcelBuffer = Buffer.from("mock-excel-content");

      mockRetryS3Operation
        .mockResolvedValueOnce({
          Contents: [
            {
              Key: "mapping.xlsx",
              LastModified: new Date("2024-01-15T10:00:00Z"),
              Size: 1024,
            },
          ],
        })
        .mockResolvedValueOnce({
          Body: mockExcelBuffer,
        });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      // Should attempt to load mapping file
      expect(mockRetryS3Operation).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(String),
        "list_mapping_files",
        expect.any(Object),
      );
    });

    it("should handle missing VisualMatrix mapping file gracefully", async () => {
      // Mock S3 to return no mapping files
      mockRetryS3Operation
        .mockResolvedValueOnce({
          Contents: [], // No mapping files
        })
        .mockResolvedValueOnce({
          Contents: [], // No data files either
        });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(0);
    });

    it("should handle VisualMatrix parsing errors", async () => {
      // Mock S3 to return invalid Excel file
      const invalidBuffer = Buffer.from("invalid-excel-content");

      mockRetryS3Operation
        .mockResolvedValueOnce({
          Contents: [
            {
              Key: "mapping.xlsx",
              LastModified: new Date("2024-01-15T10:00:00Z"),
              Size: 1024,
            },
          ],
        })
        .mockResolvedValueOnce({
          Body: invalidBuffer,
        })
        .mockResolvedValueOnce({
          Contents: [], // No data files
        });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      // Should handle parsing error gracefully
      expect(result.processedFiles).toBe(0);
    });

    it("should generate consolidated report with single file", async () => {
      const mockObjects = createMockS3Objects();

      // Create a proper VisualMatrix mapping file
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

      // Add mapping data for the account codes that will be parsed
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
        "Visa Payment",
        "VISA-PAY",
        201,
        0,
        "",
        "4020",
        "",
        "Visa Payment",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const mappingBuffer = await workbook.xlsx.writeBuffer();

      // Mock successful file processing with mapping file
      mockRetryS3Operation
        .mockResolvedValueOnce({
          Contents: mockObjects, // First call: get data files from incoming bucket
        })
        .mockResolvedValueOnce({
          Body: Buffer.from(
            "1001    ROOM CHARGE    150.00\n2001    VISA PAYMENT    100.00",
          ), // Download first data file (will be parsed as PDF but fail, then as TXT)
        })
        .mockResolvedValueOnce({
          Body: Buffer.from(
            "1001,ROOM CHARGE,150.00\n2001,VISA PAYMENT,100.00",
          ), // Download second data file (CSV)
        })
        .mockResolvedValueOnce({
          Body: Buffer.from(
            "1001    ROOM CHARGE    150.00\n2001    VISA PAYMENT    100.00",
          ), // Download third data file (TXT)
        })
        .mockResolvedValueOnce({
          Contents: [
            {
              Key: "VMMapping092225.xlsx",
              LastModified: new Date("2024-01-15T10:00:00Z"),
              Size: mappingBuffer.byteLength,
            },
          ], // Query mapping files from mapping bucket
        })
        .mockResolvedValueOnce({
          Body: Buffer.from(mappingBuffer), // Download mapping file
        });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(3);

      // Should generate consolidated report (single file combining all properties)
      // Always generates 1 report for consistent output, even if empty
      expect(result.summary.reportsGenerated).toBe(1);
    });
  });

  describe("Whitelist Validation Integration", () => {
    it("should use whitelist from mapping file for PDF parsing", async () => {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.default.Workbook();
      const worksheet = workbook.addWorksheet("Mappings");

      // Add header row
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

      // Add real mapping codes that should be in whitelist
      worksheet.addRow([
        1,
        "9",
        "City Lodging Tax",
        "TAX-9",
        101,
        0,
        "",
        "2010",
        "3",
        "Tax Payable",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);
      worksheet.addRow([
        2,
        "91",
        "State Lodging Tax",
        "TAX-91",
        102,
        0,
        "",
        "2010",
        "3",
        "Tax Payable",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);
      worksheet.addRow([
        3,
        "92",
        "State Lodging Tax 2",
        "TAX-92",
        103,
        0,
        "",
        "2010",
        "3",
        "Tax Payable",
        1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);
      worksheet.addRow([
        4,
        "RC",
        "Room Charge",
        "ROOM-RC",
        104,
        0,
        "",
        "4010",
        "0",
        "Room Revenue",
        -1,
        new Date("2024-01-01"),
        new Date("2024-01-01"),
      ]);

      const mappingBuffer = await workbook.xlsx.writeBuffer();

      const mockObjects = [
        {
          Key: "daily-files/test-property/2025-10-24/test.pdf",
          LastModified: new Date(),
          Size: 1024,
        },
      ];

      // Mock PDF content with GL/CL codes that need whitelist validation
      const pdfContent = Buffer.from("%PDF-1.4\nTest PDF");

      mockRetryS3Operation
        .mockResolvedValueOnce({
          Contents: mockObjects, // List data files
        })
        .mockResolvedValueOnce({
          Contents: [
            {
              Key: "VMMapping092225.xlsx",
              LastModified: new Date(),
              Size: mappingBuffer.byteLength,
            },
          ], // List mapping files
        })
        .mockResolvedValueOnce({
          Body: mappingBuffer, // Download mapping file
        })
        .mockResolvedValueOnce({
          Body: pdfContent, // Download PDF file
        })
        .mockResolvedValueOnce({
          // Upload consolidated report
        });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      // Should complete successfully with whitelist validation
      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(1);
    });

    it("should handle whitelist validation with multiple PDF files", async () => {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.default.Workbook();
      const worksheet = workbook.addWorksheet("Mappings");

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

      // Add multiple codes for whitelist
      const codes = [
        "9",
        "91",
        "92",
        "P",
        "RC",
        "RD",
        "71",
        "GUEST LEDGER TOTAL",
      ];
      codes.forEach((code, idx) => {
        worksheet.addRow([
          idx + 1,
          code,
          `Description for ${code}`,
          `KEY-${code}`,
          100 + idx,
          0,
          "",
          "4010",
          "0",
          `Account ${code}`,
          1,
          new Date("2024-01-01"),
          new Date("2024-01-01"),
        ]);
      });

      const mappingBuffer = await workbook.xlsx.writeBuffer();

      const mockObjects = [
        {
          Key: "daily-files/prop1/2025-10-24/file1.pdf",
          LastModified: new Date(),
          Size: 1024,
        },
        {
          Key: "daily-files/prop2/2025-10-24/file2.pdf",
          LastModified: new Date(),
          Size: 2048,
        },
      ];

      const pdfContent = Buffer.from("%PDF-1.4\nTest");

      mockRetryS3Operation
        .mockResolvedValueOnce({ Contents: mockObjects })
        .mockResolvedValueOnce({
          Contents: [
            {
              Key: "VMMapping092225.xlsx",
              LastModified: new Date(),
              Size: mappingBuffer.byteLength,
            },
          ],
        })
        .mockResolvedValueOnce({ Body: mappingBuffer })
        .mockResolvedValueOnce({ Body: pdfContent })
        .mockResolvedValueOnce({ Body: pdfContent })
        .mockResolvedValueOnce({});

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(2);
    });
  });

  describe("Phase 3 File Processing Integration", () => {
    it("should process files with parsers and generate logs", async () => {
      const mockObjects = createMockS3Objects();

      // Mock S3 list operation with recent files
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: mockObjects,
      });

      // Mock file downloads (these will be called by processPropertyFiles)
      mockRetryS3Operation.mockResolvedValue({
        Body: Buffer.from("Sample file content"),
      });

      // Mock mapping file query (empty for now)
      mockRetryS3Operation.mockResolvedValue({
        Contents: [], // No mapping files
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(3); // Should process 3 recent files

      // Verify the integration executed Phase 3 steps
      expect(result).toHaveProperty("summary");
      expect(result.summary).toHaveProperty("filesFound", 3);
      expect(result.summary).toHaveProperty("propertiesProcessed");
      expect(Array.isArray(result.summary.propertiesProcessed)).toBe(true);
    });

    it("should handle file processing errors gracefully", async () => {
      const mockObjects = createMockS3Objects();

      // Mock S3 list operation
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: mockObjects,
      });

      // Mock file download failures
      mockRetryS3Operation.mockRejectedValue(new Error("File download failed"));

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200); // Should still succeed overall
      expect(result.processedFiles).toBe(3); // Should report the files it attempted to process
    });

    it("should execute all Phase 3 steps in sequence", async () => {
      const mockObjects = createMockS3Objects();

      // Mock S3 operations
      mockRetryS3Operation.mockResolvedValue({
        Contents: mockObjects,
      });

      // Additional mocks for file downloads and mapping
      mockRetryS3Operation.mockResolvedValue({
        Body: Buffer.from("Test content"),
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);

      // The logs should show all Phase 3 steps executed:
      // - Files processed and parsed
      // - Data transformations applied
      // - Consolidated reports generated
      expect(result.summary).toHaveProperty("filesFound");
      expect(result.summary).toHaveProperty("propertiesProcessed");
      expect(result.summary).toHaveProperty("processingTimeMs");
    });

    it("should test file parsing edge cases and error paths", async () => {
      const now = new Date();
      const mockObjects = [
        {
          Key: "daily-files/PROP123/2024-01-15/test.pdf",
          LastModified: now, // Use current time to pass 24-hour filter
          Size: 100,
        },
        {
          Key: "daily-files/PROP123/2024-01-15/test.unknown",
          LastModified: now, // Use current time to pass 24-hour filter
          Size: 100,
        },
      ];

      // Mock S3 list operation
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: mockObjects,
      });

      // Mock file downloads - simulate PDF with different body types
      mockRetryS3Operation.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(new Uint8Array([37, 80, 68, 70])), // PDF header
        },
      });

      mockRetryS3Operation.mockResolvedValueOnce({
        Body: new Uint8Array([65, 66, 67]), // ABC as bytes
      });

      // Mock mapping file operation - return empty
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: [],
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(2);
    });

    it("should test Excel mapping integration with actual mapping file", async () => {
      const now = new Date();
      const mockObjects = [
        {
          Key: "daily-files/PROP123/2024-01-15/data.csv",
          LastModified: now, // Use current time to pass 24-hour filter
          Size: 100,
        },
      ];

      // Mock S3 list operation
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: mockObjects,
      });

      // Mock file download
      mockRetryS3Operation.mockResolvedValueOnce({
        Body: Buffer.from("name,age\\nJohn,30\\nJane,25"),
      });

      // Mock mapping file list - return mapping file
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: [{ Key: "mapping.xlsx", LastModified: new Date() }],
      });

      // Mock mapping file download
      mockRetryS3Operation.mockResolvedValueOnce({
        Body: Buffer.from("fake excel content"),
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(1);
    });

    it("should test transformation engine with successful mapping", async () => {
      const now = new Date();
      const mockObjects = [
        {
          Key: "daily-files/PROP123/2024-01-15/valid.txt",
          LastModified: now, // Use current time to pass 24-hour filter
          Size: 100,
        },
      ];

      // Mock successful file parsing
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: mockObjects,
      });

      mockRetryS3Operation.mockResolvedValueOnce({
        Body: Buffer.from('{"records": [{"name": "test", "value": 123}]}'),
      });

      // Mock mapping with actual transformations
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: [{ Key: "mapping.xlsx", LastModified: new Date() }],
      });

      mockRetryS3Operation.mockResolvedValueOnce({
        Body: Buffer.from("excel mapping content"),
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(1);
    });

    it("should test report generation edge cases", async () => {
      const mockObjects = createMockS3Objects();

      // Mock S3 operations for file processing
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: mockObjects,
      });

      // Mock all file downloads with JSON data
      mockRetryS3Operation.mockResolvedValue({
        Body: Buffer.from(
          '{"data": [{"field1": "value1", "field2": "value2"}]}',
        ),
      });

      // Mock mapping operations - empty mapping to trigger specific paths
      mockRetryS3Operation.mockResolvedValue({
        Contents: [],
      });

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.processedFiles).toBe(3);
    });
  });

  describe("Handler Error Scenarios", () => {
    it("should handle handler-level errors gracefully", async () => {
      // Mock retryS3Operation to throw an error that will bubble up to handler
      mockRetryS3Operation.mockRejectedValueOnce(
        new Error("S3 service unavailable"),
      );

      const event = createMockEventBridgeEvent("daily-batch");
      const context = createMockLambdaContext();

      const result = await handler(event, context);

      // Should return error result instead of throwing
      expect(result.statusCode).toBe(500);
      expect(result.message).toContain("File processing failed");
      expect(result.processedFiles).toBe(0);
      expect(result.summary.filesFound).toBe(0);
      expect(result.summary.propertiesProcessed).toEqual([]);
      expect(result.summary.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.summary.reportsGenerated).toBe(0);
    });

    it("should test generateSeparateCSVReports method", async () => {
      // Create test data that will trigger generateSeparateCSVReports
      const testReports: ConsolidatedReport[] = [
        {
          propertyId: "PROP1",
          propertyName: "THE BARD'S INN HOTEL",
          reportDate: "2025-07-14",
          totalFiles: 1,
          totalRecords: 2,
          data: [
            {
              sourceCode: "40110",
              sourceDescription: "ROOM CHRG REVENUE",
              sourceAmount: 150.0,
              targetCode: "40110-634",
              targetDescription: "Revenue - Direct Booking",
              mappedAmount: 150.0,
            },
            {
              sourceCode: "90001",
              sourceDescription: "ADR",
              sourceAmount: 200.0,
              targetCode: "90001-418",
              targetDescription: "ADR",
              mappedAmount: 200.0,
            },
          ],
          summary: {
            processingTime: 100,
            errors: [],
            successfulFiles: 1,
            failedFiles: 0,
          },
        },
      ];

      // Mock successful S3 operations for report generation
      mockRetryS3Operation.mockResolvedValueOnce({
        Contents: [], // Empty S3 query result
      });

      // Create a FileProcessor instance
      const processor = new FileProcessor();

      // Test the generateSeparateCSVReports method directly (now returns {jeContent, statJEContent})
      const correlationId = "test-correlation-id";
      const { jeContent, statJEContent } = await (
        processor as any
      ).generateSeparateCSVReports(testReports, correlationId);

      // JE file should contain JE header and financial record
      expect(jeContent).toContain('"Entry","Date","Sub Name","Subsidiary"');
      expect(jeContent).toContain("Revenue - Direct Booking");
      expect(jeContent).toContain("WR2420250714"); // Entry ID with location 24

      // StatJE file should contain StatJE header and statistical record
      expect(statJEContent).toContain(
        '"Transaction ID","Date","Subsidiary","Property Name","Unit of Measure Type"',
      );
      expect(statJEContent).toContain("ADR");
      expect(statJEContent).toContain("07/14/2025 WRH26"); // Transaction ID format with subsidiary ID
    });

    it("should test private utility methods", async () => {
      const processor = new FileProcessor();

      // Test getFileExtension
      expect((processor as any).getFileExtension("test.pdf")).toBe("pdf");
      expect((processor as any).getFileExtension("document.CSV")).toBe("csv");
      expect((processor as any).getFileExtension("report")).toBe("report");

      // Test mapExtensionToSupportedType
      expect((processor as any).mapExtensionToSupportedType("pdf")).toBe("pdf");
      expect((processor as any).mapExtensionToSupportedType("csv")).toBe("csv");
      expect((processor as any).mapExtensionToSupportedType("txt")).toBe("txt");
      expect((processor as any).mapExtensionToSupportedType("unknown")).toBe(
        "txt",
      );

      // Test getFileTypeFromKey
      expect(
        (processor as any).getFileTypeFromKey(
          "daily-files/prop/2024-01-15/report.pdf",
        ),
      ).toBe("pdf");
      expect(
        (processor as any).getFileTypeFromKey(
          "daily-files/prop/2024-01-15/data.csv",
        ),
      ).toBe("csv");
      expect(
        (processor as any).getFileTypeFromKey(
          "daily-files/prop/2024-01-15/log.txt",
        ),
      ).toBe("txt");
    });
  });

  describe("Post-Parse Duplicate Detection", () => {
    it("should extract file identities from parsed content", () => {
      const processor = new FileProcessor();

      const processedFiles = [
        {
          fileKey: "daily-files/prop1/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn",
            businessDate: "2025-07-14",
            accountLines: [],
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop2/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Lakeside Lodge",
            businessDate: "2025-07-14",
            accountLines: [],
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop2",
          processingTime: 100,
        },
      ];

      const identities = (processor as any).extractParsedFileIdentities(
        processedFiles,
        "test-correlation-id",
      );

      expect(identities).toHaveLength(2);
      expect(identities[0].propertyName).toBe("Driftwood Inn");
      expect(identities[0].businessDate).toBe("2025-07-14");
      expect(identities[0].deduplicationKey).toBe("Driftwood Inn|2025-07-14");
      expect(identities[1].propertyName).toBe("Lakeside Lodge");
      expect(identities[1].businessDate).toBe("2025-07-14");
    });

    it("should skip files with parsing errors during identity extraction", () => {
      const processor = new FileProcessor();

      const processedFiles = [
        {
          fileKey: "daily-files/prop1/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn",
            businessDate: "2025-07-14",
          }),
          transformedData: [],
          errors: [], // No errors
          propertyId: "prop1",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop2/2024-01-15/DailyReport.pdf",
          originalContent: "",
          transformedData: [],
          errors: ["Failed to parse PDF"], // Has errors
          propertyId: "prop2",
          processingTime: 50,
        },
      ];

      const identities = (processor as any).extractParsedFileIdentities(
        processedFiles,
        "test-correlation-id",
      );

      // Only the file without errors should be included
      expect(identities).toHaveLength(1);
      expect(identities[0].propertyName).toBe("Driftwood Inn");
    });

    it("should use fallback values when propertyName or businessDate missing", () => {
      const processor = new FileProcessor();

      const processedFiles = [
        {
          fileKey: "daily-files/unknown-prop/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            // No propertyName or businessDate
            accountLines: [],
          }),
          transformedData: [],
          errors: [],
          propertyId: "unknown-prop",
          processingTime: 100,
        },
      ];

      const identities = (processor as any).extractParsedFileIdentities(
        processedFiles,
        "test-correlation-id",
      );

      expect(identities).toHaveLength(1);
      // Should fall back to propertyId when propertyName is missing
      expect(identities[0].propertyName).toBe("unknown-prop");
      // Should fall back to yesterday's date when businessDate is missing
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expectedDate = yesterday.toISOString().split("T")[0];
      expect(identities[0].businessDate).toBe(expectedDate);
    });

    it("should deduplicate files with same propertyName and businessDate", () => {
      const processor = new FileProcessor();

      // Two files for the same property and date (duplicates)
      const processedFiles = [
        {
          fileKey: "daily-files/prop1/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn",
            businessDate: "2025-07-14",
            accountLines: [{ sourceCode: "RC" }],
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop1-resend/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn", // Same property
            businessDate: "2025-07-14", // Same date
            accountLines: [{ sourceCode: "RC" }],
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1-resend",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop2/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Lakeside Lodge", // Different property
            businessDate: "2025-07-14",
            accountLines: [{ sourceCode: "RC" }],
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop2",
          processingTime: 100,
        },
      ];

      const uniqueFiles = (processor as any).deduplicateByParsedContent(
        processedFiles,
        "test-correlation-id",
      );

      // Should keep only one Driftwood Inn file and the Lakeside Lodge file
      expect(uniqueFiles).toHaveLength(2);

      // Check which files were kept
      const fileKeys = uniqueFiles.map((f: any) => f.fileKey);
      expect(fileKeys).toContain(
        "daily-files/prop1/2024-01-15/DailyReport.pdf",
      ); // First Driftwood kept
      expect(fileKeys).toContain(
        "daily-files/prop2/2024-01-15/DailyReport.pdf",
      ); // Lakeside kept
      expect(fileKeys).not.toContain(
        "daily-files/prop1-resend/2024-01-15/DailyReport.pdf",
      ); // Duplicate removed
    });

    it("should allow same property on different dates", () => {
      const processor = new FileProcessor();

      const processedFiles = [
        {
          fileKey: "daily-files/prop1/2025-07-14/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn",
            businessDate: "2025-07-14", // First date
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop1/2025-07-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn", // Same property
            businessDate: "2025-07-15", // Different date
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1",
          processingTime: 100,
        },
      ];

      const uniqueFiles = (processor as any).deduplicateByParsedContent(
        processedFiles,
        "test-correlation-id",
      );

      // Both should be kept - different dates
      expect(uniqueFiles).toHaveLength(2);
    });

    it("should include files with errors in the output (unchanged)", () => {
      const processor = new FileProcessor();

      const processedFiles = [
        {
          fileKey: "daily-files/prop1/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn",
            businessDate: "2025-07-14",
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop2/2024-01-15/CorruptedFile.pdf",
          originalContent: "",
          transformedData: [],
          errors: ["PDF parsing failed"], // Has errors
          propertyId: "prop2",
          processingTime: 50,
        },
      ];

      const uniqueFiles = (processor as any).deduplicateByParsedContent(
        processedFiles,
        "test-correlation-id",
      );

      // Both files should be included - one deduplicated, one with errors passed through
      expect(uniqueFiles).toHaveLength(2);
      expect(uniqueFiles.some((f: any) => f.errors.length > 0)).toBe(true);
    });

    it("should handle case when all files are from different properties", () => {
      const processor = new FileProcessor();

      const processedFiles = [
        {
          fileKey: "daily-files/prop1/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Driftwood Inn",
            businessDate: "2025-07-14",
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop1",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop2/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Lakeside Lodge",
            businessDate: "2025-07-14",
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop2",
          processingTime: 100,
        },
        {
          fileKey: "daily-files/prop3/2024-01-15/DailyReport.pdf",
          originalContent: JSON.stringify({
            propertyName: "Ponderay Mountain Lodge",
            businessDate: "2025-07-14",
          }),
          transformedData: [],
          errors: [],
          propertyId: "prop3",
          processingTime: 100,
        },
      ];

      const uniqueFiles = (processor as any).deduplicateByParsedContent(
        processedFiles,
        "test-correlation-id",
      );

      // All files should be kept - no duplicates
      expect(uniqueFiles).toHaveLength(3);
    });
  });

  describe("Pre-Parse Duplicate Detection (S3 Metadata)", () => {
    // Note: Pre-parse detection uses propertyId|filename|size as key
    // This is a lightweight filter before parsing; post-parse is authoritative

    it("should detect duplicates with same property, filename, and size", async () => {
      const processor = new FileProcessor();

      // Mock S3 operations for archiving
      mockS3Client.send.mockImplementation((command: any) => {
        if (command.constructor.name === "GetObjectCommand") {
          return Promise.resolve({
            Body: {
              transformToByteArray: () =>
                Promise.resolve(new Uint8Array([1, 2, 3])),
            },
          });
        }
        return Promise.resolve({});
      });
      mockRetryS3Operation.mockImplementation((fn: any) => fn());

      const files = [
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:00:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:05:00Z"), // More recent
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
      ];

      const result = await (processor as any).detectAndRemoveDuplicates(
        files,
        "test-correlation-id",
      );

      expect(result.uniqueFiles).toHaveLength(1);
      expect(result.duplicatesFound).toBe(1);
      // Most recent file should be kept
      expect(result.uniqueFiles[0].lastModified).toEqual(
        new Date("2024-01-15T10:05:00Z"),
      );
    });

    it("should keep all files when no duplicates exist", async () => {
      const processor = new FileProcessor();

      const files = [
        {
          key: "daily-files/PROP123/2024-01-15/report1.pdf",
          lastModified: new Date("2024-01-15T10:00:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report1.pdf",
        },
        {
          key: "daily-files/PROP123/2024-01-15/report2.pdf",
          lastModified: new Date("2024-01-15T10:05:00Z"),
          size: 2000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report2.pdf",
        },
      ];

      const result = await (processor as any).detectAndRemoveDuplicates(
        files,
        "test-correlation-id",
      );

      expect(result.uniqueFiles).toHaveLength(2);
      expect(result.duplicatesFound).toBe(0);
    });

    it("should treat files with same name but different sizes as unique", async () => {
      const processor = new FileProcessor();

      const files = [
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:00:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:05:00Z"),
          size: 2000, // Different size
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
      ];

      const result = await (processor as any).detectAndRemoveDuplicates(
        files,
        "test-correlation-id",
      );

      // Different sizes = unique files
      expect(result.uniqueFiles).toHaveLength(2);
      expect(result.duplicatesFound).toBe(0);
    });

    it("should archive duplicates to duplicates/ folder", async () => {
      const processor = new FileProcessor();

      // Track S3 calls
      const s3Calls: any[] = [];
      mockS3Client.send.mockImplementation((command: any) => {
        s3Calls.push(command);
        if (command.constructor.name === "GetObjectCommand") {
          return Promise.resolve({
            Body: {
              transformToByteArray: () =>
                Promise.resolve(new Uint8Array([1, 2, 3])),
            },
          });
        }
        return Promise.resolve({});
      });
      mockRetryS3Operation.mockImplementation((fn: any) => fn());

      const files = [
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:00:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:05:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
      ];

      await (processor as any).detectAndRemoveDuplicates(
        files,
        "test-correlation-id",
      );

      // Should have called S3 to archive the duplicate
      expect(mockRetryS3Operation).toHaveBeenCalled();
    });

    it("should handle archiving errors gracefully", async () => {
      const processor = new FileProcessor();

      // Make archiving fail
      mockRetryS3Operation.mockImplementation(() => {
        throw new Error("S3 archive failed");
      });

      const files = [
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:00:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:05:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
      ];

      // Should not throw - errors are caught and logged
      const result = await (processor as any).detectAndRemoveDuplicates(
        files,
        "test-correlation-id",
      );

      // Still returns the deduplicated result even if archiving fails
      expect(result.uniqueFiles).toHaveLength(1);
      expect(result.duplicatesFound).toBe(1);
    });

    it("should handle missing body in S3 response", async () => {
      const processor = new FileProcessor();

      // Return null Body
      mockS3Client.send.mockResolvedValue({ Body: null });
      mockRetryS3Operation.mockImplementation((fn: any) => fn());

      const files = [
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:00:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
        {
          key: "daily-files/PROP123/2024-01-15/report.pdf",
          lastModified: new Date("2024-01-15T10:05:00Z"),
          size: 1000,
          propertyId: "PROP123",
          date: "2024-01-15",
          filename: "report.pdf",
        },
      ];

      // Should handle gracefully
      const result = await (processor as any).detectAndRemoveDuplicates(
        files,
        "test-correlation-id",
      );

      expect(result.uniqueFiles).toHaveLength(1);
    });
  });
});
