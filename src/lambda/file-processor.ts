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
 *
 * Enhanced with property name extraction from PDF content for accurate mapping.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { EventBridgeEvent, Context } from "aws-lambda";
import { createCorrelatedLogger } from "../utils/logger";
import { generateCorrelationId } from "../types/errors";
import { ParameterStoreConfig } from "../config/parameter-store";
import { environmentConfig } from "../config/environment";
import { retryS3Operation } from "../utils/retry";
import { ParserFactory } from "../parsers/parser-factory";
import {
  VisualMatrixParser,
  type VisualMatrixData,
  type VisualMatrixMapping,
} from "../parsers/visual-matrix-parser";
import { TransformationEngine } from "../transformation/transformation-engine";
import { JournalEntryGenerator } from "../output/journal-entry-generator";
import { StatisticalEntryGenerator } from "../output/statistical-entry-generator";
import { CreditCardProcessor } from "../processors/credit-card-processor";
import { getPropertyConfigService } from "../config/property-config";
import {
  ReportEmailSender,
  type ReportSummary,
  type PropertyDetail,
} from "../email/report-email-sender";
import type { SupportedFileType } from "../parsers/base/parser-types";
import type {
  RawFileData,
  FieldValue,
} from "../transformation/transformation-engine";

/**
 * Interface for the file processing event
 */
export interface FileProcessingEvent {
  processingType: "daily-batch" | "weekly-report";
  environment: string;
  timestamp: string;
  scheduleExpression: string;
  /**
   * Optional target date for reprocessing a specific day (YYYY-MM-DD format).
   * If provided, processes files from that date's folder instead of last 24 hours.
   * Useful for reprocessing after bug fixes or handling missed days.
   */
  targetDate?: string;
  /**
   * Optional flag to resend email for existing reports without reprocessing files.
   * Requires targetDate to be set. Looks for existing reports in S3 and sends them.
   * Useful when email delivery failed but reports were generated successfully.
   */
  resendEmail?: boolean;
  /**
   * Optional business date for reprocessing a specific day (YYYY-MM-DD format).
   * Unlike targetDate (which queries by folder/received date), this filters by
   * the actual business date inside the PDF files. Queries multiple folder dates
   * and filters to only include files matching the specified business date.
   * Useful for reprocessing after bug fixes.
   */
  businessDate?: string;
}

/**
 * Interface for processed file data
 */
interface ProcessedFileData {
  fileKey: string;
  originalContent: string;
  transformedData: unknown[];
  errors: string[];
  propertyId: string;
  processingTime: number;
}

/**
 * Interface for consolidated report data
 */
interface ConsolidatedReport {
  propertyId: string;
  propertyName?: string; // Extracted from PDF
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
    reportsGenerated: number;
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
 * Interface for duplicate detection results (pre-parse, based on S3 metadata)
 */
interface DuplicateDetectionResult {
  uniqueFiles: S3FileInfo[];
  duplicatesFound: number;
  duplicatesRemoved: S3FileInfo[];
}

/**
 * Interface for parsed file identity (post-parse, based on PDF content)
 * Used for accurate duplicate detection based on actual property name and business date
 */
interface ParsedFileIdentity {
  file: ProcessedFileData;
  propertyName: string;
  businessDate: string;
  /** Key for deduplication: propertyName|businessDate */
  deduplicationKey: string;
}

/**
 * FileProcessor handles batch processing of accumulated files from S3.
 *
 * This class encapsulates the core file processing logic:
 * - Queries S3 for files from the last 24 hours
 * - Organizes files by property and date
 * - Provides foundation for file parsing and transformation
 */
export class FileProcessor {
  private s3Client: S3Client;
  private parameterStore: ParameterStoreConfig;
  private incomingBucket: string;
  private processedBucket: string;
  private mappingBucket: string;
  private parserFactory: ParserFactory;
  private transformationEngine: TransformationEngine;
  private emailSender: ReportEmailSender;

  constructor() {
    this.s3Client = new S3Client({
      region: environmentConfig.awsRegion,
    });
    this.parameterStore = new ParameterStoreConfig();

    // Get bucket names from environment variables (set by CDK)
    this.incomingBucket = process.env.INCOMING_FILES_BUCKET!;
    this.processedBucket = process.env.PROCESSED_FILES_BUCKET!;
    this.mappingBucket = process.env.MAPPING_FILES_BUCKET!;

    // Initialize Phase 3 processing components
    this.parserFactory = new ParserFactory();
    this.transformationEngine = new TransformationEngine();

    // Initialize email sender for Phase 5
    this.emailSender = new ReportEmailSender({
      processedBucket: this.processedBucket,
      region: environmentConfig.awsRegion,
    });
  }

  /**
   * Process files for the given processing type and time window
   * @param processingType - Type of processing (daily-batch or weekly-report)
   * @param correlationId - Correlation ID for logging
   * @param targetDate - Optional specific date to process (YYYY-MM-DD). If not provided, processes last 24 hours.
   */
  async processFiles(
    processingType: "daily-batch" | "weekly-report",
    correlationId: string,
    targetDate?: string,
  ): Promise<FileProcessingResult> {
    const startTime = Date.now();
    const logger = createCorrelatedLogger(correlationId, {
      operation: "file_processor",
    });

    logger.info("Starting file processing", {
      processingType,
      incomingBucket: this.incomingBucket,
      targetDate: targetDate || "last-24-hours",
      operation: "process_files_start",
    });

    try {
      // Step 1: Query S3 for files (either from specific date or last 24 hours)
      const files = targetDate
        ? await this.getFilesFromTargetDate(targetDate, correlationId)
        : await this.getFilesFromLast24Hours(correlationId);

      logger.info("Files retrieved from S3", {
        fileCount: files.length,
        operation: "files_retrieved",
      });

      // Step 1.5: Detect and remove duplicates
      const deduplicationResult = await this.detectAndRemoveDuplicates(
        files,
        correlationId,
      );

      logger.info("Duplicate detection completed", {
        originalFileCount: files.length,
        uniqueFileCount: deduplicationResult.uniqueFiles.length,
        duplicatesRemoved: deduplicationResult.duplicatesFound,
        operation: "deduplication_complete",
      });

      // Step 2: Organize files by property and date (using deduplicated files)
      const organizedFiles = this.organizeFilesByPropertyAndDate(
        deduplicationResult.uniqueFiles,
      );

      const propertiesProcessed = Object.keys(organizedFiles);
      logger.info("Files organized by property", {
        propertiesCount: propertiesProcessed.length,
        properties: propertiesProcessed,
        operation: "files_organized",
      });

      // Step 2.5: Load VisualMatrix mapping early to get valid source codes
      const visualMatrixData =
        await this.loadVisualMatrixMapping(correlationId);
      const validSourceCodes = visualMatrixData
        ? new Set(
            visualMatrixData.mappings.map((m) => m.srcAcctCode.toUpperCase()),
          )
        : undefined;

      // Step 3: Process each property's files (Phase 3B)
      const processedFiles = await this.processPropertyFiles(
        organizedFiles,
        correlationId,
        validSourceCodes,
      );

      logger.info("Files processed and parsed", {
        totalFilesProcessed: processedFiles.length,
        operation: "files_processed",
      });

      // Step 4: Apply VisualMatrix account code mappings (Phase 3C)
      const transformedData = await this.applyAccountCodeMappings(
        processedFiles,
        correlationId,
        visualMatrixData, // Pass the already-loaded mapping data
      );

      logger.info("Data transformations applied", {
        totalRecordsTransformed: transformedData.reduce(
          (sum, p) => sum + p.totalRecords,
          0,
        ),
        operation: "transformations_applied",
      });

      // Step 5: Generate consolidated reports (Phase 3D)
      const reports = await this.generateConsolidatedReports(
        transformedData,
        correlationId,
      );

      logger.info("Consolidated reports generated", {
        reportsGenerated: reports.length,
        operation: "reports_generated",
      });

      const processingTimeMs = Date.now() - startTime;

      // Step 6: Send email with reports (Phase 5)
      if (reports.length >= 2) {
        const jeReportKey = reports.find((r) => r.includes("_JE.csv")) || "";
        const statJEReportKey =
          reports.find((r) => r.includes("_StatJE.csv")) || "";

        if (jeReportKey && statJEReportKey) {
          // Calculate record counts from transformed data
          const totalJERecords = transformedData.reduce((sum, report) => {
            const financialRecords = (report.data || []).filter((record) => {
              const code =
                (record as { targetCode?: string }).targetCode ||
                (record as { sourceCode?: string }).sourceCode ||
                "";
              return !code.startsWith("90"); // Exclude statistical records
            });
            return sum + financialRecords.length;
          }, 0);

          const totalStatJERecords = transformedData.reduce((sum, report) => {
            const statRecords = (report.data || []).filter((record) => {
              const code =
                (record as { targetCode?: string }).targetCode ||
                (record as { sourceCode?: string }).sourceCode ||
                "";
              return code.startsWith("90"); // Only statistical records
            });
            return sum + statRecords.length;
          }, 0);

          // Build property details from transformed data
          const propertyDetails = this.buildPropertyDetails(
            transformedData as Array<{
              propertyId: string;
              propertyName: string;
              reportDate: string;
              data?: Array<{ targetCode?: string; sourceCode?: string }>;
            }>,
          );

          // Get unique dates and calculate date range
          const reportDates = transformedData.map((r) => r.reportDate);
          const uniqueDates = [...new Set(reportDates)].sort();
          const reportDate =
            uniqueDates[uniqueDates.length - 1] ||
            new Date().toISOString().split("T")[0];
          const dateRange = this.calculateDateRange(reportDates);

          // Get unique property names
          const uniquePropertyNames = [
            ...new Set(
              transformedData.map(
                (report) => report.propertyName || report.propertyId,
              ),
            ),
          ].sort();

          // Collect any errors from processing
          const processingErrors = transformedData
            .flatMap((report) => report.summary?.errors || [])
            .filter(Boolean);

          const emailSummary: ReportSummary = {
            reportDate,
            dateRange,
            totalProperties: uniquePropertyNames.length,
            propertyNames: uniquePropertyNames,
            totalFiles: files.length,
            totalJERecords,
            totalStatJERecords,
            processingTimeMs,
            errors: processingErrors,
            propertyDetails,
          };

          const emailResult = await this.emailSender.sendReportEmail(
            jeReportKey,
            statJEReportKey,
            emailSummary,
            correlationId,
          );

          if (emailResult.success) {
            logger.info("Report email sent successfully", {
              messageId: emailResult.messageId,
              recipients: emailResult.recipients,
              operation: "email_sent",
            });
          } else {
            logger.warn("Failed to send report email", {
              error: emailResult.error,
              operation: "email_send_failed",
            });
          }
        }
      }

      return {
        statusCode: 200,
        message: `File processing completed for ${processingType}`,
        processedFiles: files.length,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: files.length,
          propertiesProcessed,
          processingTimeMs,
          reportsGenerated: reports.length,
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
          reportsGenerated: 0,
        },
      };
    }
  }

