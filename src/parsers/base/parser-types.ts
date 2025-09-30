/**
 * @fileoverview Parser Type Definitions
 * 
 * This module defines the core types and interfaces used by all file parsers
 * in the report builder system. It provides a standardized data structure
 * for parsed file content and parser configuration.
 */

/**
 * Supported file types for parsing
 */
export type SupportedFileType = 'pdf' | 'csv' | 'txt' | 'excel-mapping' | 'xlsx';

/**
 * Raw parsed data from a file - can be text, structured data, or mixed
 */
export type ParsedData = 
  | string                           // Plain text content
  | Record<string, unknown>[]        // Array of objects (like CSV rows)
  | Record<string, unknown>          // Single object with structured data
  | unknown[];                       // Generic array of data

/**
 * Metadata about the parsing operation
 */
export interface ParseMetadata {
  /** Original filename */
  filename: string;
  
  /** File extension */
  fileType: SupportedFileType;
  
  /** File size in bytes */
  fileSize: number;
  
  /** When the file was parsed */
  parsedAt: Date;
  
  /** Parser version/configuration used */
  parserVersion: string;
  
  /** Processing time in milliseconds */
  processingTimeMs: number;
  
  /** Number of pages/rows/records found */
  recordCount: number;
  
  /** Any warnings encountered during parsing */
  warnings: string[];
  
  /** Additional parser-specific metadata */
  additionalMetadata?: Record<string, unknown>;
}

/**
 * Result of a file parsing operation
 */
export interface ParseResult {
  /** Whether parsing was successful */
  success: boolean;
  
  /** The parsed data content */
  data: ParsedData;
  
  /** Metadata about the parsing operation */
  metadata: ParseMetadata;
  
  /** Error details if parsing failed */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Configuration options for parsers
 */
export interface ParserConfig {
  /** Maximum file size to process (in bytes) */
  maxFileSizeBytes: number;
  
  /** Timeout for parsing operations (in milliseconds) */
  timeoutMs: number;
  
  /** Whether to include raw content in result */
  includeRawContent: boolean;
  
  /** Parser-specific options */
  parserOptions?: Record<string, unknown>;
}

/**
 * Default parser configuration
 */
export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
  timeoutMs: 30000, // 30 seconds
  includeRawContent: false,
  parserOptions: {},
};

/**
 * Parser-specific configuration options
 */
export interface PDFParserOptions extends Record<string, unknown> {
  /** Extract text from images using OCR */
  enableOCR?: boolean;
  
  /** Maximum pages to process */
  maxPages?: number;
  
  /** Whether to preserve formatting */
  preserveFormatting?: boolean;
}

export interface CSVParserOptions extends Record<string, unknown> {
  /** CSV delimiter character */
  delimiter?: string;
  
  /** Quote character */
  quote?: string;
  
  /** Escape character */
  escape?: string;
  
  /** Whether first row contains headers */
  hasHeaders?: boolean;
  
  /** Skip empty lines */
  skipEmptyLines?: boolean;
  
  /** Auto-detect delimiter */
  autoDetectDelimiter?: boolean;
}

export interface TXTParserOptions extends Record<string, unknown> {
  /** Text encoding */
  encoding?: string;
  
  /** Line ending style */
  lineEnding?: 'auto' | 'crlf' | 'lf' | 'cr';
  
  /** Whether to detect structured data patterns */
  detectStructure?: boolean;
  
  /** Maximum lines to process */
  maxLines?: number;
}

export interface ExcelMappingParserOptions extends Record<string, unknown> {
  /** Sheet containing property mappings */
  mappingSheetName?: string;
  
  /** Sheet containing global configuration */
  configSheetName?: string;
  
  /** Sheet containing metadata */
  metadataSheetName?: string;
  
  /** Whether to validate all rules */
  validateRules?: boolean;
  
  /** Whether to allow missing sheets */
  allowMissingSheets?: boolean;
  
  /** Custom sheet names mapping */
  customSheetNames?: {
    mappings?: string;
    config?: string;
    metadata?: string;
  };
}

/**
 * Error codes for parser failures
 */
export enum ParserErrorCode {
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  TIMEOUT = 'TIMEOUT',
  INVALID_FORMAT = 'INVALID_FORMAT',
  CORRUPTED_FILE = 'CORRUPTED_FILE',
  UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',
  PARSING_ERROR = 'PARSING_ERROR',
  IO_ERROR = 'IO_ERROR',
}
