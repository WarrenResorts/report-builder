/**
 * @fileoverview Excel Mapping File Parser
 *
 * Parses Excel mapping files to extract data transformation rules.
 * Supports flexible mapping structures and validation of transformation rules.
 */

import { Workbook, Worksheet } from "exceljs";
import { Readable } from "stream";
import { BaseFileParser } from "./base/parser-interface";
import {
  ParseResult,
  ParsedData,
  ParserConfig,
  ParserErrorCode,
  ExcelMappingParserOptions,
} from "./base/parser-types";

/**
 * Represents a single transformation rule from the mapping file
 */
export interface TransformationRule {
  /** Source field identifier */
  sourceField: string;
  /** Target field name in output */
  targetField: string;
  /** Data type of the field */
  dataType: "string" | "number" | "date" | "boolean";
  /** Whether this field is required */
  required: boolean;
  /** Default value if source is empty */
  defaultValue?: string | number | Date | boolean | null;
  /** Transformation function to apply */
  transformation?:
    | "uppercase"
    | "lowercase"
    | "trim"
    | "currency"
    | "date_format"
    | "custom";
  /** Custom transformation parameters */
  transformationParams?: Record<string, unknown>;
  /** Validation rules */
  validation?: ValidationConfig;
}

/**
 * Represents mapping rules for a specific property
 */
export interface PropertyMapping {
  /** Property identifier */
  propertyId: string;
  /** Property name */
  propertyName: string;
  /** File format this mapping applies to */
  fileFormat: "pdf" | "csv" | "txt" | "all";
  /** Transformation rules for this property */
  rules: TransformationRule[];
  /** Property-specific configuration */
  config?: {
    /** Expected file patterns */
    filePatterns?: string[];
    /** Property-specific validation */
    customValidation?: Record<string, unknown>;
  };
}

/**
 * Raw data structure from Excel worksheet
 */
interface ExcelRowData {
  [key: string]: string | number | Date | boolean | null | undefined;
}

/**
 * Key-value pair from configuration sheets
 */

/**
 * Validation configuration object
 */
interface ValidationConfig {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  allowedValues?: (string | number | boolean)[];
}

/**
 * Custom transformation definition
 */
interface CustomTransformation {
  description?: string;
  parameters?: Record<string, unknown>;
  code?: string;
}

/**
 * Complete mapping configuration extracted from Excel file
 */
export interface ExcelMappingData {
  /** Mapping file metadata */
  metadata: {
    version: string;
    createdDate: Date;
    lastModified: Date;
    description?: string;
  };
  /** Global configuration settings */
  globalConfig: {
    /** Default output format */
    outputFormat: "csv" | "json";
    /** Date format to use */
    dateFormat: string;
    /** Currency format */
    currencyFormat?: string;
    /** Timezone for date processing */
    timezone?: string;
  };
  /** Property-specific mappings */
  propertyMappings: PropertyMapping[];
  /** Custom transformation functions */
  customTransformations?: Record<string, CustomTransformation>;
}

/**
 * Excel Mapping File Parser
 *
 * Parses Excel files containing data transformation rules and property mappings.
 * Supports multiple sheets and flexible mapping structures.
 */
export class ExcelMappingParser extends BaseFileParser {
  public readonly fileType = "excel-mapping" as const;
  public readonly parserInfo = {
    name: "ExcelMappingParser",
    version: "1.0.0",
    description:
      "Parser for Excel mapping files containing transformation rules",
  };

  /**
   * Get default parser configuration
   */
  getDefaultConfig(): ParserConfig {
    return {
      timeoutMs: 30000, // Excel files can be larger
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB limit
      includeRawContent: false, // Excel files are binary, raw content not useful
      parserOptions: this.getDefaultParserOptions(),
    };
  }

