/**
 * @fileoverview TXT Parser Implementation
 *
 * This module provides plain text parsing capabilities for the report builder system.
 * It handles various text formats and attempts to detect structured data patterns
 * within text files commonly used in property management systems.
 */

import { BaseFileParser } from "./base/parser-interface";
import {
  ParseResult,
  ParserConfig,
  SupportedFileType,
  TXTParserOptions,
  ParserErrorCode,
} from "./base/parser-types";

/**
 * Detected structure types in text files
 */
export type TextStructureType =
  | "unstructured" // Plain text with no detectable structure
  | "key-value" // Key: Value pairs
  | "tabular" // Tab or space-separated columns
  | "delimited" // Pipe or other delimiter-separated
  | "report" // Structured report format
  | "log" // Log file format with timestamps
  | "list" // Bulleted or numbered lists
  | "mixed"; // Multiple structure types detected

/**
 * TXT-specific parsed data structure
 */
export interface TXTParsedData extends Record<string, unknown> {
  /** Raw text content */
  text: string;

  /** Text split into lines */
  lines: string[];

  /** Detected structure type */
  structureType: TextStructureType;

  /** Structured data if detected */
  structuredData?: Array<Record<string, string> | string[]>;

  /** Key-value pairs if detected */
  keyValuePairs?: Record<string, string>;

  /** Text statistics */
  statistics: {
    lineCount: number;
    wordCount: number;
    characterCount: number;
    emptyLines: number;
    longestLine: number;
    averageLineLength: number;
  };

  /** Detected patterns */
  patterns: {
    hasTimestamps: boolean;
    hasEmailAddresses: boolean;
    hasPhoneNumbers: boolean;
    hasAddresses: boolean;
    hasCurrency: boolean;
    hasNumbers: boolean;
  };

  /** Encoding information */
  encoding: {
    detected: string;
    confidence: number;
  };

  /** Raw content if requested */
  rawContent?: string;
}

/**
 * TXT Parser implementation
 */
export class TXTParser extends BaseFileParser {
  readonly fileType: SupportedFileType = "txt";
  readonly parserInfo = {
    name: "TXTParser",
    version: "1.0.0",
  };

