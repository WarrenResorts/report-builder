/**
 * @fileoverview Data Transformation Engine
 *
 * This module provides a comprehensive transformation engine that applies
 * mapping rules to convert parsed file data into standardized output format.
 */

import { Logger } from "../utils/logger";
import type {
  ExcelMappingData,
  PropertyMapping,
  TransformationRule,
} from "../parsers/excel-mapping-parser";

/**
 * Raw data from parsed files that needs to be transformed
 */
export interface RawFileData {
  /** Source file information */
  source: {
    filename: string;
    propertyId: string;
    fileType: "pdf" | "csv" | "txt";
    parsedAt: Date;
  };
  /** Parsed content from the file */
  content: Record<string, any>;
  /** Metadata from the parsing process */
  metadata: {
    recordCount: number;
    processingTimeMs: number;
    warnings: string[];
  };
}

/**
 * Transformed data ready for output
 */
export interface TransformedData {
  /** Property information */
  propertyId: string;
  propertyName: string;
  /** Transformed records */
  records: TransformedRecord[];
  /** Transformation metadata */
  metadata: {
    sourceFile: string;
    sourceFileType: string;
    transformedAt: Date;
    recordCount: number;
    transformationTimeMs: number;
    appliedRules: number;
    warnings: string[];
    errors: TransformationError[];
  };
}

/**
 * Individual transformed record
 */
export interface TransformedRecord {
  /** Unique record identifier */
  recordId: string;
  /** Transformed field values */
  fields: Record<string, any>;
  /** Record-specific metadata */
  metadata: {
    sourceRowIndex?: number;
    transformationWarnings: string[];
  };
}

/**
 * Transformation error information
 */
export interface TransformationError {
  /** Error type */
  type:
    | "VALIDATION_ERROR"
    | "TRANSFORMATION_ERROR"
    | "MISSING_REQUIRED_FIELD"
    | "TYPE_CONVERSION_ERROR";
  /** Error message */
  message: string;
  /** Field that caused the error */
  field?: string;
  /** Source value that failed */
  sourceValue?: any;
  /** Record index where error occurred */
  recordIndex?: number;
}

/**
 * Transformation configuration
 */
export interface TransformationConfig {
  /** Whether to continue processing on errors */
  continueOnError: boolean;
  /** Maximum number of errors before stopping */
  maxErrors: number;
  /** Whether to include debug information */
  includeDebugInfo: boolean;
  /** Custom transformation functions */
  customTransformations?: Record<string, (value: any, params?: any) => any>;
  /** Validation mode */
  validationMode: "strict" | "lenient" | "skip";
}

/**
 * Data Transformation Engine
 *
 * Applies mapping rules to transform raw parsed file data into standardized format.
 */
export class TransformationEngine {
  private config: TransformationConfig;
  private logger: Logger;

  constructor(config?: Partial<TransformationConfig>) {
    this.config = {
      continueOnError: true,
      maxErrors: 100,
      includeDebugInfo: false,
      validationMode: "lenient",
      ...config,
    };
    this.logger = new Logger("TransformationEngine");
  }