  /**
   * Get default Excel mapping parser options
   */
  getDefaultParserOptions(): ExcelMappingParserOptions {
    return {
      /** Sheet containing property mappings */
      mappingSheetName: "Mappings",
      /** Sheet containing global configuration */
      configSheetName: "Config",
      /** Sheet containing metadata */
      metadataSheetName: "Metadata",
      /** Whether to validate all rules */
      validateRules: true,
      /** Whether to allow missing sheets */
      allowMissingSheets: true,
      /** Custom sheet names mapping */
      customSheetNames: {},
    };
  }

  /**
   * Check if file can be parsed as Excel mapping file
   */
  canParse(filename: string, fileBuffer?: Buffer): boolean {
    // Check by extension first
    const extension = this.getFileExtension(filename);
    if (["xlsx", "xls"].includes(extension)) {
      return true;
    }

    // If extension doesn't match, check by content if buffer provided
    if (fileBuffer) {
      return this.isExcelBuffer(fileBuffer);
    }

    return false;
  }

  /**
   * Parse Excel mapping file from buffer
   */
  async parseFromBuffer(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    const startTime = Date.now();

    try {
      // Merge configuration
      const defaultConfig = this.getDefaultConfig();
      const mergedConfig = {
        ...defaultConfig,
        ...config,
        parserOptions: {
          ...defaultConfig.parserOptions,
          ...config?.parserOptions,
        },
      };

      // Validate file size
      if (fileBuffer.length > mergedConfig.maxFileSizeBytes!) {
        throw new Error(
          `File size ${fileBuffer.length} bytes exceeds maximum ${mergedConfig.maxFileSizeBytes} bytes`,
        );
      }

      // Parse Excel file
      const mappingData = await this.parseExcelMappingContent(
        fileBuffer,
        mergedConfig.parserOptions as ExcelMappingParserOptions,
        mergedConfig.timeoutMs!,
      );

      // Create successful result
      return {
        success: true,
        data: mappingData as unknown as ParsedData,
        metadata: this.createBaseMetadata(filename, fileBuffer, startTime),
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
   * Excel mapping parser doesn't support string input
   */
  async parseFromString(
    _content: string,
    _filename: string,
    _config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    throw new Error(
      "Excel mapping parser does not support string input - use parseFromBuffer with Excel file buffer",
    );
  }

  /**
   * Parse Excel mapping content from buffer
   */
  private async parseExcelMappingContent(
    fileBuffer: Buffer,
    options: ExcelMappingParserOptions,
    timeoutMs: number,
  ): Promise<ExcelMappingData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Excel mapping parsing timed out"));
      }, timeoutMs);

      const parseExcel = async () => {
        try {
          // Parse Excel workbook using ExcelJS
          const workbook = new Workbook();
          // Convert Buffer to Stream for ExcelJS
          const stream = Readable.from(fileBuffer);
          await workbook.xlsx.read(stream);

          // Extract data from different sheets
          const metadata = this.extractMetadata(workbook, options);
          const globalConfig = this.extractGlobalConfig(workbook, options);
          const propertyMappings = this.extractPropertyMappings(
            workbook,
            options,
          );
          const customTransformations = this.extractCustomTransformations(
            workbook,
            options,
          );

          // Validate rules if requested
          if (options.validateRules) {
            this.validateMappingRules(propertyMappings);
          }

          const mappingData: ExcelMappingData = {
            metadata,
            globalConfig,
            propertyMappings,
            customTransformations,
          };

          clearTimeout(timeout);
          resolve(mappingData);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      parseExcel();
    });
  }

  /**
   * Extract metadata from Excel file
   */
  private extractMetadata(
    workbook: Workbook,
    options: ExcelMappingParserOptions,
  ) {
    const sheetName =
      options.customSheetNames?.metadata ||
      options.metadataSheetName ||
      "Metadata";
    const worksheet = workbook.getWorksheet(sheetName);

    if (!worksheet && !options.allowMissingSheets) {
      throw new Error(`Required metadata sheet '${sheetName}' not found`);
    }

    // Default metadata if sheet is missing
    if (!worksheet) {
      return {
        version: "1.0.0",
        createdDate: new Date(),
        lastModified: new Date(),
        description: "Auto-generated metadata",
      };
    }

    // Extract metadata from sheet (assuming key-value pairs)
    const data = this.worksheetToJson(worksheet, ["key", "value"]);
    const metadataMap = new Map(
      data.map((row) => [row.key as string, row.value]),
    );

    return {
      version: String(metadataMap.get("version") || "1.0.0"),
      createdDate: this.parseDate(metadataMap.get("createdDate")) || new Date(),
      lastModified:
        this.parseDate(metadataMap.get("lastModified")) || new Date(),
      description: metadataMap.get("description")
        ? String(metadataMap.get("description"))
        : undefined,
    };
  }

