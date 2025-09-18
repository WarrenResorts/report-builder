/**
 * @fileoverview CSV Parser Implementation
 *
 * This module provides CSV parsing capabilities for the report builder system.
 * It handles various CSV formats, delimiters, and data structures commonly
 * found in property management and financial reporting files.
 */

import { BaseFileParser } from "./base/parser-interface";
import {
  ParseResult,
  ParserConfig,
  SupportedFileType,
  CSVParserOptions,
  ParserErrorCode,
} from "./base/parser-types";

/**
 * CSV-specific parsed data structure
 */
export interface CSVParsedData extends Record<string, unknown> {
  /** Parsed rows as objects (if headers detected) or arrays */
  rows: Array<Record<string, string> | string[]>;

  /** Column headers if detected */
  headers?: string[];

  /** Raw rows as arrays of strings */
  rawRows: string[][];

  /** Number of data rows (excluding header) */
  dataRowCount: number;

  /** Number of columns detected */
  columnCount: number;

  /** Detected delimiter */
  delimiter: string;

  /** Statistics about the data */
  statistics: {
    emptyRows: number;
    inconsistentColumnCounts: number;
    maxColumns: number;
    minColumns: number;
  };

  /** Raw content if requested */
  rawContent?: string;
}

/**
 * CSV Parser implementation
 */
export class CSVParser extends BaseFileParser {
  readonly fileType: SupportedFileType = "csv";
  readonly parserInfo = {
    name: "CSVParser",
    version: "1.0.0",
  };

  /**
   * Parse CSV content from buffer
   */
  async parseFromBuffer(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    const startTime = Date.now();
    const defaultConfig = this.getDefaultConfig();
    const mergedConfig = {
      ...defaultConfig,
      ...config,
      parserOptions: {
        ...defaultConfig.parserOptions,
        ...config?.parserOptions,
      },
    };
    const warnings: string[] = [];

    try {
      // Validate file size
      this.validateFileSize(fileBuffer, mergedConfig);

      // Convert buffer to string with encoding detection
      const content = this.detectEncodingAndConvert(fileBuffer, warnings);

      // Parse CSV with timeout protection
      const parsedData = await this.executeWithTimeout(
        () => this.parseCSVContent(content, mergedConfig, warnings),
        mergedConfig.timeoutMs,
        "CSV parsing",
      );

      // Create successful result
      return {
        success: true,
        data: parsedData,
        metadata: {
          ...this.createBaseMetadata(filename, fileBuffer, startTime, warnings),
          recordCount: parsedData.dataRowCount,
          additionalMetadata: {
            delimiter: parsedData.delimiter,
            hasHeaders: !!parsedData.headers,
            columnCount: parsedData.columnCount,
            statistics: parsedData.statistics,
          },
        },
      };
    } catch (error) {
      const errorCode = this.determineErrorCode(error as Error);
      return this.createErrorResult(
        filename,
        fileBuffer,
        startTime,
        error as Error,
        errorCode,
      );
    }
  }

  /**
   * Parse CSV content from string
   */
  async parseFromString(
    content: string,
    filename: string,
    config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    const buffer = Buffer.from(content, "utf8");
    return this.parseFromBuffer(buffer, filename, config);
  }

  /**
   * Check if file can be parsed as CSV
   */
  canParse(filename: string, fileBuffer?: Buffer): boolean {
    const extension = this.getFileExtension(filename);

    // Check common CSV extensions (excluding txt to avoid conflict with TXT parser)
    if (["csv", "tsv"].includes(extension)) {
      return true;
    }

    // Check content if buffer provided
    if (fileBuffer) {
      return this.looksLikeCSV(fileBuffer);
    }

    return false;
  }

  /**
   * Get CSV parser specific default options
   */
  protected getDefaultParserOptions(): CSVParserOptions {
    return {
      delimiter: "auto",
      quote: '"',
      escape: '"',
      hasHeaders: true,
      skipEmptyLines: true,
      autoDetectDelimiter: true,
    };
  }

  /**
   * Detect encoding and convert buffer to string
   */
  private detectEncodingAndConvert(buffer: Buffer, warnings: string[]): string {
    // Simple encoding detection - in production, use a proper encoding detection library
    // const sample = buffer.subarray(0, Math.min(1024, buffer.length)); // Unused for now

    // Check for BOM
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    ) {
      warnings.push("UTF-8 BOM detected and removed");
      return buffer.subarray(3).toString("utf8");
    }

