/**
 * @fileoverview Parser Module Exports
 *
 * This module provides a centralized export point for all parser-related
 * functionality in the report builder system.
 */

// Base interfaces and types
export * from "./base/parser-interface";
export * from "./base/parser-types";

// Individual parsers
export { PDFParser } from "./pdf-parser";
export { CSVParser } from "./csv-parser";
export { TXTParser } from "./txt-parser";
export { ExcelMappingParser } from "./excel-mapping-parser";

// Parser factory and utilities
export {
  ParserFactory,
  parseFile,
  parseFromString,
  canParseFile,
  getSupportedFileTypes,
} from "./parser-factory";

// Re-export commonly used types for convenience
export type {
  ParseResult,
  ParsedData,
  ParseMetadata,
  ParserConfig,
  SupportedFileType,
  PDFParserOptions,
  CSVParserOptions,
  TXTParserOptions,
  ExcelMappingParserOptions,
} from "./base/parser-types";

export type { IFileParser } from "./base/parser-interface";
