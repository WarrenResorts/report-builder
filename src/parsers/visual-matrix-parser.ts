/**
 * @fileoverview VisualMatrix Mapping Parser
 *
 * Parses VisualMatrix Excel files to extract account code mappings.
 * This replaces the generic ExcelMappingParser for the specific VisualMatrix format.
 */

import ExcelJS from "exceljs";
type Worksheet = ExcelJS.Worksheet;
import { Readable } from "stream";
import { BaseFileParser } from "./base/parser-interface";
import {
  ParseResult,
  ParsedData,
  ParserConfig,
  ParserErrorCode,
} from "./base/parser-types";

/**
 * VisualMatrix account mapping entry
 */
export interface VisualMatrixMapping {
  /** Record ID */
  recId: number;
  /** Source account code (from PDF) */
  srcAcctCode: string;
  /** Source account description */
  srcAcctDesc: string;
  /** Cross-reference key */
  xrefKey: string;
  /** Account ID */
  acctId: number;
  /** Property ID (usually 0 for global mappings) */
  propertyId: number;
  /** Property name (usually empty for global mappings) */
  propertyName: string;
  /** Target account code (standardized) */
  acctCode: string;
  /** Account suffix */
  acctSuffix: string;
  /** Target account name (standardized) */
  acctName: string;
  /** Multiplier for calculations */
  multiplier: number;
  /** Created date */
  created: Date;
  /** Updated date */
  updated: Date;
}

/**
 * Parsed VisualMatrix data
 */
export interface VisualMatrixData extends Record<string, unknown> {
  /** All account mappings */
  mappings: VisualMatrixMapping[];
  /** Metadata about the file */
  metadata: {
    totalMappings: number;
    uniqueSourceCodes: number;
    uniqueTargetCodes: number;
    lastUpdated: Date;
    hasPropertySpecificMappings: boolean;
  };
  /** Quick lookup map: sourceCode -> mapping */
  sourceCodeMap: Map<string, VisualMatrixMapping>;
  /** Quick lookup map: targetCode -> mapping */
  targetCodeMap: Map<string, VisualMatrixMapping>;
}

/**
 * VisualMatrix Parser Options
 */
export interface VisualMatrixParserOptions extends Record<string, unknown> {
  /** Sheet name containing the mappings (default: "VisualMatrix") */
  sheetName?: string;
  /** Whether to validate all mappings */
  validateMappings?: boolean;
  /** Whether to include empty mappings */
  includeEmptyMappings?: boolean;
  /** Property ID filter (only include mappings for specific property) */
  propertyIdFilter?: number;
}

/**
 * VisualMatrix Parser
 *
 * Specialized parser for VisualMatrix Excel files containing account code mappings.
 */
export class VisualMatrixParser extends BaseFileParser {
  public readonly fileType = "xlsx" as const;
  public readonly parserInfo = {
    name: "VisualMatrixParser",
    version: "1.0.0",
    description:
      "Parser for VisualMatrix Excel files containing account code mappings",
  };

  private customOptions?: Partial<VisualMatrixParserOptions>;

  constructor(options?: Partial<VisualMatrixParserOptions>) {
    super();
    this.customOptions = options;
  }

  /**
   * Get default parser configuration
   */
  getDefaultConfig(): ParserConfig {
    return {
      timeoutMs: 30000, // Excel files can be larger
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB limit
      includeRawContent: false,
      parserOptions: this.getDefaultParserOptions(),
    };
  }

  /**
   * Get default VisualMatrix parser options
   */
  getDefaultParserOptions(): VisualMatrixParserOptions {
    const defaults = {
      sheetName: "VisualMatrix",
      validateMappings: true,
      includeEmptyMappings: false,
      propertyIdFilter: undefined,
    };

    return { ...defaults, ...this.customOptions };
  }

  /**
   * Check if file can be parsed as VisualMatrix Excel file
   */
  canParse(filename: string, fileBuffer?: Buffer): boolean {
    // Check by extension first
    const extension = this.getFileExtension(filename);
    if (["xlsx", "xls", "csv"].includes(extension)) {
      return true;
    }

    // If extension doesn't match, check by content if buffer provided
    if (fileBuffer) {
      return this.isExcelBuffer(fileBuffer);
    }

    return false;
  }

  /**
   * Check if buffer contains Excel content
   */
  private isExcelBuffer(buffer: Buffer): boolean {
    // Excel files start with PK (ZIP signature) or specific OLE signatures
    const signature = buffer.subarray(0, 4);

    // XLSX files (ZIP-based)
    if (signature[0] === 0x50 && signature[1] === 0x4b) {
      return true;
    }

    // XLS files (OLE-based)
    if (signature[0] === 0xd0 && signature[1] === 0xcf) {
      return true;
    }

    return false;
  }