  /**
   * Extract global configuration from Excel file
   */
  private extractGlobalConfig(
    workbook: Workbook,
    options: ExcelMappingParserOptions,
  ) {
    const sheetName =
      options.customSheetNames?.config || options.configSheetName || "Config";
    const worksheet = workbook.getWorksheet(sheetName);

    if (!worksheet && !options.allowMissingSheets) {
      throw new Error(`Required config sheet '${sheetName}' not found`);
    }

    // Default config if sheet is missing
    if (!worksheet) {
      return {
        outputFormat: "csv" as const,
        dateFormat: "YYYY-MM-DD",
        currencyFormat: "USD",
        timezone: "UTC",
      };
    }

    // Extract config from sheet
    const data = this.worksheetToJson(worksheet, ["key", "value"]);
    const configMap = new Map(
      data.map((row) => [row.key as string, row.value]),
    );

    return {
      outputFormat: String(configMap.get("outputFormat") || "csv") as
        | "csv"
        | "json",
      dateFormat: String(configMap.get("dateFormat") || "YYYY-MM-DD"),
      currencyFormat: configMap.get("currencyFormat")
        ? String(configMap.get("currencyFormat"))
        : undefined,
      timezone: configMap.get("timezone")
        ? String(configMap.get("timezone"))
        : undefined,
    };
  }

  /**
   * Extract property mappings from Excel file
   */
  private extractPropertyMappings(
    workbook: Workbook,
    options: ExcelMappingParserOptions,
  ): PropertyMapping[] {
    const sheetName =
      options.customSheetNames?.mappings ||
      options.mappingSheetName ||
      "Mappings";
    const worksheet = workbook.getWorksheet(sheetName);

    if (!worksheet) {
      throw new Error(`Required mappings sheet '${sheetName}' not found`);
    }

    // Convert sheet to JSON with first row as headers
    const rawData = this.worksheetToJson(worksheet);

    // Group by property
    const propertyGroups = new Map<string, ExcelRowData[]>();

    rawData.forEach((row) => {
      const propertyId = String(
        row.propertyId || row.PropertyID || row["Property ID"] || "",
      );
      if (!propertyId) return;

      if (!propertyGroups.has(propertyId)) {
        propertyGroups.set(propertyId, []);
      }
      propertyGroups.get(propertyId)!.push(row);
    });

    // Convert to PropertyMapping objects
    return Array.from(propertyGroups.entries()).map(([propertyId, rows]) => {
      const firstRow = rows[0];

      return {
        propertyId,
        propertyName: String(
          firstRow.propertyName ||
            firstRow.PropertyName ||
            firstRow["Property Name"] ||
            propertyId,
        ),
        fileFormat: String(
          firstRow.fileFormat ||
            firstRow.FileFormat ||
            firstRow["File Format"] ||
            "all",
        ) as "pdf" | "csv" | "txt" | "all",
        rules: rows.map((row) => this.parseTransformationRule(row)),
        config: {
          filePatterns: this.parseArray(
            firstRow.filePatterns ||
              firstRow.FilePatterns ||
              firstRow["File Patterns"],
          )?.map(String),
        },
      };
    });
  }

