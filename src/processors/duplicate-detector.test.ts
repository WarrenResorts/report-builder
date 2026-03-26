import { describe, it, expect, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { DuplicateDetector } from "./duplicate-detector";

// Mock the retry utility so tests don't wait for backoff delays
vi.mock("../utils/retry", () => ({
  retryS3Operation: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// Mock the logger
vi.mock("../utils/logger", () => ({
  createCorrelatedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

const CORRELATION_ID = "test-correlation-id";
const PROCESSED_BUCKET = "test-processed-bucket";

function makeS3Client(sendImpl: (input: unknown) => unknown): S3Client {
  return { send: vi.fn(sendImpl) } as unknown as S3Client;
}

describe("DuplicateDetector", () => {
  describe("buildMarkerKey", () => {
    it("sanitizes property name for S3 key", () => {
      const detector = new DuplicateDetector(
        makeS3Client(() => ({})),
        PROCESSED_BUCKET,
      );

      expect(
        detector.buildMarkerKey("Best Western Windsor Inn", "2026-02-26"),
      ).toBe("processed-markers/2026-02-26/best-western-windsor-inn.json");
    });

    it("handles property names with special characters", () => {
      const detector = new DuplicateDetector(
        makeS3Client(() => ({})),
        PROCESSED_BUCKET,
      );

      expect(
        detector.buildMarkerKey("THE BARD'S INN HOTEL", "2026-02-26"),
      ).toBe("processed-markers/2026-02-26/the-bard-s-inn-hotel.json");
    });

    it("strips leading and trailing hyphens", () => {
      const detector = new DuplicateDetector(
        makeS3Client(() => ({})),
        PROCESSED_BUCKET,
      );

      expect(detector.buildMarkerKey("  El Bonita  ", "2026-01-15")).toBe(
        "processed-markers/2026-01-15/el-bonita.json",
      );
    });

    it("collapses consecutive special characters to single hyphen", () => {
      const detector = new DuplicateDetector(
        makeS3Client(() => ({})),
        PROCESSED_BUCKET,
      );

      expect(detector.buildMarkerKey("BW Plus -- PONDERAY", "2026-02-01")).toBe(
        "processed-markers/2026-02-01/bw-plus-ponderay.json",
      );
    });
  });

  describe("checkIfProcessed", () => {
    it("returns false when no marker exists (404)", async () => {
      const notFoundError = Object.assign(new Error("Not Found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      });
      const s3Client = makeS3Client(() => {
        throw notFoundError;
      });

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const result = await detector.checkIfProcessed(
        "Best Western Windsor Inn",
        "2026-02-26",
        CORRELATION_ID,
      );

      expect(result.isAlreadyProcessed).toBe(false);
      expect(result.markerKey).toBe(
        "processed-markers/2026-02-26/best-western-windsor-inn.json",
      );
    });

    it("returns false when NoSuchKey error", async () => {
      const noSuchKeyError = Object.assign(new Error("No Such Key"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      });
      const s3Client = makeS3Client(() => {
        throw noSuchKeyError;
      });

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const result = await detector.checkIfProcessed(
        "Crown City Inn",
        "2026-02-26",
        CORRELATION_ID,
      );

      expect(result.isAlreadyProcessed).toBe(false);
    });

    it("returns true when marker exists", async () => {
      const s3Client = makeS3Client(() => ({
        LastModified: new Date("2026-02-27T20:05:00Z"),
        ContentLength: 250,
        ContentType: "application/json",
      }));

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const result = await detector.checkIfProcessed(
        "Best Western Windsor Inn",
        "2026-02-26",
        CORRELATION_ID,
      );

      expect(result.isAlreadyProcessed).toBe(true);
      expect(result.markerKey).toBe(
        "processed-markers/2026-02-26/best-western-windsor-inn.json",
      );
    });

    it("fails open (returns false) when S3 throws unexpected error", async () => {
      const unexpectedError = new Error("Internal Server Error");
      const s3Client = makeS3Client(() => {
        throw unexpectedError;
      });

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const result = await detector.checkIfProcessed(
        "Driftwood Inn",
        "2026-02-26",
        CORRELATION_ID,
      );

      // Should fail open - allow processing rather than silently dropping
      expect(result.isAlreadyProcessed).toBe(false);
    });
  });

  describe("markAsProcessed", () => {
    it("writes marker to correct S3 key with correct content", async () => {
      const putObjectMock = vi.fn().mockResolvedValue({});
      const s3Client = makeS3Client(putObjectMock);

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const metadata = {
        propertyName: "Best Western Windsor Inn",
        businessDate: "2026-02-26",
        processedAt: "2026-02-27T20:05:00.000Z",
        reportKeys: {
          je: "reports/2026-02-27/2026-02-26_JE.csv",
          statJE: "reports/2026-02-27/2026-02-26_StatJE.csv",
        },
        recordCount: 42,
        correlationId: CORRELATION_ID,
      };

      await detector.markAsProcessed(metadata, CORRELATION_ID);

      expect(putObjectMock).toHaveBeenCalledOnce();
      const callArg = putObjectMock.mock.calls[0][0];
      expect(callArg.input.Bucket).toBe(PROCESSED_BUCKET);
      expect(callArg.input.Key).toBe(
        "processed-markers/2026-02-26/best-western-windsor-inn.json",
      );
      expect(callArg.input.ContentType).toBe("application/json");

      const body = JSON.parse(callArg.input.Body as string);
      expect(body.propertyName).toBe("Best Western Windsor Inn");
      expect(body.businessDate).toBe("2026-02-26");
      expect(body.recordCount).toBe(42);
      expect(body.reportKeys.je).toBe("reports/2026-02-27/2026-02-26_JE.csv");
    });

    it("does not throw if S3 write fails (fails silently)", async () => {
      const s3Client = makeS3Client(() => {
        throw new Error("S3 write failed");
      });

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const metadata = {
        propertyName: "Crown City Inn",
        businessDate: "2026-02-26",
        processedAt: "2026-02-27T20:05:00.000Z",
        reportKeys: {
          je: "reports/2026-02-27/2026-02-26_JE.csv",
          statJE: "reports/2026-02-27/2026-02-26_StatJE.csv",
        },
        recordCount: 10,
        correlationId: CORRELATION_ID,
      };

      // Should NOT throw even when S3 fails
      await expect(
        detector.markAsProcessed(metadata, CORRELATION_ID),
      ).resolves.toBeUndefined();
    });

    it("includes S3 metadata headers with key info", async () => {
      const putObjectMock = vi.fn().mockResolvedValue({});
      const s3Client = makeS3Client(putObjectMock);

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      await detector.markAsProcessed(
        {
          propertyName: "El Bonita Motel",
          businessDate: "2026-02-26",
          processedAt: "2026-02-27T20:05:00.000Z",
          reportKeys: { je: "je.csv", statJE: "stat.csv" },
          recordCount: 5,
          correlationId: CORRELATION_ID,
        },
        CORRELATION_ID,
      );

      const callArg = putObjectMock.mock.calls[0][0];
      expect(callArg.input.Metadata.propertyName).toBe("El Bonita Motel");
      expect(callArg.input.Metadata.businessDate).toBe("2026-02-26");
      expect(callArg.input.Metadata.correlationId).toBe(CORRELATION_ID);
    });
  });

  describe("isNotFoundError (via checkIfProcessed)", () => {
    it("returns false (fails open) when a non-Error value is thrown", async () => {
      // Throw a plain string instead of an Error instance — exercises the
      // `return false` branch inside isNotFoundError for non-Error throws
      const s3Client = makeS3Client(() => {
        throw "unexpected string error"; // non-Error value exercises the isNotFoundError false branch
      });

      const detector = new DuplicateDetector(s3Client, PROCESSED_BUCKET);
      const result = await detector.checkIfProcessed(
        "Test Property",
        "2026-02-26",
        CORRELATION_ID,
      );

      // Fails open — allows processing rather than blocking
      expect(result.isAlreadyProcessed).toBe(false);
    });
  });
});