  // Regular expressions for pattern detection
  private readonly patterns = {
    timestamp: /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}/,
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    phone: /(\+?1[-.\s]?)?(\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/,
    currency: /\$[\d,]+\.?\d*/,
    keyValue: /^[^:]+:\s*.+$/,
    address:
      /\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl)(?:\s|$)/i,
  };

  /**
   * Parse TXT content from buffer
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

      // Detect encoding and convert to string
      const { text, encoding } = this.detectEncodingAndConvert(
        fileBuffer,
        warnings,
      );

      // Parse text with timeout protection
      const parsedData = await this.executeWithTimeout(
        () => this.parseTextContent(text, encoding, mergedConfig, warnings),
        mergedConfig.timeoutMs,
        "Text parsing",
      );

      // Create successful result
      return {
        success: true,
        data: parsedData,
        metadata: {
          ...this.createBaseMetadata(filename, fileBuffer, startTime, warnings),
          recordCount: parsedData.statistics.lineCount,
          additionalMetadata: {
            structureType: parsedData.structureType,
            encoding: parsedData.encoding,
            patterns: parsedData.patterns,
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
   * Parse TXT content from string
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
   * Check if file can be parsed as TXT
   */
  canParse(filename: string, fileBuffer?: Buffer): boolean {
    const extension = this.getFileExtension(filename);

    // Common text file extensions
    if (["txt", "text", "log", "dat", "asc"].includes(extension)) {
      return true;
    }

    // Check if content appears to be text
    if (fileBuffer) {
      return this.looksLikeText(fileBuffer);
    }

    return false;
  }

  /**
   * Get TXT parser specific default options
   */
  protected getDefaultParserOptions(): TXTParserOptions {
    return {
      encoding: "auto",
      lineEnding: "auto",
      detectStructure: true,
      maxLines: 50000,
    };
  }

  /**
   * Detect encoding and convert buffer to string
   */
  private detectEncodingAndConvert(
    buffer: Buffer,
    warnings: string[],
  ): { text: string; encoding: { detected: string; confidence: number } } {
    // Simple encoding detection - in production, use chardet or similar
    const detected = "utf8";
    let confidence = 0.8;

    // Check for BOM
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    ) {
      warnings.push("UTF-8 BOM detected and removed");
      return {
        text: buffer.subarray(3).toString("utf8"),
        encoding: { detected: "utf8-bom", confidence: 1.0 },
      };
    }

    // Check for UTF-16 BOM
    if (buffer.length >= 2) {
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return {
          text: buffer.toString("utf16le"),
          encoding: { detected: "utf16le", confidence: 1.0 },
        };
      }
      if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        return {
          text: buffer.toString("utf16le"), // Use utf16le as fallback since utf16be isn't a valid BufferEncoding
          encoding: { detected: "utf16be", confidence: 1.0 },
        };
      }
    }

    // Sample first 1KB for encoding detection
    const sample = buffer.subarray(0, Math.min(1024, buffer.length));

    // Check for high-bit characters that might indicate encoding issues
    const highBitCount = sample.filter((byte) => byte > 127).length;
    const ratio = highBitCount / sample.length;

    if (ratio > 0.3) {
      // Might be a different encoding
      confidence = 0.5;
      warnings.push(
        "High ratio of non-ASCII characters detected - encoding may not be UTF-8",
      );
    }

    try {
      const text = buffer.toString("utf8");
      // Check for replacement characters (indication of encoding issues)
      if (text.includes("\uFFFD")) {
        confidence = 0.3;
        warnings.push(
          "Replacement characters found - file may not be UTF-8 encoded",
        );
      }

      return { text, encoding: { detected, confidence } };
    } catch (error) {
      throw new Error(
        `Failed to decode text file: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Check if buffer content looks like text
   */
  private looksLikeText(buffer: Buffer): boolean {
    // Sample first 512 bytes
    const sample = buffer.subarray(0, Math.min(512, buffer.length));

    // Count printable characters
    let printableCount = 0;
    let controlCount = 0;

    for (const byte of sample) {
      if (
        (byte >= 32 && byte <= 126) ||
        byte === 9 ||
        byte === 10 ||
        byte === 13
      ) {
        printableCount++;
      } else if (byte < 32) {
        controlCount++;
      }
    }

    const printableRatio = printableCount / sample.length;
    const controlRatio = controlCount / sample.length;

    // Consider it text if mostly printable characters
    return printableRatio > 0.7 && controlRatio < 0.3;
  }

  /**
   * Parse text content and detect structure
   */
  private async parseTextContent(
    text: string,
    encoding: { detected: string; confidence: number },
    config: ParserConfig,
    warnings: string[],
  ): Promise<TXTParsedData> {
    const options = config.parserOptions as TXTParserOptions;

    // Split into lines
    const lines = text.split(/\r?\n/);

    // Limit lines if specified
    const processedLines = options.maxLines
      ? lines.slice(0, options.maxLines)
      : lines;

    if (lines.length > processedLines.length) {
      warnings.push(
        `File has ${lines.length} lines, only processing first ${options.maxLines}`,
      );
    }

    // Calculate statistics
    const statistics = this.calculateStatistics(processedLines);

    // Detect patterns
    const patterns = this.detectPatterns(text);

    // Detect structure if enabled
    let structureType: TextStructureType = "unstructured";
    let structuredData: Array<Record<string, string> | string[]> | undefined;
    let keyValuePairs: Record<string, string> | undefined;

    if (options.detectStructure) {
      const structureAnalysis = this.analyzeStructure(processedLines, warnings);
      structureType = structureAnalysis.type;
      structuredData = structureAnalysis.data;
      keyValuePairs = structureAnalysis.keyValuePairs;
    }

    return {
      text,
      lines: processedLines,
      structureType,
      structuredData,
      keyValuePairs,
      statistics,
      patterns,
      encoding,
      rawContent: config.includeRawContent ? text : undefined,
    };
  }

  /**
   * Calculate text statistics
   */
  private calculateStatistics(lines: string[]) {
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    const allText = lines.join(" ");
    const words = allText.split(/\s+/).filter((word) => word.length > 0);
    const lineLengths = lines.map((line) => line.length);

    return {
      lineCount: lines.length,
      wordCount: words.length,
      characterCount: allText.length,
      emptyLines: lines.length - nonEmptyLines.length,
      longestLine: Math.max(...lineLengths, 0),
      averageLineLength:
        lineLengths.length > 0
          ? Math.round(
              lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length,
            )
          : 0,
    };
  }

  /**
   * Detect various patterns in the text
   */
  private detectPatterns(text: string) {
    return {
      hasTimestamps: this.patterns.timestamp.test(text),
      hasEmailAddresses: this.patterns.email.test(text),
      hasPhoneNumbers: this.patterns.phone.test(text),
      hasAddresses: this.patterns.address.test(text),
      hasCurrency: this.patterns.currency.test(text),
      hasNumbers: /\d+/.test(text),
    };
  }

  /**
   * Analyze text structure and extract structured data
   */
  private analyzeStructure(lines: string[], warnings: string[]) {
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

    if (nonEmptyLines.length === 0) {
      return { type: "unstructured" as TextStructureType };
    }

    // Check for key-value pairs
    const keyValueCount = nonEmptyLines.filter((line) =>
      this.patterns.keyValue.test(line),
    ).length;
    const keyValueRatio = keyValueCount / nonEmptyLines.length;

    if (keyValueRatio > 0.6) {
      const keyValuePairs = this.extractKeyValuePairs(nonEmptyLines, warnings);
      return {
        type: "key-value" as TextStructureType,
        keyValuePairs,
      };
    }

    // Check for tabular data
    const tabCount = nonEmptyLines.filter((line) => line.includes("\t")).length;
    const tabRatio = tabCount / nonEmptyLines.length;

    if (tabRatio > 0.5) {
      const data = this.extractTabularData(nonEmptyLines, "\t", warnings);
      return {
        type: "tabular" as TextStructureType,
        data,
      };
    }

    // Check for pipe-delimited data
    const pipeCount = nonEmptyLines.filter((line) => line.includes("|")).length;
    const pipeRatio = pipeCount / nonEmptyLines.length;

    if (pipeRatio > 0.5) {
      const data = this.extractTabularData(nonEmptyLines, "|", warnings);
      return {
        type: "delimited" as TextStructureType,
        data,
      };
    }

    // Check for log format (lines starting with timestamps)
    const timestampLineCount = nonEmptyLines.filter((line) =>
      /^\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}/.test(line),
    ).length;
    const timestampRatio = timestampLineCount / nonEmptyLines.length;

    if (timestampRatio > 0.3) {
      return { type: "log" as TextStructureType };
    }

    // Check for list format
    const listCount = nonEmptyLines.filter(
      (line) => /^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line),
    ).length;
    const listRatio = listCount / nonEmptyLines.length;

    if (listRatio > 0.4) {
      return { type: "list" as TextStructureType };
    }

    // Check for report format (headers, sections, etc.)
    const headerCount = nonEmptyLines.filter(
      (line) =>
        /^[A-Z\s]+:?\s*$/.test(line) ||
        line.trim().toUpperCase() === line.trim(),
    ).length;
    const headerRatio = headerCount / nonEmptyLines.length;

    if (headerRatio > 0.1 && headerRatio < 0.5) {
      return { type: "report" as TextStructureType };
    }

    return { type: "unstructured" as TextStructureType };
  }

  /**
   * Extract key-value pairs from lines
   */
  private extractKeyValuePairs(
    lines: string[],
    warnings: string[],
  ): Record<string, string> {
    const pairs: Record<string, string> = {};

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        const cleanKey = key.trim();

        if (pairs[cleanKey]) {
          warnings.push(`Duplicate key found: ${cleanKey}`);
        }

        pairs[cleanKey] = value.trim();
      }
    }

    return pairs;
  }

  /**
   * Extract tabular data using specified delimiter
   */
  private extractTabularData(
    lines: string[],
    delimiter: string,
    warnings: string[],
  ): string[][] {
    const data = lines.map((line) =>
      line.split(delimiter).map((cell) => cell.trim()),
    );

    // Check for consistent column counts
    const columnCounts = data.map((row) => row.length);
    const mostCommonCount = this.findMostCommonValue(columnCounts);
    const inconsistentRows = columnCounts.filter(
      (count) => count !== mostCommonCount,
    ).length;

    if (inconsistentRows > 0) {
      warnings.push(
        `${inconsistentRows} rows have inconsistent column counts in tabular data`,
      );
    }

    return data;
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
   * Determine appropriate error code based on error type
   */
  private determineErrorCode(error: Error): string {
    if (error.message.includes("timed out")) {
      return ParserErrorCode.TIMEOUT;
    }
    if (error.message.includes("exceeds maximum")) {
      return ParserErrorCode.FILE_TOO_LARGE;
    }
    if (error.message.includes("decode")) {
      return ParserErrorCode.INVALID_FORMAT;
    }

    return ParserErrorCode.PARSING_ERROR;
  }
}