  /**
   * Transform raw file data using mapping rules
   */
  async transformData(
    rawData: RawFileData,
    mappingData: ExcelMappingData,
    correlationId: string,
  ): Promise<TransformedData> {
    const startTime = Date.now();
    const errors: TransformationError[] = [];
    const warnings: string[] = [];

    this.logger.info("Starting data transformation", {
      correlationId,
      propertyId: rawData.source.propertyId,
      sourceFile: rawData.source.filename,
      fileType: rawData.source.fileType,
    });

    try {
      // Find matching property mapping
      const propertyMapping = this.findPropertyMapping(rawData, mappingData);
      if (!propertyMapping) {
        throw new Error(
          `No mapping found for property ${rawData.source.propertyId} and file type ${rawData.source.fileType}`,
        );
      }

      // Extract records from raw content
      const sourceRecords = this.extractSourceRecords(
        rawData.content,
        rawData.source.fileType,
      );

      // Transform each record
      const transformedRecords: TransformedRecord[] = [];
      let appliedRulesCount = 0;

      for (let i = 0; i < sourceRecords.length; i++) {
        if (errors.length >= this.config.maxErrors) {
          warnings.push(
            `Stopped processing after ${this.config.maxErrors} errors`,
          );
          break;
        }

        try {
          const transformedRecord = await this.transformRecord(
            sourceRecords[i],
            i,
            propertyMapping.rules,
            mappingData.customTransformations,
            correlationId,
          );

          transformedRecords.push(transformedRecord);
          appliedRulesCount += propertyMapping.rules.length;
        } catch (error) {
          const transformationError: TransformationError = {
            type: "TRANSFORMATION_ERROR",
            message: `Failed to transform record ${i}: ${(error as Error).message}`,
            recordIndex: i,
          };

          errors.push(transformationError);

          if (!this.config.continueOnError) {
            throw error;
          }
        }
      }

      const processingTime = Date.now() - startTime;

      this.logger.info("Data transformation completed", {
        correlationId,
        recordsProcessed: sourceRecords.length,
        recordsTransformed: transformedRecords.length,
        errorsCount: errors.length,
        warningsCount: warnings.length,
        processingTimeMs: processingTime,
      });

      return {
        propertyId: rawData.source.propertyId,
        propertyName: propertyMapping.propertyName,
        records: transformedRecords,
        metadata: {
          sourceFile: rawData.source.filename,
          sourceFileType: rawData.source.fileType,
          transformedAt: new Date(),
          recordCount: transformedRecords.length,
          transformationTimeMs: processingTime,
          appliedRules: appliedRulesCount,
          warnings: [...rawData.metadata.warnings, ...warnings],
          errors,
        },
      };
    } catch (error) {
      this.logger.error("Data transformation failed", error as Error, {
        correlationId,
      });

      throw new Error(
        `Data transformation failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find the appropriate property mapping for the raw data
   */
  private findPropertyMapping(
    rawData: RawFileData,
    mappingData: ExcelMappingData,
  ): PropertyMapping | null {
    return (
      mappingData.propertyMappings.find((mapping) => {
        // Match by property ID
        if (mapping.propertyId !== rawData.source.propertyId) {
          return false;
        }

        // Match by file format
        return (
          mapping.fileFormat === "all" ||
          mapping.fileFormat === rawData.source.fileType
        );
      }) || null
    );
  }

  /**
   * Extract individual records from raw content based on file type
   */
  private extractSourceRecords(
    content: Record<string, any>,
    fileType: string,
  ): Record<string, any>[] {
    switch (fileType) {
      case "csv":
        // CSV content should have a 'rows' property with array of objects
        return Array.isArray(content.rows) ? content.rows : [];

      case "pdf":
        // PDF content might be structured text - create single record
        return [
          {
            text: content.text || content,
            pageCount: content.pageCount,
            pages: content.pages,
          },
        ];

      case "txt":
        // TXT content might have structured data or be a single text block
        if (content.structuredData && Array.isArray(content.structuredData)) {
          return content.structuredData;
        }
        return [
          {
            text: content.text || content,
            lines: content.lines,
            structure: content.detectedStructure,
          },
        ];

      default:
        // Fallback: treat as single record
        return [content];
    }
  }

  /**
   * Transform a single record using transformation rules
   */
  private async transformRecord(
    sourceRecord: Record<string, any>,
    recordIndex: number,
    rules: TransformationRule[],
    customTransformations: Record<string, any> = {},
    correlationId: string,
  ): Promise<TransformedRecord> {
    const transformedFields: Record<string, any> = {};
    const recordWarnings: string[] = [];

    for (const rule of rules) {
      try {
        // Extract source value
        const sourceValue = this.extractSourceValue(
          sourceRecord,
          rule.sourceField,
        );

        // Apply transformation
        const transformedValue = await this.applyTransformationRule(
          sourceValue,
          rule,
          customTransformations,
          correlationId,
        );

        // Validate result
        const validationResult = this.validateTransformedValue(
          transformedValue,
          rule,
        );
        if (!validationResult.isValid) {
          if (this.config.validationMode === "strict") {
            throw new Error(
              `Validation failed for field ${rule.targetField}: ${validationResult.error}`,
            );
          } else if (this.config.validationMode === "lenient") {
            recordWarnings.push(
              `Validation warning for field ${rule.targetField}: ${validationResult.error}`,
            );
          }
        }

        // Set transformed value
        transformedFields[rule.targetField] = transformedValue;
      } catch (error) {
        if (rule.required) {
          throw new Error(
            `Required field transformation failed: ${rule.targetField} - ${(error as Error).message}`,
          );
        } else {
          recordWarnings.push(
            `Optional field transformation failed: ${rule.targetField} - ${(error as Error).message}`,
          );
          // Use default value if available
          if (rule.defaultValue !== undefined) {
            transformedFields[rule.targetField] = rule.defaultValue;
          }
        }
      }
    }

    return {
      recordId: this.generateRecordId(recordIndex, sourceRecord),
      fields: transformedFields,
      metadata: {
        sourceRowIndex: recordIndex,
        transformationWarnings: recordWarnings,
      },
    };
  }

  /**
   * Extract value from source record using field path
   */
  private extractSourceValue(
    sourceRecord: Record<string, any>,
    fieldPath: string,
  ): any {
    // Support nested field paths (e.g., "tenant.name" or "address.street")
    const pathParts = fieldPath.split(".");
    let value: any = sourceRecord;

    for (const part of pathParts) {
      if (value && typeof value === "object" && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Apply transformation rule to a value
   */
  private async applyTransformationRule(
    sourceValue: any,
    rule: TransformationRule,
    customTransformations: Record<string, any>,
    _correlationId: string,
  ): Promise<any> {
    // Handle null/undefined values
    if (sourceValue == null) {
      if (rule.required && rule.defaultValue === undefined) {
        throw new Error(
          `Required field ${rule.sourceField} is null or undefined`,
        );
      }
      return rule.defaultValue !== undefined ? rule.defaultValue : null;
    }

    // Convert to target data type
    let transformedValue = this.convertDataType(sourceValue, rule.dataType);

    // Apply transformation function if specified
    if (rule.transformation) {
      transformedValue = await this.applyTransformation(
        transformedValue,
        rule.transformation,
        rule.transformationParams,
        customTransformations,
      );
    }

    return transformedValue;
  }

  /**
   * Convert value to specified data type
   */
  private convertDataType(value: any, dataType: string): any {
    try {
      switch (dataType) {
        case "string":
          return String(value);

        case "number":
          if (typeof value === "string") {
            // Remove common formatting (commas, currency symbols)
            const cleaned = value.replace(/[,$]/g, "");
            const parsed = parseFloat(cleaned);
            if (isNaN(parsed)) {
              throw new Error(`Cannot convert "${value}" to number`);
            }
            return parsed;
          }
          return Number(value);

        case "date": {
          if (value instanceof Date) {
            return value;
          }
          const parsed = new Date(value);
          if (isNaN(parsed.getTime())) {
            throw new Error(`Cannot convert "${value}" to date`);
          }
          return parsed;
        }

        case "boolean":
          if (typeof value === "boolean") {
            return value;
          }
          if (typeof value === "string") {
            const lower = value.toLowerCase();
            return ["true", "yes", "1", "on"].includes(lower);
          }
          return Boolean(value);

        default:
          return value;
      }
    } catch (error) {
      throw new Error(`Type conversion failed: ${(error as Error).message}`);
    }
  }

  /**
   * Apply transformation function to a value
   */
  private async applyTransformation(
    value: any,
    transformation: string,
    params: any,
    customTransformations: Record<string, any>,
  ): Promise<any> {
    switch (transformation) {
      case "uppercase":
        return String(value).toUpperCase();

      case "lowercase":
        return String(value).toLowerCase();

      case "trim":
        return String(value).trim();

      case "currency": {
        const precision = params?.precision || 2;
        return parseFloat(String(value).replace(/[^0-9.-]/g, "")).toFixed(
          precision,
        );
      }

      case "date_format": {
        const date = value instanceof Date ? value : new Date(value);
        const format = params?.format || "YYYY-MM-DD";
        return this.formatDate(date, format);
      }

      case "custom":
        if (
          params?.functionName &&
          customTransformations[params.functionName]
        ) {
          return customTransformations[params.functionName](value, params);
        }
        throw new Error(
          `Custom transformation function not found: ${params?.functionName}`,
        );

      default:
        return value;
    }
  }

  /**
   * Validate transformed value against rules
   */
  private validateTransformedValue(
    value: any,
    rule: TransformationRule,
  ): { isValid: boolean; error?: string } {
    if (!rule.validation) {
      return { isValid: true };
    }

    const validation = rule.validation;

    // Check string length constraints
    if (
      validation.minLength !== undefined ||
      validation.maxLength !== undefined
    ) {
      const strValue = String(value);
      if (
        validation.minLength !== undefined &&
        strValue.length < validation.minLength
      ) {
        return {
          isValid: false,
          error: `Value too short (min: ${validation.minLength}, actual: ${strValue.length})`,
        };
      }
      if (
        validation.maxLength !== undefined &&
        strValue.length > validation.maxLength
      ) {
        return {
          isValid: false,
          error: `Value too long (max: ${validation.maxLength}, actual: ${strValue.length})`,
        };
      }
    }

    // Check pattern matching
    if (validation.pattern) {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(String(value))) {
        return {
          isValid: false,
          error: `Value does not match pattern: ${validation.pattern}`,
        };
      }
    }

    // Check allowed values
    if (validation.allowedValues && validation.allowedValues.length > 0) {
      if (!validation.allowedValues.includes(value)) {
        return {
          isValid: false,
          error: `Value not in allowed list: ${validation.allowedValues.join(", ")}`,
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Generate unique record ID
   */
  private generateRecordId(
    recordIndex: number,
    sourceRecord: Record<string, any>,
  ): string {
    // Create a hash from record content for uniqueness
    const recordContent = JSON.stringify(sourceRecord);
    const hash = this.simpleHash(recordContent);
    return `record_${recordIndex}_${hash}`;
  }

  /**
   * Format date according to specified format
   */
  private formatDate(date: Date, format: string): string {
    // Use UTC to avoid timezone issues
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    return format
      .replace("YYYY", String(year))
      .replace("MM", month)
      .replace("DD", day);
  }

  /**
   * Simple hash function for generating record IDs
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get transformation engine statistics
   */
  getStatistics(): {
    totalTransformations: number;
    averageProcessingTime: number;
    errorRate: number;
  } {
    // This would be implemented with actual tracking in a real implementation
    return {
      totalTransformations: 0,
      averageProcessingTime: 0,
      errorRate: 0,
    };
  }
}

/**
 * Convenience function to create and use transformation engine
 */
export async function transformFileData(
  rawData: RawFileData,
  mappingData: ExcelMappingData,
  correlationId: string,
  config?: Partial<TransformationConfig>,
): Promise<TransformedData> {
  const engine = new TransformationEngine(config);
  return engine.transformData(rawData, mappingData, correlationId);
}

/**
 * Batch transform multiple files
 */
export async function transformMultipleFiles(
  rawDataFiles: RawFileData[],
  mappingData: ExcelMappingData,
  correlationId: string,
  config?: Partial<TransformationConfig>,
): Promise<TransformedData[]> {
  const engine = new TransformationEngine(config);
  const results: TransformedData[] = [];

  for (const rawData of rawDataFiles) {
    try {
      const transformed = await engine.transformData(
        rawData,
        mappingData,
        correlationId,
      );
      results.push(transformed);
    } catch (error) {
      // Log error but continue with other files if configured to do so
      console.error(
        `Failed to transform file ${rawData.source.filename}:`,
        error,
      );
      if (config?.continueOnError === false) {
        throw error;
      }
      // Continue with next file when continueOnError is true (default)
    }
  }

  return results;
}