  /**
   * Parse VisualMatrix Excel file from buffer
   */
  async parseFromBuffer(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    const startTime = Date.now();
    const mergedConfig = { ...this.getDefaultConfig(), ...config };
    const options = mergedConfig.parserOptions as VisualMatrixParserOptions;
    const warnings: string[] = [];

    try {
      // Validate file size
      this.validateFileSize(fileBuffer, mergedConfig);

      // Parse VisualMatrix content
      const visualMatrixData = await this.parseVisualMatrixContent(
        fileBuffer,
        options,
        mergedConfig.timeoutMs,
        warnings,
      );

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        data: visualMatrixData,
        metadata: {
          filename,
          fileType: this.fileType,
          fileSize: fileBuffer.length,
          parsedAt: new Date(),
          parserVersion: `${this.parserInfo.name}@${this.parserInfo.version}`,
          processingTimeMs: processingTime,
          recordCount: visualMatrixData.mappings.length,
          warnings,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      return {
        success: false,
        error: {
          code: ParserErrorCode.PARSING_ERROR,
          message: `Failed to parse VisualMatrix file: ${(error as Error).message}`,
          details: { filename, processingTime },
        },
        data: [] as unknown as ParsedData,
        metadata: {
          filename,
          fileType: this.fileType,
          fileSize: fileBuffer.length,
          parsedAt: new Date(),
          parserVersion: `${this.parserInfo.name}@${this.parserInfo.version}`,
          processingTimeMs: processingTime,
          recordCount: 0,
          warnings,
        },
      };
    }
  }

  /**
   * Parse from string is not supported for Excel files
   */
  async parseFromString(
    _content: string,
    _filename: string,
    _config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    throw new Error(
      "VisualMatrix parser does not support parsing from string - use parseFromBuffer instead",
    );
  }

  /**
   * Parse VisualMatrix content from Excel buffer
   */
  private async parseVisualMatrixContent(
    fileBuffer: Buffer,
    options: VisualMatrixParserOptions,
    timeoutMs: number,
    warnings: string[],
  ): Promise<VisualMatrixData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("VisualMatrix parsing timed out"));
      }, timeoutMs);

      const parseExcel = async () => {
        try {
          // Parse Excel workbook using ExcelJS
          const workbook = new ExcelJS.Workbook();
          const stream = Readable.from(fileBuffer);
          await workbook.xlsx.read(stream);

          // Find the VisualMatrix sheet
          const sheetName = options.sheetName || "VisualMatrix";
          const worksheet = workbook.getWorksheet(sheetName);

          if (!worksheet) {
            throw new Error(
              `Sheet "${sheetName}" not found in Excel file. Available sheets: ${workbook.worksheets.map((ws) => ws.name).join(", ")}`,
            );
          }

          // Parse mappings from the worksheet
          const mappings = this.parseMappingsFromWorksheet(
            worksheet,
            options,
            warnings,
          );

          // Create metadata
          const metadata = this.createMetadata(mappings);

          // Create lookup maps
          const sourceCodeMap = new Map<string, VisualMatrixMapping>();
          const targetCodeMap = new Map<string, VisualMatrixMapping>();

          for (const mapping of mappings) {
            sourceCodeMap.set(mapping.srcAcctCode, mapping);
            if (mapping.acctCode) {
              targetCodeMap.set(mapping.acctCode, mapping);
            }
          }

          const visualMatrixData: VisualMatrixData = {
            mappings,
            metadata,
            sourceCodeMap,
            targetCodeMap,
          };

          clearTimeout(timeout);
          resolve(visualMatrixData);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      parseExcel();
    });
  }

  /**
   * Parse mappings from VisualMatrix worksheet
   */
  private parseMappingsFromWorksheet(
    worksheet: Worksheet,
    options: VisualMatrixParserOptions,
    warnings: string[],
  ): VisualMatrixMapping[] {
    const mappings: VisualMatrixMapping[] = [];

    // Expected headers based on the analysis
    const expectedHeaders = [
      "Rec Id",
      "Src Acct Code",
      "Src Acct Desc",
      "Xref Key",
      "Acct Id",
      "Property Id",
      "Property Name",
      "Acct Code",
      "Acct Suffix",
      "Acct Name",
      "Multiplier",
      "Created",
      "Updated",
    ];

    // Get header row (row 1)
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || "").trim();
    });

    // Validate headers - must have critical columns
    const criticalHeaders = ["Src Acct Code", "Acct Code"];
    const missingCritical = criticalHeaders.filter(
      (expected) =>
        !headers.some(
          (header) => header.toLowerCase() === expected.toLowerCase(),
        ),
    );

    if (missingCritical.length > 0) {
      throw new Error(
        `Missing required columns: ${missingCritical.join(", ")}`,
      );
    }

    // Check for all expected headers and warn about missing ones
    const missingHeaders = expectedHeaders.filter(
      (expected) =>
        !headers.some(
          (header) => header.toLowerCase() === expected.toLowerCase(),
        ),
    );

    if (missingHeaders.length > 0) {
      warnings.push(`Missing optional columns: ${missingHeaders.join(", ")}`);
    }

    // Track statistics for warnings
    let invalidRows = 0;
    let filteredRows = 0;

    // Parse data rows (starting from row 2)
    for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum);

      // Skip empty rows
      if (!row.hasValues) {
        continue;
      }

      try {
        const mapping = this.parseRowToMapping(row, headers);

        // Validate required fields
        if (!mapping.srcAcctCode || !mapping.acctCode) {
          if (!options.includeEmptyMappings) {
            invalidRows++;
            continue;
          }
        }

        // Apply property filter
        if (
          options.propertyIdFilter !== undefined &&
          mapping.propertyId !== options.propertyIdFilter &&
          mapping.propertyId !== 0
        ) {
          // 0 means global mapping
          filteredRows++;
          continue;
        }

        mappings.push(mapping);
      } catch (error) {
        invalidRows++;
        warnings.push(
          `Failed to parse row ${rowNum}: ${(error as Error).message}`,
        );
      }
    }

    // Add summary warnings
    if (mappings.length === 0) {
      warnings.push("No data rows found in VisualMatrix sheet");
    }

    if (invalidRows > 0) {
      warnings.push(
        `Skipped ${invalidRows} invalid rows (missing required fields)`,
      );
    }

    if (filteredRows > 0) {
      warnings.push(
        `Filtered out ${filteredRows} rows due to property ID filter`,
      );
    }

    return mappings;
  }

  /**
   * Parse a single row into a VisualMatrixMapping
   */
  private parseRowToMapping(
    row: ExcelJS.Row,
    headers: string[],
  ): VisualMatrixMapping {
    const getValue = (headerName: string): any => {
      const headerIndex = headers.findIndex(
        (h) => h.toLowerCase() === headerName.toLowerCase(),
      );
      if (headerIndex === -1) return "";

      const cell = row.getCell(headerIndex + 1);
      return cell.value;
    };

    return {
      recId: this.parseNumber(getValue("Rec Id")) || 0,
      srcAcctCode: String(getValue("Src Acct Code") || "").trim(),
      srcAcctDesc: String(getValue("Src Acct Desc") || "").trim(),
      xrefKey: String(getValue("Xref Key") || "").trim(),
      acctId: this.parseNumber(getValue("Acct Id")) || 0,
      propertyId: this.parseNumber(getValue("Property Id")) || 0,
      propertyName: String(getValue("Property Name") || "").trim(),
      acctCode: String(getValue("Acct Code") || "").trim(),
      acctSuffix: String(getValue("Acct Suffix") || "").trim(),
      acctName: String(getValue("Acct Name") || "").trim(),
      multiplier: this.parseNumber(getValue("Multiplier")) || 1,
      created: this.parseDate(getValue("Created")) || new Date(),
      updated: this.parseDate(getValue("Updated")) || new Date(),
    };
  }

  /**
   * Parse number from Excel cell value
   */
  private parseNumber(value: any): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const num = Number(value);
    return isNaN(num) ? null : num;
  }

  /**
   * Parse date from Excel cell value
   */
  private parseDate(value: any): Date | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }

  /**
   * Create metadata from mappings
   */
  private createMetadata(
    mappings: VisualMatrixMapping[],
  ): VisualMatrixData["metadata"] {
    const uniqueSourceCodes = new Set(mappings.map((m) => m.srcAcctCode)).size;
    const uniqueTargetCodes = new Set(
      mappings.map((m) => m.acctCode).filter(Boolean),
    ).size;
    const hasPropertySpecificMappings = mappings.some((m) => m.propertyId > 0);
    const lastUpdated = mappings.reduce((latest, mapping) => {
      return mapping.updated > latest ? mapping.updated : latest;
    }, new Date(0));

    return {
      totalMappings: mappings.length,
      uniqueSourceCodes,
      uniqueTargetCodes,
      lastUpdated,
      hasPropertySpecificMappings,
    };
  }

  /**
   * Find mapping for a source account code
   */
  static findMappingBySourceCode(
    data: VisualMatrixData,
    sourceCode: string,
    propertyId?: number,
  ): VisualMatrixMapping | undefined {
    // First try property-specific mapping if propertyId is provided
    if (propertyId !== undefined) {
      const propertySpecificMapping = data.mappings.find(
        (m) => m.srcAcctCode === sourceCode && m.propertyId === propertyId,
      );
      if (propertySpecificMapping) {
        return propertySpecificMapping;
      }
    }

    // Fall back to global mapping (propertyId = 0)
    return data.mappings.find(
      (m) => m.srcAcctCode === sourceCode && m.propertyId === 0,
    );
  }

  /**
   * Get all mappings for a specific property
   */
  static getMappingsForProperty(
    data: VisualMatrixData,
    propertyId: number,
  ): VisualMatrixMapping[] {
    return data.mappings.filter(
      (m) => m.propertyId === propertyId || m.propertyId === 0, // Include global mappings
    );
  }
}