  /**
   * Query S3 for files from the last 24 hours in the daily-files prefix
   */
  private async getFilesFromLast24Hours(
    correlationId: string,
  ): Promise<S3FileInfo[]> {
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
        "list_daily_files",
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
          const fileInfo = this.parseS3FileKey(
            object.Key,
            object.LastModified,
            object.Size,
          );
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
   * Query S3 for files from a specific target date across all properties.
   * Used for reprocessing a specific day's data.
   * @param targetDate - Date to query in YYYY-MM-DD format
   * @param correlationId - Correlation ID for logging
   */
  private async getFilesFromTargetDate(
    targetDate: string,
    correlationId: string,
  ): Promise<S3FileInfo[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "get_files_target_date",
    });

    const files: S3FileInfo[] = [];

    logger.info("Querying S3 for files from target date", {
      bucket: this.incomingBucket,
      targetDate,
      operation: "s3_query_target_date_start",
    });

    try {
      // List all objects in daily-files prefix to find all properties
      const command = new ListObjectsV2Command({
        Bucket: this.incomingBucket,
        Prefix: "daily-files/",
      });

      const response = await retryS3Operation(
        () => this.s3Client.send(command),
        correlationId,
        "list_daily_files_target_date",
      );

      if (!response.Contents) {
        logger.info("No files found in S3", {
          operation: "s3_query_target_date_empty",
        });
        return files;
      }

      // Filter files by the target date in the S3 path
      // Path format: daily-files/{propertyId}/{YYYY-MM-DD}/{filename}
      for (const object of response.Contents) {
        if (!object.Key || !object.LastModified || !object.Size) continue;

        const parts = object.Key.split("/");
        if (parts.length >= 4 && parts[2] === targetDate) {
          const fileInfo = this.parseS3FileKey(
            object.Key,
            object.LastModified,
            object.Size,
          );
          if (fileInfo) {
            files.push(fileInfo);
          }
        }
      }

      logger.info("S3 target date query completed", {
        targetDate,
        totalObjects: response.Contents.length,
        matchingFiles: files.length,
        operation: "s3_query_target_date_complete",
      });

      return files;
    } catch (error) {
      logger.error("Failed to query S3 for target date files", error as Error, {
        bucket: this.incomingBucket,
        targetDate,
        operation: "s3_query_target_date_error",
      });
      throw error;
    }
  }

  /**
   * Parse S3 file key to extract property ID, date, and filename
   * Expected format: daily-files/{propertyId}/{date}/{filename}
   */
  private parseS3FileKey(
    key: string,
    lastModified: Date,
    size: number,
  ): S3FileInfo | null {
    // Expected format: daily-files/{propertyId}/{date}/{filename}
    const parts = key.split("/");

    if (parts.length < 4 || parts[0] !== "daily-files") {
      return null; // Invalid format
    }

    const propertyId = parts[1];
    const date = parts[2];
    const filename = parts.slice(3).join("/"); // Handle filenames with slashes

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

  /**
   * Pre-parse duplicate detection: Lightweight first-pass filter
   *
   * This is a quick check BEFORE parsing PDFs to catch exact file duplicates.
   * It uses S3 metadata (propertyId from path, filename, size) which is fast
   * but not fully reliable since all files are named "DailyReport.pdf" and
   * different properties could have same-sized files.
   *
   * The authoritative duplicate detection happens AFTER parsing in
   * deduplicateByParsedContent() which uses propertyName|businessDate
   * extracted from the actual PDF content.
   *
   * Identifies duplicates by:
   * 1. Property ID + filename + size (exact match)
   * 2. Keeps the most recently uploaded file
   * 3. Moves duplicates to duplicates/ folder for audit
   */
  private async detectAndRemoveDuplicates(
    files: S3FileInfo[],
    correlationId: string,
  ): Promise<DuplicateDetectionResult> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "duplicate_detection",
    });

    logger.info("Starting duplicate detection", {
      totalFiles: files.length,
    });

    // Group files by property + filename + size
    // Key format: "{propertyId}|{filename}|{size}"
    const fileGroups = new Map<string, S3FileInfo[]>();

    for (const file of files) {
      const key = `${file.propertyId}|${file.filename}|${file.size}`;

      if (!fileGroups.has(key)) {
        fileGroups.set(key, []);
      }

      fileGroups.get(key)!.push(file);
    }

    // Identify duplicates and keep only the most recent
    const uniqueFiles: S3FileInfo[] = [];
    const duplicatesToRemove: S3FileInfo[] = [];

    for (const [groupKey, groupFiles] of fileGroups.entries()) {
      if (groupFiles.length === 1) {
        // No duplicates, keep the file
        uniqueFiles.push(groupFiles[0]);
      } else {
        // Found duplicates - sort by lastModified (most recent first)
        const sorted = groupFiles.sort(
          (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
        );

        // Keep the most recent
        const fileToKeep = sorted[0];
        uniqueFiles.push(fileToKeep);

        // Mark the rest as duplicates
        const duplicates = sorted.slice(1);
        duplicatesToRemove.push(...duplicates);

        logger.info("Duplicate files detected", {
          groupKey,
          totalCount: groupFiles.length,
          keepingFile: fileToKeep.key,
          keepingTimestamp: fileToKeep.lastModified.toISOString(),
          duplicateCount: duplicates.length,
          duplicateKeys: duplicates.map((d) => d.key),
        });
      }
    }

    // Move duplicates to duplicates/ folder (don't delete, keep for audit)
    if (duplicatesToRemove.length > 0) {
      logger.info("Moving duplicate files to archive", {
        duplicateCount: duplicatesToRemove.length,
      });

      for (const duplicate of duplicatesToRemove) {
        try {
          // Copy to duplicates/ folder with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const duplicateKey = `duplicates/${duplicate.propertyId}/${duplicate.date}/${timestamp}_${duplicate.filename}`;

          // Copy the file
          await retryS3Operation(
            async () => {
              const getCommand = new GetObjectCommand({
                Bucket: this.incomingBucket,
                Key: duplicate.key,
              });
              const { Body } = await this.s3Client.send(getCommand);

              if (!Body) {
                throw new Error(`No content retrieved for ${duplicate.key}`);
              }

              const bodyBytes = await Body.transformToByteArray();

              const putCommand = new PutObjectCommand({
                Bucket: this.incomingBucket,
                Key: duplicateKey,
                Body: bodyBytes,
                Metadata: {
                  originalKey: duplicate.key,
                  originalLastModified: duplicate.lastModified.toISOString(),
                  markedAsDuplicate: new Date().toISOString(),
                  reason: "duplicate_file_detected",
                },
              });

              return this.s3Client.send(putCommand);
            },
            correlationId,
            "copy_duplicate",
          );

          // Delete the original (using DeleteObjectCommand imported at the top)
          await retryS3Operation(
            () =>
              this.s3Client.send(
                new PutObjectCommand({
                  Bucket: this.incomingBucket,
                  Key: duplicate.key,
                  Body: Buffer.from(""),
                  Metadata: {
                    deleted: "true",
                    reason: "duplicate",
                  },
                }),
              ),
            correlationId,
            "mark_duplicate",
          );

          logger.info("Duplicate file archived", {
            originalKey: duplicate.key,
            archiveKey: duplicateKey,
          });
        } catch (error) {
          logger.error("Failed to archive duplicate file", error as Error, {
            fileKey: duplicate.key,
          });
          // Continue processing even if archiving fails
        }
      }
    }

    logger.info("Duplicate detection completed", {
      totalFiles: files.length,
      uniqueFiles: uniqueFiles.length,
      duplicatesFound: duplicatesToRemove.length,
    });

    return {
      uniqueFiles,
      duplicatesFound: duplicatesToRemove.length,
      duplicatesRemoved: duplicatesToRemove,
    };
  }

  /**
   * Extract parsed file identities for post-parse duplicate detection
   *
   * This extracts propertyName and businessDate from each parsed file's content.
   * These values come directly from the PDF, making them authoritative for
   * identifying which property and date a report is for.
   */
  private extractParsedFileIdentities(
    processedFiles: ProcessedFileData[],
    correlationId: string,
  ): ParsedFileIdentity[] {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "extract_parsed_file_identities",
    });

    const identities: ParsedFileIdentity[] = [];

    for (const file of processedFiles) {
      // Skip files with parsing errors
      if (file.errors.length > 0) {
        logger.warn(
          "Skipping file with parsing errors for identity extraction",
          {
            fileKey: file.fileKey,
            errors: file.errors,
          },
        );
        continue;
      }

      // Extract propertyName and businessDate from parsed content
      let propertyName = file.propertyId; // Default fallback
      let businessDate: string;

      try {
        const parsedData = JSON.parse(file.originalContent);
        if (parsedData.propertyName) {
          propertyName = parsedData.propertyName;
        }
        if (parsedData.businessDate) {
          businessDate = parsedData.businessDate;
        } else {
          // Fall back to yesterday's date if no business date in PDF
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          businessDate = yesterday.toISOString().split("T")[0];
        }
      } catch {
        // If parsing fails, use fallback values
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        businessDate = yesterday.toISOString().split("T")[0];
      }

      const deduplicationKey = `${propertyName}|${businessDate}`;

      identities.push({
        file,
        propertyName,
        businessDate,
        deduplicationKey,
      });

      logger.debug("Extracted file identity", {
        fileKey: file.fileKey,
        propertyName,
        businessDate,
        deduplicationKey,
      });
    }

    return identities;
  }

  /**
   * Deduplicate parsed files based on propertyName and businessDate from PDF content
   *
   * This is the authoritative duplicate detection since it uses actual data from
   * the PDF rather than file metadata. Two files are considered duplicates if they
   * have the same property name AND business date extracted from the PDF content.
   *
   * When duplicates are found, keeps the first file encountered (could be enhanced
   * to keep the one with more account lines or most recent upload time).
   */
  private deduplicateByParsedContent(
    processedFiles: ProcessedFileData[],
    correlationId: string,
  ): ProcessedFileData[] {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "deduplicate_by_parsed_content",
    });

    // Extract identities for all files
    const identities = this.extractParsedFileIdentities(
      processedFiles,
      correlationId,
    );

    // Group by deduplication key (propertyName|businessDate)
    const fileGroups = new Map<string, ParsedFileIdentity[]>();

    for (const identity of identities) {
      if (!fileGroups.has(identity.deduplicationKey)) {
        fileGroups.set(identity.deduplicationKey, []);
      }
      fileGroups.get(identity.deduplicationKey)!.push(identity);
    }

    // Keep only unique files (first occurrence of each property+date combination)
    const uniqueFiles: ProcessedFileData[] = [];
    let duplicatesSkipped = 0;

    for (const [deduplicationKey, group] of fileGroups.entries()) {
      if (group.length === 1) {
        // No duplicates for this property+date
        uniqueFiles.push(group[0].file);
      } else {
        // Found duplicates - keep the first one, log the rest
        uniqueFiles.push(group[0].file);
        duplicatesSkipped += group.length - 1;

        const keptFile = group[0];
        const skippedFiles = group.slice(1);

        logger.info("Post-parse duplicate detected - keeping first file", {
          deduplicationKey,
          propertyName: keptFile.propertyName,
          businessDate: keptFile.businessDate,
          keptFileKey: keptFile.file.fileKey,
          skippedFileKeys: skippedFiles.map((s) => s.file.fileKey),
          duplicateCount: group.length,
        });
      }
    }

    // Also include files that had parsing errors (they weren't in identities)
    const filesWithErrors = processedFiles.filter((f) => f.errors.length > 0);
    uniqueFiles.push(...filesWithErrors);

    logger.info("Post-parse deduplication completed", {
      totalFilesProcessed: processedFiles.length,
      filesWithIdentities: identities.length,
      uniquePropertyDateCombinations: fileGroups.size,
      uniqueFilesKept: uniqueFiles.length - filesWithErrors.length,
      filesWithErrors: filesWithErrors.length,
      duplicatesSkipped,
    });

    return uniqueFiles;
  }

  /**
   * Step 3: Process each property's files by parsing their content
   */
  private async processPropertyFiles(
    organizedFiles: OrganizedFiles,
    correlationId: string,
    validSourceCodes?: Set<string>,
  ): Promise<ProcessedFileData[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "process_property_files",
    });

    const processedFiles: ProcessedFileData[] = [];

    for (const [propertyId, dateFiles] of Object.entries(organizedFiles)) {
      for (const [date, files] of Object.entries(dateFiles)) {
        logger.info("Processing files for property", {
          propertyId,
          date,
          fileCount: files.length,
          operation: "process_property_start",
        });

        for (const file of files) {
          const startTime = Date.now();

          try {
            // Download file from S3
            const fileContent = await this.downloadFileFromS3(
              file.key,
              correlationId,
            );

            // Determine file type and get appropriate parser
            const fileExtension = this.getFileExtension(file.filename);
            const supportedType =
              this.mapExtensionToSupportedType(fileExtension);
            const parser = ParserFactory.createParser(supportedType);

            // If it's a PDF parser and we have valid source codes, set them
            if (
              supportedType === "pdf" &&
              validSourceCodes &&
              validSourceCodes.size > 0
            ) {
              (parser as any).setValidSourceCodes(validSourceCodes);
            }

            // Parse the file content
            /* c8 ignore next */
            console.log(
              `DEBUG: About to parse file ${file.key} as ${supportedType}`,
            );
            const parseResult = await parser.parseFromBuffer(
              fileContent,
              file.filename,
            );
            /* c8 ignore next 4 */
            console.log(`DEBUG: Parse result for ${file.key}:`, {
              success: parseResult.success,
              hasData: !!parseResult.data,
              dataType: typeof parseResult.data,
            });

            // For PDF files, log more details about the parsed data
            if (
              supportedType === "pdf" &&
              parseResult.success &&
              parseResult.data
            ) {
              /* c8 ignore next 3 */
              console.log(
                `DEBUG: PDF data keys:`,
                Object.keys(parseResult.data),
              );
              if (
                typeof parseResult.data === "object" &&
                parseResult.data !== null &&
                "propertyName" in parseResult.data
              ) {
                /* c8 ignore next 3 */
                console.log(
                  `DEBUG: Property name found in PDF:`,
                  parseResult.data.propertyName,
                );
              } else {
                /* c8 ignore next */
                console.log(`DEBUG: No propertyName field in PDF data`);
              }
            }

            if (parseResult.success && parseResult.data) {
              logger.info(
                "Parse successful, checking for property name extraction",
                {
                  correlationId,
                  operation: "parse_success_check",
                  fileKey: file.key,
                  supportedType,
                  hasPropertyName:
                    typeof parseResult.data === "object" &&
                    parseResult.data !== null &&
                    "propertyName" in parseResult.data,
                },
              );

              // For PDF files, use extracted property name if available
              let finalPropertyId = propertyId;
              if (
                supportedType === "pdf" &&
                typeof parseResult.data === "object" &&
                parseResult.data !== null &&
                "propertyName" in parseResult.data &&
                parseResult.data.propertyName
              ) {
                finalPropertyId = parseResult.data.propertyName as string;

                logger.info("Using extracted property name from PDF", {
                  correlationId,
                  fileKey: file.key,
                  originalPropertyId: propertyId,
                  extractedPropertyName: finalPropertyId,
                  operation: "property_name_extracted",
                });
              } else if (supportedType === "pdf") {
                logger.info("PDF parsed but no property name extracted", {
                  correlationId,
                  operation: "property_name_not_extracted",
                  fileKey: file.key,
                  dataKeys:
                    typeof parseResult.data === "object" &&
                    parseResult.data !== null
                      ? Object.keys(parseResult.data)
                      : [],
                  hasPropertyNameField:
                    typeof parseResult.data === "object" &&
                    parseResult.data !== null &&
                    "propertyName" in parseResult.data,
                  propertyNameValue:
                    typeof parseResult.data === "object" &&
                    parseResult.data !== null &&
                    "propertyName" in parseResult.data
                      ? parseResult.data.propertyName
                      : "N/A",
                });
              }

              processedFiles.push({
                fileKey: file.key,
                originalContent:
                  typeof parseResult.data === "string"
                    ? parseResult.data
                    : JSON.stringify(parseResult.data),
                transformedData: [], // Will be populated in Step 4
                errors: [],
                propertyId: finalPropertyId,
                processingTime: Date.now() - startTime,
              });

              logger.info("File processed successfully", {
                fileKey: file.key,
                propertyId: finalPropertyId,
                fileType: fileExtension,
                processingTime: Date.now() - startTime,
                operation: "file_parse_success",
              });
            } else {
              const errorMsg =
                typeof parseResult.error === "string"
                  ? parseResult.error
                  : parseResult.error?.message || "Unknown parsing error";
              processedFiles.push({
                fileKey: file.key,
                originalContent: "",
                transformedData: [],
                errors: [errorMsg],
                propertyId, // Use original propertyId for failed parses
                processingTime: Date.now() - startTime,
              });

              logger.warn("File parsing failed", {
                fileKey: file.key,
                propertyId,
                error: errorMsg,
                operation: "file_parse_error",
              });
            }
          } catch (error) {
            const errorMsg = `Failed to process file: ${(error as Error).message}`;
            processedFiles.push({
              fileKey: file.key,
              originalContent: "",
              transformedData: [],
              errors: [errorMsg],
              propertyId,
              processingTime: Date.now() - startTime,
            });

            logger.error("File processing failed", error as Error, {
              fileKey: file.key,
              propertyId,
              operation: "file_process_error",
            });
          }
        }
      }
    }

    return processedFiles;
  }

  /**
   * Step 4: Apply VisualMatrix account code mappings to processed files
   */
  private async applyAccountCodeMappings(
    processedFiles: ProcessedFileData[],
    correlationId: string,
    visualMatrixData?: VisualMatrixData | null,
  ): Promise<ConsolidatedReport[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "apply_account_code_mappings",
    });

    // Load VisualMatrix mapping file if not already provided
    if (!visualMatrixData) {
      visualMatrixData = await this.loadVisualMatrixMapping(correlationId);
    }

    if (!visualMatrixData) {
      logger.error(
        "No VisualMatrix mapping data available - cannot process files",
      );
      return [];
    }

    // Step 4.1: Post-parse duplicate detection
    // Deduplicate based on propertyName|businessDate from PDF content
    // This is more accurate than pre-parse detection since all files are named
    // "DailyReport.pdf" and sizes can overlap between different properties
    const deduplicatedFiles = this.deduplicateByParsedContent(
      processedFiles,
      correlationId,
    );

    logger.info("Processing deduplicated files", {
      originalCount: processedFiles.length,
      afterDeduplication: deduplicatedFiles.length,
      duplicatesRemoved: processedFiles.length - deduplicatedFiles.length,
    });

    const reportsByProperty: { [propertyId: string]: ConsolidatedReport } = {};

    for (const file of deduplicatedFiles) {
      if (file.errors.length > 0) {
        logger.warn("Skipping file with parsing errors", {
          fileKey: file.fileKey,
          errors: file.errors,
        });
        continue;
      }

      // Declare businessDate outside try block so it's available in catch for error reporting
      let businessDate: string | undefined;

      try {
        logger.info("Processing file with VisualMatrix mappings", {
          fileKey: file.fileKey,
          propertyId: file.propertyId,
        });

        // Extract property name and business date from the parsed data
        let propertyName = file.propertyId; // Default fallback
        let parsedData;
        try {
          parsedData = JSON.parse(file.originalContent);
          if (parsedData.propertyName) {
            propertyName = parsedData.propertyName;
          }
          if (parsedData.businessDate) {
            businessDate = parsedData.businessDate;
          }
        } catch {
          // Continue with fallback
        }

        // Use business date from PDF, or fall back to yesterday's date
        // (since reports are typically for the previous business day)
        const reportDate =
          businessDate ||
          (() => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return yesterday.toISOString().split("T")[0];
          })();

        logger.info("Extracted report date", {
          fileKey: file.fileKey,
          businessDate,
          reportDate,
          usedFallback: !businessDate,
        });

        // Get property config
        const propertyConfigService = getPropertyConfigService();
        const propertyConfig =
          propertyConfigService.getPropertyConfigOrDefault(propertyName);

        // Apply account code mappings to the file data
        let mappedRecords = await this.applyVisualMatrixMappings(
          file,
          visualMatrixData,
          correlationId,
        );

        // Process credit cards: extract totals, remove duplicates, generate deposits
        const creditCardProcessor = new CreditCardProcessor();
        mappedRecords = creditCardProcessor.processCreditCards(
          mappedRecords,
          propertyConfig,
        );

        // Key by propertyId AND reportDate to handle multiple business dates from same property
        const reportKey = `${file.propertyId}|${reportDate}`;

        if (mappedRecords.length > 0) {
          // Initialize or update property report for this specific date
          if (!reportsByProperty[reportKey]) {
            reportsByProperty[reportKey] = {
              propertyId: file.propertyId,
              propertyName: propertyName, // Store property name
              reportDate: reportDate, // Use extracted business date
              totalFiles: 0,
              totalRecords: 0,
              data: [],
              summary: {
                processingTime: 0,
                errors: [],
                successfulFiles: 0,
                failedFiles: 0,
              },
            };
          }

          const report = reportsByProperty[reportKey];
          report.totalFiles++;
          report.totalRecords += mappedRecords.length;
          report.data.push(...mappedRecords);
          report.summary.successfulFiles++;
          report.summary.processingTime += file.processingTime;

          logger.info("File VisualMatrix mapping completed", {
            fileKey: file.fileKey,
            propertyId: file.propertyId,
            reportDate: reportDate,
            recordsMapped: mappedRecords.length,
            operation: "mapping_success",
          });
        } else {
          file.errors.push("VisualMatrix mapping failed - no records produced");

          if (reportsByProperty[reportKey]) {
            reportsByProperty[reportKey].summary.failedFiles++;
            reportsByProperty[reportKey].summary.errors.push(...file.errors);
          }

          logger.warn("File VisualMatrix mapping failed", {
            fileKey: file.fileKey,
            propertyId: file.propertyId,
            reportDate: reportDate,
            errors: file.errors,
            operation: "mapping_error",
          });
        }
      } catch (error) {
        const errorMsg = `Transformation error: ${(error as Error).message}`;
        file.errors.push(errorMsg);

        // Note: reportKey may not be defined if error occurred before it was set
        // In that case, we can't associate the error with a specific report
        const errorReportKey = `${file.propertyId}|${businessDate || "unknown"}`;
        if (reportsByProperty[errorReportKey]) {
          reportsByProperty[errorReportKey].summary.failedFiles++;
          reportsByProperty[errorReportKey].summary.errors.push(errorMsg);
        }

        logger.error("VisualMatrix mapping processing failed", error as Error, {
          fileKey: file.fileKey,
          propertyId: file.propertyId,
          operation: "mapping_process_error",
        });
      }
    }

    return Object.values(reportsByProperty);
  }

  /**
   * Find mapping for a property, trying property-specific first, then global
   */
  private findMappingForProperty(
    visualMatrixData: VisualMatrixData,
    sourceCode: string,
    propertyName: string,
  ): VisualMatrixMapping | undefined {
    // Normalize source code for case-insensitive comparison
    const normalizedSourceCode = sourceCode.toUpperCase().trim();

    /* c8 ignore next */
    console.log(
      `DEBUG MAPPING LOOKUP: Looking for sourceCode="${normalizedSourceCode}", propertyName="${propertyName}"`,
    );
    /* c8 ignore next */
    console.log(
      `DEBUG MAPPING LOOKUP: Total mappings available: ${visualMatrixData.mappings.length}`,
    );

    // First, try to find property-specific mapping by property name
    const propertySpecificMapping = visualMatrixData.mappings.find(
      (m) =>
        m.srcAcctCode.toUpperCase().trim() === normalizedSourceCode &&
        m.propertyName &&
        m.propertyName.toUpperCase().trim() ===
          propertyName.toUpperCase().trim(),
    );

    if (propertySpecificMapping) {
      /* c8 ignore next */
      console.log(
        `DEBUG MAPPING LOOKUP: Found property-specific mapping for "${normalizedSourceCode}"`,
      );
      return propertySpecificMapping;
    }

    // Fall back to global mapping (propertyId = 0)
    const globalMapping = visualMatrixData.mappings.find(
      (m) =>
        m.srcAcctCode.toUpperCase().trim() === normalizedSourceCode &&
        m.propertyId === 0,
    );

    if (globalMapping) {
      /* c8 ignore next */
      console.log(
        `DEBUG MAPPING LOOKUP: Found global mapping for "${normalizedSourceCode}"`,
      );
    } else {
      /* c8 ignore next */
      console.log(
        `DEBUG MAPPING LOOKUP: NO MAPPING FOUND for "${normalizedSourceCode}". Checking first 10 mappings:`,
      );
      /* c8 ignore next */
      console.log(
        visualMatrixData.mappings
          .slice(0, 10)
          .map(
            (m) =>
              `  - srcAcctCode="${m.srcAcctCode}", propertyId=${m.propertyId}`,
          )
          .join("\n"),
      );
    }

    return globalMapping;
  }

  /**
   * Apply VisualMatrix account code mappings to a processed file.
   * Maps source codes to NetSuite account codes using the mapping file.
   */
  private async applyVisualMatrixMappings(
    file: ProcessedFileData,
    visualMatrixData: VisualMatrixData,
    correlationId: string,
  ): Promise<any[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "apply_visual_matrix_mappings",
      fileKey: file.fileKey,
      propertyId: file.propertyId,
    });

    const mappedRecords: any[] = [];

    try {
      // Check if the file has account line data (from PDF parsing)
      const parsedData = JSON.parse(file.originalContent);

      if (parsedData.accountLines && Array.isArray(parsedData.accountLines)) {
        logger.info("Processing account lines from PDF", {
          accountLineCount: parsedData.accountLines.length,
        });

        // Extract property name for property-specific mapping lookup
        const propertyName = parsedData.propertyName || file.propertyId;

        // Process each account line
        for (const accountLine of parsedData.accountLines) {
          // Try to find mapping using property name first, then fall back to global
          // The VisualMatrix parser will:
          // 1. Look for property-specific mapping by name
          // 2. Fall back to global mapping (propertyId = 0)
          const mapping = this.findMappingForProperty(
            visualMatrixData,
            accountLine.sourceCode,
            propertyName,
          );

          if (mapping) {
            const mappedRecord = {
              sourceCode: accountLine.sourceCode,
              sourceDescription: accountLine.description,
              sourceAmount: accountLine.amount,
              targetCode: mapping.acctCode,
              targetDescription: mapping.acctName,
              mappedAmount: accountLine.amount * mapping.multiplier,
              paymentMethod: accountLine.paymentMethod,
              originalLine: accountLine.originalLine,
              propertyId: file.propertyId,
              processingDate: new Date().toISOString(),
            };

            mappedRecords.push(mappedRecord);

            logger.debug("Account line mapped", {
              sourceCode: accountLine.sourceCode,
              targetCode: mapping.acctCode,
              amount: accountLine.amount,
              mappedAmount: mappedRecord.mappedAmount,
              propertySpecific: mapping.propertyId > 0,
            });
          } else {
            // Per hotel requirements: If no mapping found, skip the record (don't include in report)
            logger.warn(
              `No mapping found for account code "${accountLine.sourceCode}" - skipping record per hotel requirements`,
              {
                sourceCode: accountLine.sourceCode,
                description: accountLine.description,
                amount: accountLine.amount,
                propertyName,
              },
            );
            // Record is NOT added to mappedRecords (skipped as requested)
          }
        }
      } else {
        logger.warn("No account lines found in parsed data", {
          parsedDataKeys: Object.keys(parsedData),
        });
      }

      logger.info("VisualMatrix mapping completed", {
        totalAccountLines: parsedData.accountLines?.length || 0,
        mappedRecords: mappedRecords.length,
        unmappedCount: mappedRecords.filter(
          (r) => r.mappingStatus === "UNMAPPED",
        ).length,
      });

      return mappedRecords;
    } catch (error) {
      logger.error("Failed to apply VisualMatrix mappings", error as Error, {
        fileContent: file.originalContent.substring(0, 200),
      });
      return [];
    }
  }

  /**
   * Step 5: Generate one consolidated report with all properties and store it in S3
   */
  private async generateConsolidatedReports(
    transformedData: ConsolidatedReport[],
    correlationId: string,
  ): Promise<string[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "generate_consolidated_reports",
    });

    // Calculate previous day's date (since we process data from the previous 24 hours)
    const previousDay = new Date();
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDayStr = previousDay.toISOString().split("T")[0];

    // Always generate one consolidated report, even if empty
    // This ensures consistent output format for downstream consumers
    if (transformedData.length === 0) {
      logger.info("No transformed data - generating empty consolidated report");

      try {
        // Create empty report with current date for folder, previous day in filename
        const reportDate = new Date().toISOString().split("T")[0];
        const reportKey = `reports/${reportDate}/daily-consolidated-report-${previousDayStr}.csv`;
        const csvContent = "No data available\n";

        await retryS3Operation(
          () =>
            this.s3Client.send(
              new PutObjectCommand({
                Bucket: this.processedBucket,
                Key: reportKey,
                Body: csvContent,
                ContentType: "text/csv",
                Metadata: {
                  reportDate: reportDate,
                  processingDate: previousDayStr,
                  totalRecords: "0",
                  totalFiles: "0",
                  totalProperties: "0",
                  generatedAt: new Date().toISOString(),
                },
              }),
            ),
          correlationId,
          "put_empty_consolidated_report",
          {
            maxRetries: 3,
            baseDelay: 1000,
          },
        );

        logger.info("Empty consolidated report generated", {
          reportKey,
          reportDate,
          processingDate: previousDayStr,
        });

        return [reportKey];
      } catch (error) {
        logger.error(
          "Failed to upload empty consolidated report",
          error as Error,
          {
            operation: "empty_report_upload_error",
          },
        );

        // Return empty array to indicate no reports were generated
        // but don't throw - this allows the Lambda to continue and return success
        return [];
      }
    }

    try {
      // Generate TWO separate CSV files: JE and StatJE
      const { jeContent, statJEContent } =
        await this.generateSeparateCSVReports(transformedData, correlationId);

      // Use the first report's date (they should all be the same date)
      const reportDate = transformedData[0].reportDate;
      // Folder uses today's date (run date), filename uses previous day
      const todayStr = new Date().toISOString().split("T")[0];
      const jeReportKey = `reports/${todayStr}/${previousDayStr}_JE.csv`;
      const statJEReportKey = `reports/${todayStr}/${previousDayStr}_StatJE.csv`;

      // Calculate totals across all properties
      const totalRecords = transformedData.reduce(
        (sum, report) => sum + report.totalRecords,
        0,
      );
      const totalFiles = transformedData.reduce(
        (sum, report) => sum + report.totalFiles,
        0,
      );
      const totalProperties = transformedData.length;

      const metadata = {
        reportDate: reportDate,
        processingDate: previousDayStr,
        totalRecords: totalRecords.toString(),
        totalFiles: totalFiles.toString(),
        totalProperties: totalProperties.toString(),
        generatedAt: new Date().toISOString(),
      };

      // Upload JE file
      await retryS3Operation(
        () =>
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.processedBucket,
              Key: jeReportKey,
              Body: jeContent,
              ContentType: "text/csv",
              Metadata: metadata,
            }),
          ),
        correlationId,
        "put_je_report",
        {
          maxRetries: 3,
          baseDelay: 1000,
        },
      );

      // Upload StatJE file
      await retryS3Operation(
        () =>
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.processedBucket,
              Key: statJEReportKey,
              Body: statJEContent,
              ContentType: "text/csv",
              Metadata: metadata,
            }),
          ),
        correlationId,
        "put_statje_report",
        {
          maxRetries: 3,
          baseDelay: 1000,
        },
      );

      logger.info("Separate JE and StatJE reports generated", {
        jeReportKey,
        statJEReportKey,
        reportDate,
        processingDate: previousDayStr,
        totalRecords,
        totalFiles,
        totalProperties,
        properties: transformedData.map((r) => r.propertyId),
        operation: "separate_reports_generated",
      });

      return [jeReportKey, statJEReportKey];
    } catch (error) {
      logger.error(
        "Failed to generate separate JE/StatJE reports",
        error as Error,
        {
          operation: "separate_report_generation_error",
        },
      );
      return [];
    }
  }

  /**
   * Helper method to download file content from S3
   */
  private async downloadFileFromS3(
    fileKey: string,
    correlationId: string,
    bucket?: string,
  ): Promise<Buffer> {
    const targetBucket = bucket || this.incomingBucket;
    const response = await retryS3Operation(
      () =>
        this.s3Client.send(
          new GetObjectCommand({
            Bucket: targetBucket,
            Key: fileKey,
          }),
        ),
      correlationId,
      "download_file",
      {
        maxRetries: 3,
        baseDelay: 1000,
      },
    );

    if (!response.Body) {
      return Buffer.alloc(0);
    }

    // Try modern AWS SDK v3 transformToByteArray method
    if ("transformToByteArray" in response.Body) {
      return Buffer.from(await response.Body.transformToByteArray());
    }

    // Try readable stream approach
    if ("getReader" in response.Body) {
      const chunks: Uint8Array[] = [];
      const reader = (response.Body as any).getReader();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          chunks.push(value);
        }
      }

      return Buffer.concat(chunks);
    }

    // Fallback for test environments - check if it's already a Buffer or Uint8Array
    if (Buffer.isBuffer(response.Body)) {
      return response.Body;
    }

    if (
      response.Body &&
      typeof response.Body === "object" &&
      "byteLength" in response.Body
    ) {
      // Likely a Uint8Array or similar
      return Buffer.from(response.Body as Uint8Array);
    }

    // Last resort - convert to string and back to buffer
    return Buffer.from(String(response.Body));
  }

  /**
   * Download and parse a single file from S3.
   * Returns ProcessedFileData with parsed content, or null if parsing fails.
   */
  private async downloadAndParseFile(
    file: S3FileInfo,
    correlationId: string,
  ): Promise<ProcessedFileData | null> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "download_and_parse_file",
    });

    try {
      // Download file from S3
      const fileContent = await this.downloadFileFromS3(
        file.key,
        correlationId,
      );

      // Determine file type and get appropriate parser
      const fileExtension = this.getFileExtension(file.filename);
      const supportedType = this.mapExtensionToSupportedType(fileExtension);
      const parser = ParserFactory.createParser(supportedType);

      // Parse the file content
      const parseResult = await parser.parseFromBuffer(
        fileContent,
        file.filename,
      );

      if (!parseResult.success || !parseResult.data) {
        logger.warn("Failed to parse file", {
          fileKey: file.key,
          error: parseResult.error,
          operation: "parse_failed",
        });
        return null;
      }

      // Extract property ID from the file key (e.g., daily-files/bards-inn/2026-01-13/...)
      const pathParts = file.key.split("/");
      const propertyId = pathParts[1] || "unknown";

      // Use extracted property name if available
      let finalPropertyId = propertyId;
      if (
        typeof parseResult.data === "object" &&
        parseResult.data !== null &&
        "propertyName" in parseResult.data &&
        parseResult.data.propertyName
      ) {
        finalPropertyId = parseResult.data.propertyName as string;
      }

      return {
        fileKey: file.key,
        propertyId: finalPropertyId,
        originalContent: JSON.stringify(parseResult.data),
        transformedData: [],
        processingTime: 0,
        errors: parseResult.error ? [parseResult.error.message] : [],
      };
    } catch (error) {
      logger.error("Error downloading/parsing file", error as Error, {
        fileKey: file.key,
        operation: "download_parse_error",
      });
      return null;
    }
  }

  /**
   * Helper method to get file extension from filename
   */
  private getFileExtension(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop() || "";
    return ext;
  }

  /**
   * Helper method to map file extension to supported parser type
   */
  private mapExtensionToSupportedType(extension: string): SupportedFileType {
    switch (extension.toLowerCase()) {
      case "pdf":
        return "pdf";
      case "csv":
        return "csv";
      case "txt":
        return "txt";
      case "xlsx":
      case "xls":
        return "excel-mapping";
      default:
        return "txt"; // Default fallback
    }
  }

  /**
   * Helper method to create RawFileData from processed file
   */
  private createRawFileData(
    file: ProcessedFileData,
    propertyId: string,
  ): RawFileData {
    return {
      source: {
        filename: file.fileKey.split("/").pop() || "unknown",
        propertyId,
        fileType: this.getFileTypeFromKey(file.fileKey),
        parsedAt: new Date(),
      },
      content: this.parseContentToRecord(file.originalContent),
      metadata: {
        recordCount: 1,
        processingTimeMs: file.processingTime,
        warnings: file.errors,
      },
    };
  }

  /**
   * Helper method to get file type from S3 key
   */
  private getFileTypeFromKey(key: string): "pdf" | "csv" | "txt" {
    const extension = this.getFileExtension(key);
    switch (extension) {
      case "pdf":
        return "pdf";
      case "csv":
        return "csv";
      default:
        return "txt";
    }
  }

  /**
   * Helper method to convert content string to record format
   */
  private parseContentToRecord(content: string): Record<string, FieldValue> {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    } catch {
      // If not JSON, create a simple record structure
    }

    return {
      rawContent: content,
      lineCount: content.split("\n").filter((line) => line.trim()).length,
      firstLine: content.split("\n")[0] || "",
    };
  }

  /**
   * Helper method to load VisualMatrix mapping configuration
   */
  private async loadVisualMatrixMapping(
    correlationId: string,
  ): Promise<VisualMatrixData | null> {
    try {
      // Find the most recent VisualMatrix mapping file
      const listResult = await retryS3Operation(
        () =>
          this.s3Client.send(
            new ListObjectsV2Command({
              Bucket: this.mappingBucket,
              Prefix: "",
            }),
          ),
        correlationId,
        "list_mapping_files",
        {
          maxRetries: 3,
          baseDelay: 1000,
        },
      );

      const mappingFiles = (listResult.Contents || [])
        .filter(
          (obj) =>
            obj.Key?.toLowerCase().endsWith(".xlsx") ||
            obj.Key?.toLowerCase().endsWith(".xls") ||
            obj.Key?.toLowerCase().endsWith(".csv"), // Also support CSV files that are actually Excel
        )
        .sort(
          (a, b) =>
            (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0),
        );

      if (mappingFiles.length === 0) {
        const logger = createCorrelatedLogger(correlationId, {
          operation: "load_visual_matrix_mapping",
        });
        logger.warn("No mapping files found in S3 bucket", {
          bucket: this.mappingBucket,
        });
        return null;
      }

      // Download and parse the most recent VisualMatrix mapping file
      const mappingFileBuffer = await this.downloadFileFromS3(
        mappingFiles[0].Key!,
        correlationId,
        this.mappingBucket,
      );

      const logger = createCorrelatedLogger(correlationId, {
        operation: "load_visual_matrix_mapping",
      });

      logger.info("Loading VisualMatrix mapping file", {
        fileName: mappingFiles[0].Key,
        fileSize: mappingFileBuffer.length,
      });

      const visualMatrixParser = new VisualMatrixParser();
      const parseResult = await visualMatrixParser.parseFromBuffer(
        mappingFileBuffer,
        mappingFiles[0].Key!,
      );

      if (parseResult.success && parseResult.data) {
        const data = parseResult.data as unknown as VisualMatrixData;
        logger.info("Successfully loaded VisualMatrix mapping", {
          totalMappings: data.metadata.totalMappings,
          uniqueSourceCodes: data.metadata.uniqueSourceCodes,
          uniqueTargetCodes: data.metadata.uniqueTargetCodes,
          hasPropertySpecificMappings:
            data.metadata.hasPropertySpecificMappings,
        });
        return data;
      }

      const errorMessage =
        parseResult.error?.message || "Unknown parsing error";
      logger.error(
        "Failed to parse VisualMatrix mapping file",
        new Error(errorMessage),
        {
          fileName: mappingFiles[0].Key,
          parseSuccess: parseResult.success,
        },
      );

      return null;
    } catch (error) {
      const logger = createCorrelatedLogger(correlationId, {
        operation: "load_visual_matrix_mapping",
      });

      logger.error("Failed to load VisualMatrix mapping", error as Error);
      return null;
    }
  }

  /**
   * Helper method to generate separate JE and StatJE CSV reports from all property data
   */
  private async generateSeparateCSVReports(
    reports: ConsolidatedReport[],
    correlationId: string,
  ): Promise<{ jeContent: string; statJEContent: string }> {
    if (reports.length === 0) {
      return {
        jeContent: "No data available\n",
        statJEContent: "No data available\n",
      };
    }

    // Convert ConsolidatedReport[] to TransformedData[] format expected by generators
    const transformedDataArray: any[] = [];

    for (const report of reports) {
      if (report.data && report.data.length > 0) {
        const transformedData = {
          propertyId: report.propertyId,
          propertyName: report.propertyName || report.propertyId, // Use extracted property name
          reportDate: report.reportDate,
          records: report.data.map((record: any) => ({
            sourceCode: record.sourceCode || "",
            sourceDescription: record.sourceDescription || "",
            sourceAmount: record.sourceAmount || 0,
            targetCode: record.targetCode || "",
            targetDescription: record.targetDescription || "",
            mappedAmount: record.mappedAmount || record.sourceAmount || 0,
            paymentMethod: record.paymentMethod || "",
            originalLine: record.originalLine || "",
          })),
        };
        transformedDataArray.push(transformedData);
      }
    }

    if (transformedDataArray.length === 0) {
      return {
        jeContent: "No data available\n",
        statJEContent: "No data available\n",
      };
    }

    // Use the new separate generators
    const jeGenerator = new JournalEntryGenerator();
    const statJEGenerator = new StatisticalEntryGenerator();

    try {
      const jeContent = await jeGenerator.generateJournalEntryCSV(
        transformedDataArray,
        correlationId,
      );
      const statJEContent = await statJEGenerator.generateStatisticalEntryCSV(
        transformedDataArray,
        correlationId,
      );

      return { jeContent, statJEContent };
    } catch (error) {
      const logger = createCorrelatedLogger(correlationId);
      logger.error(
        "Failed to generate separate JE/StatJE CSV",
        error as Error,
        {
          correlationId,
          reportCount: reports.length,
        },
      );
      return {
        jeContent: "Error generating JE CSV report\n",
        statJEContent: "Error generating StatJE CSV report\n",
      };
    }
  }

  /**
   * Build property details array from transformed data
   * Used for email summary with per-property breakdown
   */
  buildPropertyDetails(
    transformedData: Array<{
      propertyId: string;
      propertyName: string;
      reportDate: string;
      data?: Array<{ targetCode?: string; sourceCode?: string }>;
    }>,
  ): PropertyDetail[] {
    return transformedData.map((report) => {
      const jeCount = (report.data || []).filter((record) => {
        const code = record.targetCode || record.sourceCode || "";
        return !code.startsWith("90");
      }).length;

      const statJECount = (report.data || []).filter((record) => {
        const code = record.targetCode || record.sourceCode || "";
        return code.startsWith("90");
      }).length;

      return {
        propertyName: report.propertyName || report.propertyId,
        businessDate: report.reportDate,
        jeRecordCount: jeCount,
        statJERecordCount: statJECount,
      };
    });
  }

  /**
   * Calculate date range string from array of dates
   * Returns undefined if only one unique date
   */
  calculateDateRange(dates: string[]): string | undefined {
    const uniqueDates = [...new Set(dates)].sort();
    if (uniqueDates.length <= 1) {
      return undefined;
    }
    const formatDate = (d: string) => {
      const [year, month, day] = d.split("-");
      return `${month}/${day}/${year}`;
    };
    return `${formatDate(uniqueDates[0])} - ${formatDate(uniqueDates[uniqueDates.length - 1])}`;
  }

  /**
   * Resend email for existing reports without reprocessing files.
   * Looks for existing JE and StatJE reports in S3 for the given date and sends them.
   *
   * @param targetDate - Date to resend reports for (YYYY-MM-DD format)
   * @param correlationId - Correlation ID for logging
   * @returns Processing result
   */
  async resendEmailForDate(
    targetDate: string,
    correlationId: string,
  ): Promise<FileProcessingResult> {
    const startTime = Date.now();
    const logger = createCorrelatedLogger(correlationId, {
      operation: "resend_email",
    });

    logger.info("Starting email resend for existing reports", {
      targetDate,
      operation: "resend_email_start",
    });

    try {
      // Calculate the report folder date (reports are stored in folder for the day AFTER the business date)
      // e.g., reports for 2026-01-13 are in folder 2026-01-14
      const businessDate = new Date(targetDate);
      const reportFolderDate = new Date(businessDate);
      reportFolderDate.setDate(reportFolderDate.getDate() + 1);
      const reportFolderDateStr = reportFolderDate.toISOString().split("T")[0];

      // Construct expected report keys
      const jeReportKey = `reports/${reportFolderDateStr}/${targetDate}_JE.csv`;
      const statJEReportKey = `reports/${reportFolderDateStr}/${targetDate}_StatJE.csv`;

      logger.info("Looking for existing reports", {
        jeReportKey,
        statJEReportKey,
        operation: "check_existing_reports",
      });

      // Verify reports exist in S3
      const headCommand = new HeadObjectCommand({
        Bucket: this.processedBucket,
        Key: jeReportKey,
      });

      try {
        await this.s3Client.send(headCommand);
      } catch {
        logger.error(
          "JE report not found in S3",
          new Error("Report not found"),
          {
            jeReportKey,
            operation: "report_not_found",
          },
        );
        return {
          statusCode: 404,
          message: `Reports not found for date ${targetDate}. Expected: ${jeReportKey}`,
          processedFiles: 0,
          timestamp: new Date().toISOString(),
          summary: {
            filesFound: 0,
            propertiesProcessed: [],
            processingTimeMs: Date.now() - startTime,
            reportsGenerated: 0,
          },
        };
      }

      // Build a simple summary for the email
      const summary = {
        reportDate: targetDate,
        totalProperties: 0,
        propertyNames: [] as string[],
        totalFiles: 0,
        totalJERecords: 0,
        totalStatJERecords: 0,
        processingTimeMs: Date.now() - startTime,
        errors: [] as string[],
      };

      // Send the email
      await this.emailSender.sendReportEmail(
        jeReportKey,
        statJEReportKey,
        summary,
        correlationId,
      );

      logger.info("Email resent successfully", {
        targetDate,
        jeReportKey,
        statJEReportKey,
        processingTimeMs: Date.now() - startTime,
        operation: "resend_email_success",
      });

      return {
        statusCode: 200,
        message: `Email resent successfully for reports from ${targetDate}`,
        processedFiles: 0,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: 0,
          propertiesProcessed: [],
          processingTimeMs: Date.now() - startTime,
          reportsGenerated: 2,
        },
      };
    } catch (error) {
      logger.error("Failed to resend email", error as Error, {
        targetDate,
        operation: "resend_email_error",
      });

      return {
        statusCode: 500,
        message: `Failed to resend email: ${(error as Error).message}`,
        processedFiles: 0,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: 0,
          propertiesProcessed: [],
          processingTimeMs: Date.now() - startTime,
          reportsGenerated: 0,
        },
      };
    }
  }

  /**
   * Reprocess files for a specific business date.
   * Queries multiple folder dates, parses each file to extract the business date,
   * and filters to only process files matching the specified business date.
   *
   * @param businessDate - Business date to reprocess (YYYY-MM-DD format)
   * @param correlationId - Correlation ID for logging
   * @returns Processing result
   */
  async reprocessBusinessDate(
    businessDate: string,
    correlationId: string,
  ): Promise<FileProcessingResult> {
    const startTime = Date.now();
    const logger = createCorrelatedLogger(correlationId, {
      operation: "reprocess_business_date",
    });

    logger.info("Starting business date reprocessing", {
      businessDate,
      operation: "reprocess_business_date_start",
    });

    try {
      // Query files from multiple folder dates to catch all files for this business date
      // Files for business date X could be received on X (same-day senders) or X+1 (next-day senders)
      const folderDates = this.getFolderDatesToQuery(businessDate);
      logger.info("Querying folder dates", {
        businessDate,
        folderDates,
        operation: "query_folder_dates",
      });

      // Collect all files from the folder dates
      const allFiles: S3FileInfo[] = [];
      for (const folderDate of folderDates) {
        const files = await this.getFilesFromTargetDate(
          folderDate,
          correlationId,
        );
        allFiles.push(...files);
      }

      logger.info("Found files across folder dates", {
        businessDate,
        totalFiles: allFiles.length,
        operation: "files_found",
      });

      if (allFiles.length === 0) {
        return {
          statusCode: 200,
          message: `No files found for business date ${businessDate}`,
          processedFiles: 0,
          timestamp: new Date().toISOString(),
          summary: {
            filesFound: 0,
            propertiesProcessed: [],
            processingTimeMs: Date.now() - startTime,
            reportsGenerated: 0,
          },
        };
      }

      // Download and parse each file to extract business date, filter to matching files
      const matchingFiles: ProcessedFileData[] = [];
      for (const file of allFiles) {
        const processedFile = await this.downloadAndParseFile(
          file,
          correlationId,
        );
        if (processedFile) {
          // Extract business date from parsed content
          try {
            const parsedData = JSON.parse(processedFile.originalContent);
            const fileBusinessDate = parsedData.businessDate;
            if (fileBusinessDate === businessDate) {
              matchingFiles.push(processedFile);
              logger.info("File matches business date", {
                fileKey: file.key,
                fileBusinessDate,
                businessDate,
                operation: "file_matched",
              });
            } else {
              logger.info("File does not match business date, skipping", {
                fileKey: file.key,
                fileBusinessDate,
                businessDate,
                operation: "file_skipped",
              });
            }
          } catch {
            logger.warn("Could not extract business date from file", {
              fileKey: file.key,
              operation: "business_date_extraction_failed",
            });
          }
        }
      }

      logger.info("Filtered files by business date", {
        businessDate,
        totalFiles: allFiles.length,
        matchingFiles: matchingFiles.length,
        operation: "files_filtered",
      });

      if (matchingFiles.length === 0) {
        return {
          statusCode: 200,
          message: `No files found matching business date ${businessDate}`,
          processedFiles: 0,
          timestamp: new Date().toISOString(),
          summary: {
            filesFound: allFiles.length,
            propertiesProcessed: [],
            processingTimeMs: Date.now() - startTime,
            reportsGenerated: 0,
          },
        };
      }

      /* c8 ignore start - success path reuses already-tested components */
      // Load VisualMatrix mapping data
      const visualMatrixData =
        await this.loadVisualMatrixMapping(correlationId);

      // Apply account code mappings and transformations
      const consolidatedReports = await this.applyAccountCodeMappings(
        matchingFiles,
        correlationId,
        visualMatrixData,
      );

      // Generate CSV reports
      const { jeContent, statJEContent } =
        await this.generateSeparateCSVReports(
          consolidatedReports,
          correlationId,
        );

      // Save reports to S3
      const today = new Date().toISOString().split("T")[0];
      const jeKey = `reports/${today}/${businessDate}_JE.csv`;
      const statJEKey = `reports/${today}/${businessDate}_StatJE.csv`;

      await retryS3Operation(
        () =>
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.processedBucket,
              Key: jeKey,
              Body: jeContent,
              ContentType: "text/csv",
            }),
          ),
        correlationId,
        "save_je_report",
      );
      await retryS3Operation(
        () =>
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.processedBucket,
              Key: statJEKey,
              Body: statJEContent,
              ContentType: "text/csv",
            }),
          ),
        correlationId,
        "save_statje_report",
      );

      // Build property details for email
      const propertyDetails = this.buildPropertyDetails(
        consolidatedReports as Array<{
          propertyId: string;
          propertyName: string;
          reportDate: string;
          data?: Array<{ targetCode?: string; sourceCode?: string }>;
        }>,
      );
      const reportDates = consolidatedReports.map((r) => r.reportDate);
      const dateRange = this.calculateDateRange(reportDates);

      // Count records
      let totalJERecords = 0;
      let totalStatJERecords = 0;
      for (const report of consolidatedReports) {
        if (report.data) {
          for (const record of report.data as Array<{ targetCode?: string }>) {
            if (
              record.targetCode &&
              !record.targetCode.startsWith("STAT-") &&
              record.targetCode !== "EXCLUDE"
            ) {
              totalJERecords++;
            }
            if (record.targetCode && record.targetCode.startsWith("STAT-")) {
              totalStatJERecords++;
            }
          }
        }
      }

      // Build summary and send email
      const propertiesProcessed = [
        ...new Set(matchingFiles.map((f) => f.propertyId)),
      ];
      const summary = {
        reportDate: businessDate,
        dateRange,
        totalProperties: propertiesProcessed.length,
        propertyNames: propertiesProcessed,
        totalFiles: matchingFiles.length,
        totalJERecords,
        totalStatJERecords,
        processingTimeMs: Date.now() - startTime,
        errors: [] as string[],
        propertyDetails,
      };

      await this.emailSender.sendReportEmail(
        jeKey,
        statJEKey,
        summary,
        correlationId,
      );

      logger.info("Business date reprocessing completed", {
        businessDate,
        filesProcessed: matchingFiles.length,
        propertiesProcessed,
        jeKey,
        statJEKey,
        processingTimeMs: Date.now() - startTime,
        operation: "reprocess_business_date_complete",
      });

      return {
        statusCode: 200,
        message: `Reprocessed ${matchingFiles.length} files for business date ${businessDate}`,
        processedFiles: matchingFiles.length,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: allFiles.length,
          propertiesProcessed,
          processingTimeMs: Date.now() - startTime,
          reportsGenerated: 2,
        },
      };
      /* c8 ignore stop */
    } catch (error) {
      logger.error("Failed to reprocess business date", error as Error, {
        businessDate,
        operation: "reprocess_business_date_error",
      });

      return {
        statusCode: 500,
        message: `Failed to reprocess business date: ${(error as Error).message}`,
        processedFiles: 0,
        timestamp: new Date().toISOString(),
        summary: {
          filesFound: 0,
          propertiesProcessed: [],
          processingTimeMs: Date.now() - startTime,
          reportsGenerated: 0,
        },
      };
    }
  }

  /**
   * Get the folder dates to query for a given business date.
   * Returns the business date itself and the next day (to catch both same-day and next-day senders).
   */
  private getFolderDatesToQuery(businessDate: string): string[] {
    const date = new Date(businessDate);
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    return [businessDate, nextDay.toISOString().split("T")[0]];
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
  const {
    processingType,
    environment,
    timestamp,
    targetDate,
    resendEmail,
    businessDate,
  } = detail;

  logger.info("Starting file processing handler", {
    processingType,
    environment,
    scheduledTimestamp: timestamp,
    targetDate: targetDate || "last-24-hours",
    resendEmail: resendEmail || false,
    businessDate: businessDate || "none",
    operation: "handler_start",
  });

  try {
    // Create file processor instance
    const processor = new FileProcessor();

    // If resendEmail is true, skip processing and just send email for existing reports
    if (resendEmail && targetDate) {
      logger.info("Resend email mode - skipping file processing", {
        targetDate,
        operation: "resend_email_mode",
      });
      const result = await processor.resendEmailForDate(
        targetDate,
        correlationId,
      );
      return result;
    }

    // If businessDate is set, reprocess files for that specific business date
    if (businessDate) {
      logger.info("Business date reprocess mode", {
        businessDate,
        operation: "business_date_reprocess_mode",
      });
      const result = await processor.reprocessBusinessDate(
        businessDate,
        correlationId,
      );
      return result;
    }

    // Normal processing
    const result = await processor.processFiles(
      processingType,
      correlationId,
      targetDate,
    );

    logger.info("File processing handler completed successfully", {
      statusCode: result.statusCode,
      processedFiles: result.processedFiles,
      processingTimeMs: result.summary.processingTimeMs,
      operation: "handler_success",
    });

    return result;
    /* c8 ignore start - handler-level error catch only triggers if FileProcessor constructor fails */
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
        reportsGenerated: 0,
      },
    };
  }
  /* c8 ignore stop */
};