    // Check for UTF-16 BOM
    if (
      buffer.length >= 2 &&
      ((buffer[0] === 0xff && buffer[1] === 0xfe) ||
        (buffer[0] === 0xfe && buffer[1] === 0xff))
    ) {
      warnings.push("UTF-16 encoding detected, converting to UTF-8");
      return buffer.toString("utf16le");
    }

    // Default to UTF-8
    return buffer.toString("utf8");
  }

  /**
   * Check if buffer content looks like CSV
   */
  private looksLikeCSV(buffer: Buffer): boolean {
    const sample = buffer
      .subarray(0, Math.min(1024, buffer.length))
      .toString("utf8");
    const lines = sample.split("\n").slice(0, 5); // Check first 5 lines

    if (lines.length < 2) return false;

    // Common CSV delimiters
    const delimiters = [",", ";", "\t", "|"];

    for (const delimiter of delimiters) {
      const firstLineCount = (
        lines[0].match(new RegExp(`\\${delimiter}`, "g")) || []
      ).length;
      const secondLineCount = (
        lines[1].match(new RegExp(`\\${delimiter}`, "g")) || []
      ).length;

      // If delimiter appears multiple times and consistently
      if (
        firstLineCount > 0 &&
        Math.abs(firstLineCount - secondLineCount) <= 1
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse CSV content string
   */
  private async parseCSVContent(
    content: string,
    config: ParserConfig,
    warnings: string[],
  ): Promise<CSVParsedData> {
    const options = config.parserOptions as CSVParserOptions;

    // Detect delimiter
    const delimiter = options.autoDetectDelimiter
      ? this.detectDelimiter(content, warnings)
      : options.delimiter === "auto"
        ? ","
        : options.delimiter || ",";

    // Parse the entire content respecting quotes and line breaks
    const rawRows = this.parseCSVRows(
      content,
      delimiter,
      options.quote || '"',
      options.skipEmptyLines || false,
    );

    if (rawRows.length === 0) {
      throw new Error("CSV file contains no data");
    }

    // Calculate statistics
    const columnCounts = rawRows.map((row) => row.length);
    const totalLines = content.split(/\r?\n/).length;
    const statistics = {
      emptyRows: totalLines - rawRows.length,
      inconsistentColumnCounts: this.countInconsistentRows(columnCounts),
      maxColumns: Math.max(...columnCounts),
      minColumns: Math.min(...columnCounts),
    };

    // Detect headers
    let headers: string[] | undefined;
    let dataRows = rawRows;

    if (options.hasHeaders && rawRows.length > 0) {
      headers = rawRows[0];
      dataRows = rawRows.slice(1);

      // Validate headers
      if (this.hasNonStringHeaders(headers)) {
        warnings.push(
          "Some headers appear to be numeric - may not be actual headers",
        );
      }
    }

    // Convert to objects if headers exist
    const rows = headers
      ? dataRows.map((row) =>
          this.rowToObject(row, headers!, statistics.maxColumns, warnings),
        )
      : dataRows;

    // Add warnings for data quality issues
    if (statistics.inconsistentColumnCounts > 0) {
      warnings.push(
        `${statistics.inconsistentColumnCounts} rows have inconsistent column counts`,
      );
    }

    if (dataRows.length > 10000) {
      warnings.push(
        `Large CSV file with ${dataRows.length} rows - consider processing in chunks`,
      );
    }

    return {
      rows,
      headers,
      rawRows,
      dataRowCount: dataRows.length,
      columnCount: statistics.maxColumns,
      delimiter,
      statistics,
      rawContent: config.includeRawContent ? content : undefined,
    };
  }

  /**
   * Detect the most likely delimiter in the CSV content
   */
  private detectDelimiter(content: string, warnings: string[]): string {
    const sample = content.split("\n").slice(0, 10).join("\n"); // First 10 lines
    const delimiters = [",", ";", "\t", "|"];
    const scores: Record<string, number> = {};

    for (const delimiter of delimiters) {
      const lines = sample.split("\n");
      const counts = lines.map(
        (line) => (line.match(new RegExp(`\\${delimiter}`, "g")) || []).length,
      );

      // Score based on consistency and frequency
      const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance =
        counts.reduce((sum, count) => sum + Math.pow(count - avgCount, 2), 0) /
        counts.length;

      scores[delimiter] = avgCount > 0 ? avgCount / (1 + variance) : 0;
    }

    const bestDelimiter = Object.entries(scores).reduce((a, b) =>
      scores[a[0]] > scores[b[0]] ? a : b,
    )[0];

    if (scores[bestDelimiter] === 0) {
      warnings.push("Could not reliably detect delimiter, using comma");
      return ",";
    }

    if (bestDelimiter !== ",") {
      warnings.push(
        `Detected delimiter: '${bestDelimiter === "\t" ? "\\t" : bestDelimiter}'`,
      );
    }

    return bestDelimiter;
  }

  /**
   * Parse entire CSV content respecting quotes and line breaks
   */
  private parseCSVRows(
    content: string,
    delimiter: string,
    quote: string,
    skipEmptyLines: boolean,
  ): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
      const char = content[i];
      const nextChar = i + 1 < content.length ? content[i + 1] : "";

      if (char === quote) {
        if (inQuotes && nextChar === quote) {
          // Escaped quote
          currentField += quote;
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        // End of row (handle both \n and \r\n)
        currentRow.push(currentField);

        if (
          !skipEmptyLines ||
          currentRow.length > 1 ||
          (currentRow.length === 1 && currentRow[0].trim().length > 0)
        ) {
          rows.push(currentRow);
        }

        currentRow = [];
        currentField = "";

        // Skip \r\n combination
        if (char === "\r" && nextChar === "\n") {
          i += 2;
        } else {
          i++;
        }
      } else if (char === delimiter && !inQuotes) {
        // End of field
        currentRow.push(currentField);
        currentField = "";
        i++;
      } else {
        // Regular character (including line breaks within quotes)
        currentField += char;
        i++;
      }
    }

    // Add the last field and row
    currentRow.push(currentField);
    if (
      !skipEmptyLines ||
      currentRow.length > 1 ||
      (currentRow.length === 1 && currentRow[0].trim().length > 0)
    ) {
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * Parse a single CSV line into columns (kept for compatibility)
   */
  private parseCSVLine(
    line: string,
    delimiter: string,
    quote: string,
  ): string[] {
    const columns: string[] = [];
    let currentColumn = "";
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = i + 1 < line.length ? line[i + 1] : "";

      if (char === quote) {
        if (inQuotes && nextChar === quote) {
          // Escaped quote
          currentColumn += quote;
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === delimiter && !inQuotes) {
        // End of column
        columns.push(currentColumn);
        currentColumn = "";
        i++;
      } else {
        // Regular character
        currentColumn += char;
        i++;
      }
    }

    // Add the last column
    columns.push(currentColumn);

    return columns;
  }

  /**
   * Convert array row to object using headers
   */
  private rowToObject(
    row: string[],
    headers: string[],
    maxColumns: number,
    warnings: string[],
  ): Record<string, string> {
    const obj: Record<string, string> = {};

    for (let i = 0; i < Math.max(row.length, headers.length); i++) {
      const header = headers[i] || `column_${i + 1}`;
      const value = row[i] || "";

      if (i >= headers.length && row[i]) {
        warnings.push(
          `Row has more columns than headers, using generated header: ${header}`,
        );
      }

      obj[header] = value;
    }

    return obj;
  }

  /**
   * Count rows with inconsistent column counts
   */
  private countInconsistentRows(columnCounts: number[]): number {
    if (columnCounts.length === 0) return 0;

    const mostCommon = this.findMostCommonValue(columnCounts);
    return columnCounts.filter((count) => count !== mostCommon).length;
  }

  /**
   * Find the most common value in an array
   */
  private findMostCommonValue(arr: number[]): number {
    const counts: Record<number, number> = {};

    for (const value of arr) {
      counts[value] = (counts[value] || 0) + 1;
    }

    return Number(
      Object.entries(counts).reduce((a, b) =>
        counts[Number(a[0])] > counts[Number(b[0])] ? a : b,
      )[0],
    );
  }

  /**
   * Check if headers contain numeric values that might not be actual headers
   */
  private hasNonStringHeaders(headers: string[]): boolean {
    return headers.some(
      (header) => !isNaN(Number(header)) && header.trim() !== "",
    );
  }

  /**
   * Determine appropriate error code based on error type
   */
  private determineErrorCode(error: Error): string {
    if (error.message.includes("timed out")) {
      return ParserErrorCode.TIMEOUT;
    }
    if (error.message.includes("exceeds maximum")) {
      return ParserErrorCode.FILE_TOO_LARGE;
    }
    if (error.message.includes("no data")) {
      return ParserErrorCode.INVALID_FORMAT;
    }

    return ParserErrorCode.PARSING_ERROR;
  }
}
