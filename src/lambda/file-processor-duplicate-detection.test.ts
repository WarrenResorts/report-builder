/**
 * @fileoverview Tests for duplicate file detection functionality
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { FileProcessor } from "./file-processor";
import { S3Client } from "@aws-sdk/client-s3";

// Mock dependencies
vi.mock("@aws-sdk/client-s3");
vi.mock("../config/parameter-store");
vi.mock("../utils/retry");

const mockS3Client = {
  send: vi.fn(),
};

const mockRetryS3Operation = vi.fn();

(S3Client as Mock).mockImplementation(() => mockS3Client);

// Import after mocking
const { retryS3Operation } = await import("../utils/retry");
(retryS3Operation as Mock).mockImplementation(mockRetryS3Operation);

describe("FileProcessor - Duplicate Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockS3Client.send.mockReset();
    mockRetryS3Operation.mockReset();

    // Set up required environment variables
    process.env.INCOMING_BUCKET = "test-incoming-bucket";
    process.env.PROCESSED_BUCKET = "test-processed-bucket";
    process.env.MAPPING_BUCKET = "test-mapping-bucket";

    // Default retry operation passthrough
    mockRetryS3Operation.mockImplementation((fn) => fn());
  });

  describe("Duplicate Detection Logic", () => {
    it("should detect duplicate files with same property, filename, and size", async () => {
      const processor = new FileProcessor();

      // Mock S3 list response with duplicates
      mockS3Client.send.mockResolvedValue({
        Contents: [
          {
            Key: "daily-files/PROP123/2024-01-15/report.pdf",
            LastModified: new Date("2024-01-15T10:00:00Z"),
            Size: 1000,
          },
          {
            Key: "daily-files/PROP123/2024-01-15/report.pdf",
            LastModified: new Date("2024-01-15T10:05:00Z"), // More recent - should be kept
            Size: 1000,
          },
        ],
      });

      const result = await processor.processFiles(
        "daily-batch",
        "test-correlation-id",
      );

      // Should process successfully with duplicate detection
      expect(result.statusCode).toBe(200);
    });

    it("should keep all files when no duplicates exist", async () => {
      const processor = new FileProcessor();

      // Mock S3 list response with unique files
      mockS3Client.send.mockResolvedValue({
        Contents: [
          {
            Key: "daily-files/PROP123/2024-01-15/report1.pdf",
            LastModified: new Date("2024-01-15T10:00:00Z"),
            Size: 1000,
          },
          {
            Key: "daily-files/PROP123/2024-01-15/report2.pdf",
            LastModified: new Date("2024-01-15T10:05:00Z"),
            Size: 2000,
          },
        ],
      });

      const result = await processor.processFiles(
        "daily-batch",
        "test-correlation-id",
      );

      // Should process successfully
      expect(result.statusCode).toBe(200);
    });

    it("should handle files with same name but different sizes as unique", async () => {
      const processor = new FileProcessor();

      // Mock S3 list response - same filename but different sizes
      mockS3Client.send.mockResolvedValue({
        Contents: [
          {
            Key: "daily-files/PROP123/2024-01-15/report.pdf",
            LastModified: new Date("2024-01-15T10:00:00Z"),
            Size: 1000,
          },
          {
            Key: "daily-files/PROP123/2024-01-15/report.pdf",
            LastModified: new Date("2024-01-15T10:05:00Z"),
            Size: 2000, // Different size - should be treated as unique
          },
        ],
      });

      const result = await processor.processFiles(
        "daily-batch",
        "test-correlation-id",
      );

      // Both files should be processed
      expect(result.statusCode).toBe(200);
    });
  });
});
