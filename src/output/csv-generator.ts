/**
 * @fileoverview CSV Output Generator
 *
 * Generates standardized CSV files from transformed data with proper formatting,
 * validation, and error handling. Supports custom field ordering, data sanitization,
 * and multiple output formats.
 */

import { Logger } from "../utils/logger";
import type {
  TransformedData,
  TransformedRecord,
} from "../transformation/transformation-engine";

/**
 * Configuration options for CSV generation
 */
export interface CSVGeneratorConfig {
  /** Field delimiter (default: ',') */
  delimiter?: string;
  /** Quote character for fields containing special characters (default: '"') */
  quote?: string;
  /** Line ending style (default: '\n') */
  lineEnding?: "\n" | "\r\n" | "\r";
  /** Whether to include headers in output (default: true) */
  includeHeaders?: boolean;
  /** Custom field order - if not provided, uses alphabetical order */
  fieldOrder?: string[];
  /** Whether to sanitize field values (default: true) */
  sanitizeValues?: boolean;
  /** Maximum field length before truncation (default: 32767 - Excel limit) */
  maxFieldLength?: number;
  /** Whether to include metadata fields (default: false) */
  includeMetadata?: boolean;
  /** Custom date format for date fields (default: 'YYYY-MM-DD') */
  dateFormat?: string;
  /** Whether to quote all fields (default: false - only quote when necessary) */
  quoteAll?: boolean;
}

/**
 * Statistics about the CSV generation process
 */
export interface CSVGenerationStats {
  /** Total number of records processed */
  totalRecords: number;
  /** Number of fields in each record */
  fieldCount: number;
  /** Fields that were included in the output */
  includedFields: string[];
  /** Number of values that were sanitized */
  sanitizedValues: number;
  /** Number of values that were truncated */
  truncatedValues: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Size of generated CSV in bytes */
  outputSizeBytes: number;
}

/**
 * Result of CSV generation
 */
export interface CSVGenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Generated CSV content */
  csvContent?: string;
  /** Generation statistics */
  stats?: CSVGenerationStats;
  /** Error information if generation failed */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * CSV Generator class for creating standardized CSV output from transformed data
 */
export class CSVGenerator {
  private logger: Logger;
  private config: Required<CSVGeneratorConfig>;

  constructor(config: CSVGeneratorConfig = {}, logger?: Logger) {
    this.logger = logger || new Logger("CSVGenerator");
    this.config = {
      delimiter: ",",
      quote: '"',
      lineEnding: "\n",
      includeHeaders: true,
      fieldOrder: [],
      sanitizeValues: true,
      maxFieldLength: 32767, // Excel cell limit
      includeMetadata: false,
      dateFormat: "YYYY-MM-DD",
      quoteAll: false,
      ...config,
    };
  }

