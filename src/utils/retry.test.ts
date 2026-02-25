import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  retryOperation,
  retryS3Operation,
  retryParameterStoreOperation,
} from "./retry";

// Mock the logger
vi.mock("./logger", () => ({
  createCorrelatedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("Retry Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("retryOperation", () => {
    it("should succeed on first attempt", async () => {
      const mockOperation = vi.fn().mockResolvedValue("success");

      const result = await retryOperation(mockOperation, "test-correlation-id");

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it("should retry on retryable errors and eventually succeed", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("Service unavailable"))
        .mockResolvedValue("success");

      const result = await retryOperation(
        mockOperation,
        "test-correlation-id",
        {
          maxRetries: 3,
          baseDelay: 10, // Short delay for testing
        },
      );

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it("should fail immediately on non-retryable errors", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValue(new Error("Invalid input"));

      await expect(
        retryOperation(mockOperation, "test-correlation-id"),
      ).rejects.toThrow("Invalid input");

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it("should exhaust all retries and throw last error", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValue(new Error("Network timeout"));

      await expect(
        retryOperation(mockOperation, "test-correlation-id", {
          maxRetries: 2,
          baseDelay: 10,
        }),
      ).rejects.toThrow("Network timeout");

      expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should handle custom retry config", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValue("success");

      const result = await retryOperation(
        mockOperation,
        "test-correlation-id",
        {
          maxRetries: 1,
          baseDelay: 10,
        },
      );

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it("should handle unknown errors", async () => {
      const mockOperation = vi.fn().mockImplementation(() => {
        throw null; // Simulate null being thrown
      });

      await expect(
        retryOperation(mockOperation, "test-correlation-id"),
      ).rejects.toThrow("Cannot read properties of null");
    });

    it("should handle zero amounts configuration", async () => {
      const mockOperation = vi.fn().mockResolvedValue(0);

      const result = await retryOperation(mockOperation, "test-correlation-id");

      expect(result).toBe(0);
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe("retryS3Operation", () => {
    it("should successfully execute S3 operation", async () => {
      const mockOperation = vi.fn().mockResolvedValue({ data: "s3-data" });

      const result = await retryS3Operation(
        mockOperation,
        "test-correlation-id",
        "GetObject",
      );

      expect(result).toEqual({ data: "s3-data" });
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it("should retry S3 operation on failure", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValue({ data: "s3-data" });

      const result = await retryS3Operation(
        mockOperation,
        "test-correlation-id",
        "GetObject",
        { maxRetries: 1, baseDelay: 10 },
      );

      expect(result).toEqual({ data: "s3-data" });
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it("should throw error when S3 operation fails permanently", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValue(new Error("Invalid input"));

      await expect(
        retryS3Operation(mockOperation, "test-correlation-id", "GetObject"),
      ).rejects.toThrow("Invalid input");
    });
  });

  describe("retryParameterStoreOperation", () => {
    it("should successfully execute Parameter Store operation", async () => {
      const mockOperation = vi.fn().mockResolvedValue({ parameter: "value" });

      const result = await retryParameterStoreOperation(
        mockOperation,
        "test-correlation-id",
        "GetParameter",
      );

      expect(result).toEqual({ parameter: "value" });
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it("should retry Parameter Store operation on failure", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValueOnce(new Error("Service unavailable"))
        .mockResolvedValue({ parameter: "value" });

      const result = await retryParameterStoreOperation(
        mockOperation,
        "test-correlation-id",
        "GetParameter",
        { maxRetries: 1, baseDelay: 10 },
      );

      expect(result).toEqual({ parameter: "value" });
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it("should throw error when Parameter Store operation fails permanently", async () => {
      const mockOperation = vi
        .fn()
        .mockRejectedValue(new Error("Invalid parameter"));

      await expect(
        retryParameterStoreOperation(
          mockOperation,
          "test-correlation-id",
          "GetParameter",
        ),
      ).rejects.toThrow("Invalid parameter");
    });
  });
});
