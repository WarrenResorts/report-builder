import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createCorrelatedLogger } from "../utils/logger";
import { retryS3Operation } from "../utils/retry";

/**
 * Metadata stored in the processed marker file in S3.
 * Written after a property+date combination is successfully processed.
 */
export interface ProcessedMarkerMetadata {
  propertyName: string;
  businessDate: string;
  processedAt: string;
  reportKeys: {
    je: string;
    statJE: string;
  };
  recordCount: number;
  correlationId: string;
}

/**
 * Result of a duplicate check for a property+date combination.
 */
export interface DuplicateCheckResult {
  isAlreadyProcessed: boolean;
  markerKey: string;
  existingMetadata?: ProcessedMarkerMetadata;
}

/**
 * DuplicateDetector checks whether a property+date combination has already
 * been processed by looking for a marker file in S3.
 *
 * Uses S3 HeadObject for O(1) lookups - constant time regardless of
 * how many files have been processed historically.
 *
 * Marker files are stored at:
 *   processed-markers/{businessDate}/{sanitizedPropertyName}.json
 */
export class DuplicateDetector {
  private s3Client: S3Client;
  private processedBucket: string;

  constructor(s3Client: S3Client, processedBucket: string) {
    this.s3Client = s3Client;
    this.processedBucket = processedBucket;
  }

  /**
   * Check whether a property+date combination has already been processed.
   * Uses S3 HeadObject - fast, cheap, and scales infinitely.
   *
   * @param propertyName - Property name extracted from the PDF
   * @param businessDate - Business date in YYYY-MM-DD format
   * @param correlationId - Correlation ID for logging
   * @returns DuplicateCheckResult indicating whether already processed
   */
  async checkIfProcessed(
    propertyName: string,
    businessDate: string,
    correlationId: string,
  ): Promise<DuplicateCheckResult> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "duplicate_check",
      propertyName,
      businessDate,
    });

    const markerKey = this.buildMarkerKey(propertyName, businessDate);

    logger.debug("Checking for existing processed marker", {
      bucket: this.processedBucket,
      markerKey,
    });

    try {
      const response = await retryS3Operation(
        () =>
          this.s3Client.send(
            new HeadObjectCommand({
              Bucket: this.processedBucket,
              Key: markerKey,
            }),
          ),
        correlationId,
        "head_processed_marker",
        { maxRetries: 2, baseDelay: 500 },
      );

      // Marker exists - parse metadata from the stored content-type header
      // (full metadata is in the object body, but HeadObject gives us enough to confirm existence)
      logger.info("Processed marker found - property already processed", {
        markerKey,
        lastModified: response.LastModified?.toISOString(),
        operation: "duplicate_detected",
      });

      return {
        isAlreadyProcessed: true,
        markerKey,
      };
    } catch (error) {
      // 404 / NoSuchKey means not yet processed - this is the expected happy path
      if (this.isNotFoundError(error)) {
        logger.debug("No processed marker found - property not yet processed", {
          markerKey,
          operation: "no_duplicate",
        });

        return {
          isAlreadyProcessed: false,
          markerKey,
        };
      }

      // Any other error (permissions, network) - log and fail open (allow processing)
      // Better to process a duplicate than to silently drop a file
      logger.error(
        "Error checking processed marker - failing open to allow processing",
        error as Error,
        {
          markerKey,
          operation: "duplicate_check_error",
        },
      );

      return {
        isAlreadyProcessed: false,
        markerKey,
      };
    }
  }

  /**
   * Write a processed marker to S3 after a property+date has been successfully processed.
   * This marker is what future runs check to detect duplicates.
   *
   * @param metadata - Details about what was processed
   * @param correlationId - Correlation ID for logging
   */
  async markAsProcessed(
    metadata: ProcessedMarkerMetadata,
    correlationId: string,
  ): Promise<void> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "mark_as_processed",
      propertyName: metadata.propertyName,
      businessDate: metadata.businessDate,
    });

    const markerKey = this.buildMarkerKey(
      metadata.propertyName,
      metadata.businessDate,
    );

    logger.debug("Writing processed marker to S3", {
      bucket: this.processedBucket,
      markerKey,
    });

    try {
      await retryS3Operation(
        () =>
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.processedBucket,
              Key: markerKey,
              Body: JSON.stringify(metadata, null, 2),
              ContentType: "application/json",
              Metadata: {
                propertyName: metadata.propertyName,
                businessDate: metadata.businessDate,
                processedAt: metadata.processedAt,
                correlationId: metadata.correlationId,
              },
            }),
          ),
        correlationId,
        "put_processed_marker",
        { maxRetries: 3, baseDelay: 1000 },
      );

      logger.info("Processed marker written successfully", {
        markerKey,
        propertyName: metadata.propertyName,
        businessDate: metadata.businessDate,
        recordCount: metadata.recordCount,
        operation: "marker_written",
      });
    } catch (error) {
      // Log but don't throw - failure to write the marker shouldn't fail the processing run.
      // The report was already generated and emailed; worst case is a duplicate next run.
      logger.error(
        "Failed to write processed marker - duplicate detection may not work for next run",
        error as Error,
        {
          markerKey,
          operation: "marker_write_error",
        },
      );
    }
  }

  /**
   * Build the S3 key for a processed marker file.
   * Format: processed-markers/{businessDate}/{sanitizedPropertyName}.json
   */
  buildMarkerKey(propertyName: string, businessDate: string): string {
    const sanitizedName = propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `processed-markers/${businessDate}/${sanitizedName}.json`;
  }

  /**
   * Determine if an S3 error is a "not found" response (404).
   */
  private isNotFoundError(error: unknown): boolean {
    if (error instanceof Error) {
      const name = (error as any).name || "";
      const code = (error as any).$metadata?.httpStatusCode;
      return name === "NotFound" || name === "NoSuchKey" || code === 404;
    }
    return false;
  }
}