  /**
   * Extract custom transformations from Excel file
   */
  private extractCustomTransformations(
    workbook: Workbook,
    _options: ExcelMappingParserOptions,
  ) {
    const sheetName = "CustomTransformations";
    const worksheet = workbook.getWorksheet(sheetName);

    if (!worksheet) {
      return {}; // Custom transformations are optional
    }

    const data = this.worksheetToJson(worksheet);
    const transformations: Record<string, CustomTransformation> = {};

    data.forEach((row) => {
      const name = String(row.name || row.Name || "");
      if (name) {
        transformations[name] = {
          description:
            row.description || row.Description
              ? String(row.description || row.Description)
              : undefined,
          parameters: this.parseJSON(row.parameters || row.Parameters) as
            | Record<string, unknown>
            | undefined,
          code: row.code || row.Code ? String(row.code || row.Code) : undefined,
        };
      }
    });

    return transformations;
  }

  /**
   * Convert ExcelJS worksheet to JSON format (similar to XLSX.utils.sheet_to_json)
   */
  private worksheetToJson(
    worksheet: Worksheet,
    headers?: string[],
  ): ExcelRowData[] {
    const jsonData: ExcelRowData[] = [];

    if (!worksheet) {
      return jsonData;
    }

    // Get the actual range of the worksheet
    const actualRange = worksheet.actualRowCount;
    if (actualRange === 0) {
      return jsonData;
    }

    let headerRow: string[] = [];
    let dataStartRow = 2; // Default to row 2 (assuming row 1 has headers)

    if (headers) {
      // Use provided headers
      headerRow = headers;
      dataStartRow = 1; // Start from row 1 if headers are provided
    } else {
      // Use first row as headers
      const firstRow = worksheet.getRow(1);
      firstRow.eachCell((cell, colNumber) => {
        headerRow[colNumber - 1] = cell.text || `col_${colNumber}`;
      });
    }

    // Process data rows
    for (let rowNum = dataStartRow; rowNum <= actualRange; rowNum++) {
      const row = worksheet.getRow(rowNum);
      const rowData: ExcelRowData = {};
      let hasData = false;

      row.eachCell((cell, colNumber) => {
        const header = headerRow[colNumber - 1];
        if (header) {
          // Get cell value, handling different types
          let value: string | number | Date | boolean | null = null;

          // Handle different cell types
          if (cell.type === 6 && cell.value instanceof Date) {
            // Date type - keep as Date object
            value = cell.value;
          } else if (cell.type === 1 && typeof cell.value === "number") {
            // Number type
            value = cell.value;
          } else if (cell.value !== null && cell.value !== undefined) {
            // Text or other types
            value = cell.text || String(cell.value);
          }

          rowData[header] = value;
          hasData = true;
        }
      });

      // Only add rows that have some data
      if (hasData) {
        jsonData.push(rowData);
      }
    }

    return jsonData;
  }

  /**
   * Parse a single transformation rule from Excel row
   */
  private parseTransformationRule(row: ExcelRowData): TransformationRule {
    return {
      sourceField: String(
        row.sourceField || row.SourceField || row["Source Field"] || "",
      ),
      targetField: String(
        row.targetField || row.TargetField || row["Target Field"] || "",
      ),
      dataType: String(
        row.dataType || row.DataType || row["Data Type"] || "string",
      ) as "string" | "number" | "date" | "boolean",
      required: this.parseBoolean(row.required || row.Required),
      defaultValue:
        row.defaultValue || row.DefaultValue || row["Default Value"] || null,
      transformation: this.parseTransformationType(
        row.transformation || row.Transformation,
      ),
      transformationParams: this.parseJSON(
        row.transformationParams ||
          row.TransformationParams ||
          row["Transformation Params"],
      ) as Record<string, unknown> | undefined,
      validation: this.parseValidation(row),
    };
  }

  /**
   * Parse transformation type from Excel row value
   */
  private parseTransformationType(
    value: unknown,
  ): TransformationRule["transformation"] {
    if (!value) return undefined;
    const strValue = String(value).toLowerCase();
    const validTypes: TransformationRule["transformation"][] = [
      "uppercase",
      "lowercase",
      "trim",
      "currency",
      "date_format",
      "custom",
    ];
    return validTypes.find((type) => type === strValue) || undefined;
  }