  /**
   * Generate CSV content from transformed data
   */
  async generateCSV(
    transformedData: TransformedData,
    correlationId: string,
  ): Promise<CSVGenerationResult> {
    const startTime = Date.now();

    try {
      this.logger.info("Starting CSV generation", {
        correlationId,
        propertyId: transformedData.propertyId,
        recordCount: transformedData.records.length,
      });

      if (!transformedData.records || transformedData.records.length === 0) {
        return {
          success: true,
          csvContent: this.config.includeHeaders
            ? this.generateHeaders([])
            : "",
          stats: {
            totalRecords: 0,
            fieldCount: 0,
            includedFields: [],
            sanitizedValues: 0,
            truncatedValues: 0,
            processingTimeMs: Date.now() - startTime,
            outputSizeBytes: 0,
          },
        };
      }

      // Extract and order fields
      const allFields = this.extractFields(transformedData.records);
      const orderedFields = this.orderFields(allFields);

      // Generate CSV content
      const csvLines: string[] = [];
      let sanitizedCount = 0;
      let truncatedCount = 0;

      // Add headers if requested
      if (this.config.includeHeaders) {
        csvLines.push(this.generateHeaders(orderedFields));
      }

      // Process each record
      for (const record of transformedData.records) {
        const { csvLine, sanitized, truncated } = this.generateRecordLine(
          record,
          orderedFields,
          correlationId,
        );
        csvLines.push(csvLine);
        sanitizedCount += sanitized;
        truncatedCount += truncated;
      }

      const csvContent = csvLines.join(this.config.lineEnding);
      const processingTime = Math.max(1, Date.now() - startTime); // Ensure at least 1ms

      this.logger.info("CSV generation completed", {
        correlationId,
        propertyId: transformedData.propertyId,
        recordCount: transformedData.records.length,
        fieldCount: orderedFields.length,
        outputSize: csvContent.length,
        processingTimeMs: processingTime,
      });

      return {
        success: true,
        csvContent,
        stats: {
          totalRecords: transformedData.records.length,
          fieldCount: orderedFields.length,
          includedFields: orderedFields,
          sanitizedValues: sanitizedCount,
          truncatedValues: truncatedCount,
          processingTimeMs: processingTime,
          outputSizeBytes: Buffer.byteLength(csvContent, "utf8"),
        },
      };
    } catch (error) {
      this.logger.error("CSV generation failed", error as Error, {
        correlationId,
        propertyId: transformedData.propertyId,
      });

      return {
        success: false,
        error: {
          code: "CSV_GENERATION_ERROR",
          message: `CSV generation failed: ${(error as Error).message}`,
          details: {
            propertyId: transformedData.propertyId,
            recordCount: transformedData.records?.length || 0,
          },
        },
      };
    }
  }

  /**
   * Generate CSV from multiple transformed data files
   */
  async generateMultipleCSVs(
    transformedDataFiles: TransformedData[],
    correlationId: string,
  ): Promise<Map<string, CSVGenerationResult>> {
    const results = new Map<string, CSVGenerationResult>();

    for (const transformedData of transformedDataFiles) {
      const key = `${transformedData.propertyId}_${transformedData.processingDate}`;
      const result = await this.generateCSV(transformedData, correlationId);
      results.set(key, result);
    }

    return results;
  }

  /**
   * Extract all unique fields from records
   */
  private extractFields(records: TransformedRecord[]): string[] {
    const fieldSet = new Set<string>();

    for (const record of records) {
      // Add main fields
      Object.keys(record.fields).forEach((field) => fieldSet.add(field));

      // Add metadata fields if requested
      if (this.config.includeMetadata) {
        fieldSet.add("_recordId");
        fieldSet.add("_sourceFile");
        fieldSet.add("_processingDate");
        if (record.metadata.transformationWarnings.length > 0) {
          fieldSet.add("_warnings");
        }
      }
    }

    return Array.from(fieldSet);
  }

  /**
   * Order fields according to configuration
   */
  private orderFields(fields: string[]): string[] {
    if (this.config.fieldOrder.length === 0) {
      // Default alphabetical ordering, but put metadata fields at the end
      const mainFields = fields.filter((f) => !f.startsWith("_")).sort();
      const metadataFields = fields.filter((f) => f.startsWith("_")).sort();
      return [...mainFields, ...metadataFields];
    }

    // Use custom ordering, with unspecified fields at the end
    const orderedFields: string[] = [];
    const remainingFields = new Set(fields);

    // Add fields in specified order
    for (const field of this.config.fieldOrder) {
      if (remainingFields.has(field)) {
        orderedFields.push(field);
        remainingFields.delete(field);
      }
    }

    // Add remaining fields alphabetically
    orderedFields.push(...Array.from(remainingFields).sort());

    return orderedFields;
  }

  /**
   * Generate CSV headers
   */
  private generateHeaders(fields: string[]): string {
    return fields
      .map((field) => this.escapeField(field))
      .join(this.config.delimiter);
  }

