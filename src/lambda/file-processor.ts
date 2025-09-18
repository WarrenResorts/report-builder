/**
 * File Processor Lambda Function
 *
 * Processes accumulated files from S3 on a scheduled basis, transforming them
 * using mapping rules and generating consolidated reports.
 *
 * Key responsibilities:
 * - Query S3 for files from the last 24 hours
 * - Organize files by property and date
 * - Process and transform file data using mapping rules
 * - Generate consolidated CSV reports
 * - Store processed results in S3
 */

import {
  S3Client,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { EventBridgeEvent, Context } from "aws-lambda";
import { createCorrelatedLogger } from "../utils/logger";
import { generateCorrelationId } from "../types/errors";
import { ParameterStoreConfig } from "../config/parameter-store";
import { environmentConfig } from "../config/environment";
import { retryS3Operation } from "../utils/retry";

/**
 * Interface for the file processing event
 */
interface FileProcessingEvent {
  processingType: "daily-batch" | "weekly-report";
  environment: string;
  timestamp: string;
  scheduleExpression: string;
}

/**
 * Interface for the file processing result
 */
interface FileProcessingResult {
  statusCode: number;
  message: string;
  processedFiles: number;
  timestamp: string;
  summary: {
    filesFound: number;
    propertiesProcessed: string[];
    processingTimeMs: number;
  };
}

/**
 * Interface for S3 file metadata
 */
interface S3FileInfo {
  key: string;
  lastModified: Date;
  size: number;
  propertyId: string;
  date: string;
  filename: string;
}

/**
 * Interface for organized files by property and date
 */
interface OrganizedFiles {
  [propertyId: string]: {
    [date: string]: S3FileInfo[];
  };
}

/**
 * FileProcessor handles batch processing of accumulated files from S3.
 * 
 * This class encapsulates the core file processing logic:
 * - Queries S3 for files from the last 24 hours
 * - Organizes files by property and date
 * - Provides foundation for file parsing and transformation
 */
class FileProcessor {
  private s3Client: S3Client;
  private parameterStore: ParameterStoreConfig;
  private incomingBucket: string;
  private processedBucket: string;
  private mappingBucket: string;

  constructor() {
    this.s3Client = new S3Client({
      region: environmentConfig.awsRegion,
    });
    this.parameterStore = new ParameterStoreConfig();
    
    // Get bucket names from environment variables (set by CDK)
    this.incomingBucket = process.env.INCOMING_FILES_BUCKET!;
    this.processedBucket = process.env.PROCESSED_FILES_BUCKET!;
    this.mappingBucket = process.env.MAPPING_FILES_BUCKET!;
  }

  /**
   * Process files for the given processing type and time window
   */
  async processFiles(
    processingType: "daily-batch" | "weekly-report",
    correlationId: string
  ): Promise<FileProcessingResult> {
    const startTime = Date.now();
    const logger = createCorrelatedLogger(correlationId, {
      operation: "file_processor",
    });

    logger.info("Starting file processing", {
      processingType,
      incomingBucket: this.incomingBucket,
      operation: "process_files_start",
    });

    try {
      // Step 1: Query S3 for files from the last 24 hours
      const files = await this.getFilesFromLast24Hours(correlationId);
      
      logger.info("Files retrieved from S3", {
        fileCount: files.length,
        operation: "files_retrieved",
      });

      // Step 2: Organize files by property and date
      const organizedFiles = this.organizeFilesByPropertyAndDate(files);
      
      const propertiesProcessed = Object.keys(organizedFiles);
      logger.info("Files organized by property", {
        propertiesCount: propertiesProcessed.length,
        properties: propertiesProcessed,
        operation: "files_organized",
      });

      // TODO: Step 3: Process each property's files (Phase 3B)
      // TODO: Step 4: Apply mapping transformations (Phase 3C)
      // TODO: Step 5: Generate consolidated reports (Phase 3D)

      const processingTimeMs = Date.now() - startTime;
      
      return {
        statusCode: 200,
        message: `File processing completed for ${processingType}`,
        processedFiles: files.length,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: files.length,
          propertiesProcessed,
          processingTimeMs,
        },
      };

    } catch (error) {
      logger.error("File processing failed", error as Error, {
        operation: "process_files_error",
        processingTimeMs: Date.now() - startTime,
      });
      
      return {
        statusCode: 500,
        message: `File processing failed: ${(error as Error).message}`,
        processedFiles: 0,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: 0,
          propertiesProcessed: [],
          processingTimeMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Query S3 for files from the last 24 hours in the daily-files prefix
   */
  private async getFilesFromLast24Hours(correlationId: string): Promise<S3FileInfo[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "get_files_24h",
    });

    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    const files: S3FileInfo[] = [];

    logger.info("Querying S3 for recent files", {
      bucket: this.incomingBucket,
      cutoffTime: cutoffTime.toISOString(),
      operation: "s3_query_start",
    });

    try {
      // List objects with the daily-files prefix (where email processor stores attachments)
      const command = new ListObjectsV2Command({
        Bucket: this.incomingBucket,
        Prefix: "daily-files/",
      });

      const response = await retryS3Operation(
        () => this.s3Client.send(command), 
        correlationId,
        "list_daily_files"
      );
      
      if (!response.Contents) {
        logger.info("No files found in S3", {
          operation: "s3_query_empty",
        });
        return files;
      }

      // Filter files by last modified time and extract metadata
      for (const object of response.Contents) {
        if (!object.Key || !object.LastModified || !object.Size) continue;

        // Only include files modified in the last 24 hours
        if (object.LastModified >= cutoffTime) {
          const fileInfo = this.parseS3FileKey(object.Key, object.LastModified, object.Size);
          if (fileInfo) {
            files.push(fileInfo);
          }
        }
      }

      logger.info("S3 query completed", {
        totalObjects: response.Contents.length,
        recentFiles: files.length,
        operation: "s3_query_complete",
      });

      return files;

    } catch (error) {
      logger.error("Failed to query S3 for files", error as Error, {
        bucket: this.incomingBucket,
        operation: "s3_query_error",
      });
      throw error;
    }
  }

  /**
   * Parse S3 file key to extract property ID, date, and filename
   * Expected format: daily-files/{propertyId}/{date}/{filename}
   */
  private parseS3FileKey(key: string, lastModified: Date, size: number): S3FileInfo | null {
    // Expected format: daily-files/{propertyId}/{date}/{filename}
    const parts = key.split('/');
    
    if (parts.length < 4 || parts[0] !== 'daily-files') {
      return null; // Invalid format
    }

    const propertyId = parts[1];
    const date = parts[2];
    const filename = parts.slice(3).join('/'); // Handle filenames with slashes

    return {
      key,
      lastModified,
      size,
      propertyId,
      date,
      filename,
    };
  }

  /**
   * Organize files by property ID and date for structured processing
   */
  private organizeFilesByPropertyAndDate(files: S3FileInfo[]): OrganizedFiles {
    const organized: OrganizedFiles = {};

    for (const file of files) {
      if (!organized[file.propertyId]) {
        organized[file.propertyId] = {};
      }
      
      if (!organized[file.propertyId][file.date]) {
        organized[file.propertyId][file.date] = [];
      }
      
      organized[file.propertyId][file.date].push(file);
    }

    return organized;
  }
}

/**
 * AWS Lambda handler function for processing files
 *
 * This function is triggered by EventBridge on a schedule to process
 * accumulated files and generate reports.
 *
 * @param event - EventBridge event containing processing instructions
 * @param context - Lambda context for tracking and timeout information
 * @returns Promise resolving to processing result
 */
export const handler = async (
  event: EventBridgeEvent<string, FileProcessingEvent>,
  context: Context,
): Promise<FileProcessingResult> => {
  // Generate correlation ID for request tracking
  const correlationId = generateCorrelationId();
  const logger = createCorrelatedLogger(correlationId, {
    requestId: context.awsRequestId,
    functionName: context.functionName,
    operation: "file_processing_handler",
  });

  logger.info("File processor Lambda invoked", {
    eventType: event["detail-type"],
    source: event.source,
    eventDetail: event.detail,
    remainingTimeMs: context.getRemainingTimeInMillis(),
  });

  const { detail } = event;
  const { processingType, environment, timestamp } = detail;

  logger.info("Starting file processing handler", {
    processingType,
    environment,
    scheduledTimestamp: timestamp,
    operation: "handler_start",
  });

  try {
    // Create file processor instance and delegate processing
    const processor = new FileProcessor();
    const result = await processor.processFiles(processingType, correlationId);

    logger.info("File processing handler completed successfully", {
      statusCode: result.statusCode,
      processedFiles: result.processedFiles,
      processingTimeMs: result.summary.processingTimeMs,
      operation: "handler_success",
    });

    return result;

  } catch (error) {
    logger.error("File processing handler failed", error as Error, {
      operation: "handler_error",
      remainingTimeMs: context.getRemainingTimeInMillis(),
    });

    // Return error result instead of throwing to avoid DLQ
    return {
      statusCode: 500,
      message: `File processing handler failed: ${(error as Error).message}`,
      processedFiles: 0,
      timestamp: new Date().toISOString(),
      summary: {
        filesFound: 0,
        propertiesProcessed: [],
        processingTimeMs: 0,
      },
    };
  }
};
