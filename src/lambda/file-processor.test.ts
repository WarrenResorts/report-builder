import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { handler } from "./file-processor";
import { EventBridgeEvent, Context } from "aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { ParameterStoreConfig } from "../config/parameter-store";

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
): EventBridgeEvent<string, any> => ({
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
});