  /**
   * Parse validation rules from Excel row
   */
  private parseValidation(row: ExcelRowData): ValidationConfig | undefined {
    const validation: Partial<ValidationConfig> = {};

    if (row.minLength || row.MinLength || row["Min Length"]) {
      validation.minLength = parseInt(
        String(row.minLength || row.MinLength || row["Min Length"]),
      );
    }

    if (row.maxLength || row.MaxLength || row["Max Length"]) {
      validation.maxLength = parseInt(
        String(row.maxLength || row.MaxLength || row["Max Length"]),
      );
    }

    if (row.pattern || row.Pattern) {
      validation.pattern = String(row.pattern || row.Pattern);
    }

    if (row.allowedValues || row.AllowedValues || row["Allowed Values"]) {
      validation.allowedValues = this.parseArray(
        row.allowedValues || row.AllowedValues || row["Allowed Values"],
      );
    }

    return Object.keys(validation).length > 0
      ? (validation as ValidationConfig)
      : undefined;
  }

  /**
   * Validate mapping rules for consistency and completeness
   */
  private validateMappingRules(propertyMappings: PropertyMapping[]) {
    for (const mapping of propertyMappings) {
      // Check for required fields
      if (!mapping.propertyId) {
        throw new Error("Property mapping missing propertyId");
      }

      // Validate transformation rules
      for (const rule of mapping.rules) {
        if (!rule.sourceField) {
          throw new Error(
            `Rule for property ${mapping.propertyId} missing sourceField`,
          );
        }

        if (!rule.targetField) {
          throw new Error(
            `Rule for property ${mapping.propertyId} missing targetField`,
          );
        }

        // Validate data types
        const validDataTypes = ["string", "number", "date", "boolean"];
        if (!validDataTypes.includes(rule.dataType)) {
          throw new Error(
            `Invalid data type '${rule.dataType}' for rule ${rule.sourceField} -> ${rule.targetField}`,
          );
        }
      }
    }
  }

  /**
   * Check if buffer contains Excel data
   */
  private isExcelBuffer(buffer: Buffer): boolean {
    // Check for Excel file signatures
    const xlsxSignature = [0x50, 0x4b]; // PK (ZIP signature for .xlsx)
    const xlsSignature = [0xd0, 0xcf, 0x11, 0xe0]; // OLE signature for .xls

    // Check XLSX signature
    if (
      buffer.length >= 2 &&
      buffer[0] === xlsxSignature[0] &&
      buffer[1] === xlsxSignature[1]
    ) {
      return true;
    }

    // Check XLS signature
    if (buffer.length >= 4) {
      for (let i = 0; i < xlsSignature.length; i++) {
        if (buffer[i] !== xlsSignature[i]) {
          break;
        }
        if (i === xlsSignature.length - 1) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Helper method to parse dates from various formats
   */
  private parseDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;

    const parsed = new Date(String(value));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Helper method to parse boolean values
   */
  private parseBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return ["true", "yes", "1", "on"].includes(value.toLowerCase());
    }
    return Boolean(value);
  }

  /**
   * Helper method to parse JSON strings
   */
  private parseJSON(value: unknown): unknown {
    if (!value) return undefined;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(String(value));
    } catch {
      return undefined;
    }
  }

  /**
   * Helper method to parse array strings
   */
  private parseArray(
    value: unknown,
  ): (string | number | boolean)[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => {
          const trimmed = item.trim();
          // Skip empty strings
          if (trimmed === "") return "";
          // Try to convert to number or boolean if possible
          if (trimmed === "true") return true;
          if (trimmed === "false") return false;
          const num = Number(trimmed);
          if (!isNaN(num) && isFinite(num) && trimmed !== "") return num;
          return trimmed;
        })
        .filter((item) => item !== "");
    }

    return undefined;
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
    if (
      error.message.includes("sheet") &&
      error.message.includes("not found")
    ) {
      return ParserErrorCode.INVALID_FORMAT;
    }
    if (error.message.includes("missing")) {
      return ParserErrorCode.INVALID_FORMAT;
    }
    return ParserErrorCode.PARSING_ERROR;
  }
}
