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
} from "@aws-sdk/client-s3";
import { EventBridgeEvent, Context } from "aws-lambda";
import { createCorrelatedLogger } from "../utils/logger";
import { generateCorrelationId } from "../types/errors";
import { ParameterStoreConfig } from "../config/parameter-store";
import { environmentConfig } from "../config/environment";
import { retryS3Operation } from "../utils/retry";
import { ParserFactory } from "../parsers/parser-factory";
import { ExcelMappingParser } from "../parsers/excel-mapping-parser";
import { TransformationEngine } from "../transformation/transformation-engine";
import type { SupportedFileType } from "../parsers/base/parser-types";
import type { ExcelMappingData } from "../parsers/excel-mapping-parser";
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
  private parserFactory: ParserFactory;
  private transformationEngine: TransformationEngine;

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
  }

  /**
   * Process files for the given processing type and time window
   */
  async processFiles(
    processingType: "daily-batch" | "weekly-report",
    correlationId: string,
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

      // Step 3: Process each property's files (Phase 3B)
      const processedFiles = await this.processPropertyFiles(
        organizedFiles,
        correlationId,
      );

      logger.info("Files processed and parsed", {
        totalFilesProcessed: processedFiles.length,
        operation: "files_processed",
      });

      // Step 4: Apply mapping transformations (Phase 3C)
      const transformedData = await this.applyMappingTransformations(
        processedFiles,
        correlationId,
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
   * Step 3: Process each property's files by parsing their content
   */
  private async processPropertyFiles(
    organizedFiles: OrganizedFiles,
    correlationId: string,
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

            // Parse the file content
            console.log(
              `DEBUG: About to parse file ${file.key} as ${supportedType}`,
            );
            const parseResult = await parser.parseFromBuffer(
              fileContent,
              file.filename,
            );
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
              console.log(
                `DEBUG: PDF data keys:`,
                Object.keys(parseResult.data),
              );
              if (
                typeof parseResult.data === "object" &&
                parseResult.data !== null &&
                "propertyName" in parseResult.data
              ) {
                console.log(
                  `DEBUG: Property name found in PDF:`,
                  parseResult.data.propertyName,
                );
              } else {
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
   * Step 4: Apply mapping transformations to processed files
   */
  private async applyMappingTransformations(
    processedFiles: ProcessedFileData[],
    correlationId: string,
  ): Promise<ConsolidatedReport[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "apply_mapping_transformations",
    });

    // Load Excel mapping file
    const mappingData = await this.loadExcelMapping(correlationId);

    const reportsByProperty: { [propertyId: string]: ConsolidatedReport } = {};

    for (const file of processedFiles) {
      if (file.errors.length > 0) {
        continue; // Skip files that had parsing errors
      }

      try {
        // Find property mapping
        const propertyMapping = mappingData?.propertyMappings.find(
          (pm) => pm.propertyId === file.propertyId,
        );

        if (!propertyMapping) {
          logger.warn("No property mapping found", {
            propertyId: file.propertyId,
            fileKey: file.fileKey,
            operation: "mapping_not_found",
          });
          continue;
        }

        // Convert parsed content to structured data for transformation
        const rawFileData = this.createRawFileData(
          file,
          propertyMapping.propertyId,
        );

        // Apply transformations using the full mapping data
        const transformationResult =
          await this.transformationEngine.transformData(
            rawFileData,
            mappingData!,
            correlationId,
          );

        if (transformationResult && transformationResult.records) {
          file.transformedData = transformationResult.records;

          // Initialize or update property report
          if (!reportsByProperty[file.propertyId]) {
            reportsByProperty[file.propertyId] = {
              propertyId: file.propertyId,
              reportDate: new Date().toISOString().split("T")[0],
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

          const report = reportsByProperty[file.propertyId];
          report.totalFiles++;
          report.totalRecords += transformationResult.records.length;
          report.data.push(...transformationResult.records);
          report.summary.successfulFiles++;
          report.summary.processingTime += file.processingTime;

          logger.info("File transformation completed", {
            fileKey: file.fileKey,
            propertyId: file.propertyId,
            recordsTransformed: transformationResult.records.length,
            operation: "transformation_success",
          });
        } else {
          file.errors.push(
            ...(transformationResult?.metadata?.errors?.map(
              (e) => e.message,
            ) || ["Transformation failed"]),
          );

          if (reportsByProperty[file.propertyId]) {
            reportsByProperty[file.propertyId].summary.failedFiles++;
            reportsByProperty[file.propertyId].summary.errors.push(
              ...file.errors,
            );
          }

          logger.warn("File transformation failed", {
            fileKey: file.fileKey,
            propertyId: file.propertyId,
            errors: file.errors,
            operation: "transformation_error",
          });
        }
      } catch (error) {
        const errorMsg = `Transformation error: ${(error as Error).message}`;
        file.errors.push(errorMsg);

        if (reportsByProperty[file.propertyId]) {
          reportsByProperty[file.propertyId].summary.failedFiles++;
          reportsByProperty[file.propertyId].summary.errors.push(errorMsg);
        }

        logger.error("Transformation processing failed", error as Error, {
          fileKey: file.fileKey,
          propertyId: file.propertyId,
          operation: "transformation_process_error",
        });
      }
    }

    return Object.values(reportsByProperty);
  }

  /**
   * Step 5: Generate consolidated reports and store them in S3
   */
  private async generateConsolidatedReports(
    transformedData: ConsolidatedReport[],
    correlationId: string,
  ): Promise<string[]> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "generate_consolidated_reports",
    });

    const reportKeys: string[] = [];

    for (const report of transformedData) {
      try {
        // Generate CSV report
        const csvContent = this.generateCSVReport(report);

        // Store report in S3
        const reportKey = `reports/${report.reportDate}/${report.propertyId}-consolidated-report.csv`;

        await retryS3Operation(
          () =>
            this.s3Client.send(
              new PutObjectCommand({
                Bucket: this.processedBucket,
                Key: reportKey,
                Body: csvContent,
                ContentType: "text/csv",
                Metadata: {
                  propertyId: report.propertyId,
                  reportDate: report.reportDate,
                  totalRecords: report.totalRecords.toString(),
                  generatedAt: new Date().toISOString(),
                },
              }),
            ),
          correlationId,
          "put_consolidated_report",
          {
            maxRetries: 3,
            baseDelay: 1000,
          },
        );

        reportKeys.push(reportKey);

        logger.info("Consolidated report generated", {
          propertyId: report.propertyId,
          reportKey,
          totalRecords: report.totalRecords,
          totalFiles: report.totalFiles,
          operation: "report_generated",
        });
      } catch (error) {
        logger.error("Failed to generate consolidated report", error as Error, {
          propertyId: report.propertyId,
          operation: "report_generation_error",
        });
      }
    }

    return reportKeys;
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
   * Helper method to load Excel mapping configuration
   */
  private async loadExcelMapping(
    correlationId: string,
  ): Promise<ExcelMappingData | null> {
    try {
      // Find the most recent Excel mapping file
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

      const excelFiles = (listResult.Contents || [])
        .filter(
          (obj) =>
            obj.Key?.toLowerCase().endsWith(".xlsx") ||
            obj.Key?.toLowerCase().endsWith(".xls"),
        )
        .sort(
          (a, b) =>
            (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0),
        );

      if (excelFiles.length === 0) {
        return null;
      }

      // Download and parse the most recent Excel mapping file
      const mappingFileBuffer = await this.downloadFileFromS3(
        excelFiles[0].Key!,
        correlationId,
        this.mappingBucket,
      );

      const excelParser = new ExcelMappingParser();
      const parseResult = await excelParser.parseFromBuffer(
        mappingFileBuffer,
        excelFiles[0].Key!,
      );

      if (parseResult.success && parseResult.data) {
        return parseResult.data as unknown as ExcelMappingData;
      }

      return null;
    } catch (error) {
      const logger = createCorrelatedLogger(correlationId, {
        operation: "load_excel_mapping",
      });

      logger.error("Failed to load Excel mapping", error as Error);
      return null;
    }
  }

  /**
   * Helper method to convert parsed content to structured data
   */
  private parseContentToStructuredData(content: string): unknown[] {
    try {
      // Try to parse as JSON first
      return JSON.parse(content);
    } catch {
      // If not JSON, split by lines and create simple records
      const lines = content.split("\n").filter((line) => line.trim());
      return lines.map((line, index) => ({
        lineNumber: index + 1,
        content: line.trim(),
      }));
    }
  }

  /**
   * Helper method to generate CSV report from consolidated data
   */
  private generateCSVReport(report: ConsolidatedReport): string {
    if (report.data.length === 0) {
      return "No data available\n";
    }

    // Get all unique keys from the data
    const allKeys = new Set<string>();
    report.data.forEach((record) => {
      if (typeof record === "object" && record !== null) {
        Object.keys(record).forEach((key) => allKeys.add(key));
      }
    });

    const headers = Array.from(allKeys);
    const csvLines = [headers.join(",")];

    // Add data rows
    report.data.forEach((record) => {
      if (typeof record === "object" && record !== null) {
        const row = headers.map((header) => {
          const value = (record as Record<string, unknown>)[header];
          return value !== undefined ? String(value) : "";
        });
        csvLines.push(row.join(","));
      }
    });

    return csvLines.join("\n");
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