  /**
   * Generate a CSV line for a single record
   */
  private generateRecordLine(
    record: TransformedRecord,
    fields: string[],
    correlationId: string,
  ): { csvLine: string; sanitized: number; truncated: number } {
    const values: string[] = [];
    let sanitizedCount = 0;
    let truncatedCount = 0;

    for (const field of fields) {
      let value = "";

      if (field.startsWith("_")) {
        // Handle metadata fields
        switch (field) {
          case "_recordId":
            value = record.recordId;
            break;
          case "_sourceFile":
            value = record.sourceFile;
            break;
          case "_processingDate":
            value = record.processingDate;
            break;
          case "_warnings":
            value = record.metadata.transformationWarnings.join("; ");
            break;
        }
      } else {
        // Handle regular fields
        const rawValue = record.fields[field];
        if (rawValue !== undefined && rawValue !== null) {
          value = this.formatValue(rawValue);
        }
      }

      // Sanitize and truncate if necessary
      if (this.config.sanitizeValues) {
        const originalValue = value;
        value = this.sanitizeValue(value);
        if (value !== originalValue) {
          sanitizedCount++;
        }
      }

      if (value.length > this.config.maxFieldLength) {
        value = value.substring(0, this.config.maxFieldLength - 3) + "...";
        truncatedCount++;
        this.logger.debug("Field value truncated", {
          correlationId,
          field,
          originalLength: value.length + 3,
          truncatedLength: value.length,
        });
      }

      values.push(this.escapeField(value));
    }

    return {
      csvLine: values.join(this.config.delimiter),
      sanitized: sanitizedCount,
      truncated: truncatedCount,
    };
  }

  /**
   * Format a value for CSV output
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (value instanceof Date) {
      return this.formatDate(value);
    }

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (typeof value === "number") {
      return value.toString();
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "[Object]";
      }
    }

    return String(value);
  }

  /**
   * Format a date according to the configured format
   */
  private formatDate(date: Date): string {
    // Use local date components to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return this.config.dateFormat
      .replace("YYYY", String(year))
      .replace("MM", month)
      .replace("DD", day);
  }

  /**
   * Sanitize a field value by removing/replacing problematic characters
   */
  private sanitizeValue(value: string): string {
    return (
      value
        // Remove non-printable characters while preserving tabs, newlines, and carriage returns
        .split("")
        .filter((char) => {
          const code = char.charCodeAt(0);
          // Keep printable ASCII (32-126), tab (9), newline (10), carriage return (13)
          return (
            (code >= 32 && code <= 126) ||
            code === 9 ||
            code === 10 ||
            code === 13 ||
            code > 126 // Keep Unicode characters
          );
        })
        .join("")
        // Replace multiple whitespace with single space
        .replace(/\s+/g, " ")
        // Trim whitespace
        .trim()
    );
  }

  /**
   * Escape a field value for CSV output
   */
  private escapeField(value: string): string {
    const needsQuoting =
      this.config.quoteAll ||
      value.includes(this.config.delimiter) ||
      value.includes(this.config.quote) ||
      value.includes("\n") ||
      value.includes("\r") ||
      value.startsWith(" ") ||
      value.endsWith(" ") ||
      // Also quote fields that contain spaces (like "John Doe")
      value.includes(" ");

    if (!needsQuoting) {
      return value;
    }

    // Escape quotes by doubling them
    const escapedValue = value.replace(
      new RegExp(this.config.quote, "g"),
      this.config.quote + this.config.quote,
    );

    return `${this.config.quote}${escapedValue}${this.config.quote}`;
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): CSVGeneratorConfig {
    return {
      delimiter: ",",
      quote: '"',
      lineEnding: "\n",
      includeHeaders: true,
      fieldOrder: [],
      sanitizeValues: true,
      maxFieldLength: 32767,
      includeMetadata: false,
      dateFormat: "YYYY-MM-DD",
      quoteAll: false,
    };
  }
}

/**
 * Convenience function to generate CSV from transformed data
 */
export async function generateCSV(
  transformedData: TransformedData,
  correlationId: string,
  config?: CSVGeneratorConfig,
): Promise<CSVGenerationResult> {
  const generator = new CSVGenerator(config);
  return generator.generateCSV(transformedData, correlationId);
}

/**
 * Convenience function to generate multiple CSVs
 */
export async function generateMultipleCSVs(
  transformedDataFiles: TransformedData[],
  correlationId: string,
  config?: CSVGeneratorConfig,
): Promise<Map<string, CSVGenerationResult>> {
  const generator = new CSVGenerator(config);
  return generator.generateMultipleCSVs(transformedDataFiles, correlationId);
}
