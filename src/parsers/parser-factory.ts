/**
 * @fileoverview Parser Factory Implementation
 * 
 * This module provides a factory for creating appropriate file parsers based on
 * file type detection. It serves as the main entry point for the parsing system
 * and handles parser selection and instantiation.
 */

import { IFileParser } from './base/parser-interface';
import { SupportedFileType, ParseResult, ParserConfig } from './base/parser-types';
import { PDFParser } from './pdf-parser';
import { CSVParser } from './csv-parser';
import { TXTParser } from './txt-parser';
import { ExcelMappingParser } from './excel-mapping-parser';

/**
 * Parser factory for creating appropriate parsers based on file type
 */
export class ParserFactory {
  private static readonly parsers = new Map<SupportedFileType, () => IFileParser>([
    ['pdf', () => new PDFParser()],
    ['csv', () => new CSVParser()],
    ['txt', () => new TXTParser()],
    ['excel-mapping', () => new ExcelMappingParser()],
  ]);
  
  /**
   * Get all supported file types
   */
  static getSupportedFileTypes(): SupportedFileType[] {
    return Array.from(this.parsers.keys());
  }
  
  /**
   * Create a parser for the specified file type
   * 
   * @param fileType - The file type to create a parser for
   * @returns Parser instance for the specified type
   * @throws Error if file type is not supported
   */
  static createParser(fileType: SupportedFileType): IFileParser {
    const parserFactory = this.parsers.get(fileType);
    
    if (!parserFactory) {
      throw new Error(`Unsupported file type: ${fileType}. Supported types: ${this.getSupportedFileTypes().join(', ')}`);
    }
    
    return parserFactory();
  }
  
  /**
   * Detect file type and create appropriate parser
   * 
   * @param filename - The filename to analyze
   * @param fileBuffer - Optional file buffer for content-based detection
   * @returns Parser instance for the detected file type
   * @throws Error if no suitable parser is found
   */
  static createParserForFile(filename: string, fileBuffer?: Buffer): IFileParser {
    // Try each parser to see if it can handle the file
    for (const [, parserFactory] of this.parsers.entries()) {
      const parser = parserFactory();
      
      if (parser.canParse(filename, fileBuffer)) {
        return parser;
      }
    }
    
    // If no parser can handle it, try to infer from extension
    const extension = this.getFileExtension(filename);
    const inferredType = this.inferFileTypeFromExtension(extension);
    
    if (inferredType) {
      return this.createParser(inferredType);
    }
    
    throw new Error(
      `No suitable parser found for file: ${filename}. ` +
      `Supported file types: ${this.getSupportedFileTypes().join(', ')}`
    );
  }
  
  /**
   * Parse a file using the most appropriate parser
   * 
   * @param fileBuffer - The file content as a buffer
   * @param filename - The original filename
   * @param config - Optional parser configuration
   * @returns Promise resolving to parse result
   */
  static async parseFile(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>
  ): Promise<ParseResult> {
    try {
      const parser = this.createParserForFile(filename, fileBuffer);
      return await parser.parseFromBuffer(fileBuffer, filename, config);
    } catch (error) {
      // Return error result if parser creation fails
      return {
        success: false,
        data: '',
        metadata: {
          filename,
          fileType: 'txt', // Default fallback
          fileSize: fileBuffer.length,
          parsedAt: new Date(),
          parserVersion: 'ParserFactory@1.0.0',
          processingTimeMs: 0,
          recordCount: 0,
          warnings: [],
        },
        error: {
          code: 'PARSER_SELECTION_ERROR',
          message: (error as Error).message,
          details: {
            availableParsers: this.getSupportedFileTypes(),
          },
        },
      };
    }
  }
  
  /**
   * Parse a file from string content
   * 
   * @param content - The file content as a string
   * @param filename - The original filename
   * @param config - Optional parser configuration
   * @returns Promise resolving to parse result
   */
  static async parseFromString(
    content: string,
    filename: string,
    config?: Partial<ParserConfig>
  ): Promise<ParseResult> {
    const buffer = Buffer.from(content, 'utf8');
    return this.parseFile(buffer, filename, config);
  }
  
  /**
   * Check if a file type is supported
   * 
   * @param fileType - The file type to check
   * @returns true if the file type is supported
   */
  static isFileTypeSupported(fileType: string): fileType is SupportedFileType {
    return this.parsers.has(fileType as SupportedFileType);
  }
  
  /**
   * Check if a file can be parsed based on filename
   * 
   * @param filename - The filename to check
   * @param fileBuffer - Optional file buffer for content-based detection
   * @returns true if the file can be parsed
   */
  static canParseFile(filename: string, fileBuffer?: Buffer): boolean {
    try {
      this.createParserForFile(filename, fileBuffer);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Get parser information for a file
   * 
   * @param filename - The filename to analyze
   * @param fileBuffer - Optional file buffer for content-based detection
   * @returns Parser information or null if no suitable parser found
   */
  static getParserInfo(filename: string, fileBuffer?: Buffer): { 
    fileType: SupportedFileType; 
    parserName: string; 
    parserVersion: string; 
  } | null {
    try {
      const parser = this.createParserForFile(filename, fileBuffer);
      return {
        fileType: parser.fileType,
        parserName: parser.parserInfo.name,
        parserVersion: parser.parserInfo.version,
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Register a new parser type
   * 
   * @param fileType - The file type to register
   * @param parserFactory - Factory function to create the parser
   */
  static registerParser(
    fileType: SupportedFileType,
    parserFactory: () => IFileParser
  ): void {
    this.parsers.set(fileType, parserFactory);
  }
  
  /**
   * Unregister a parser type
   * 
   * @param fileType - The file type to unregister
   */
  static unregisterParser(fileType: SupportedFileType): void {
    this.parsers.delete(fileType);
  }
  
  /**
   * Get default configuration for a specific file type
   * 
   * @param fileType - The file type to get configuration for
   * @returns Default parser configuration
   */
  static getDefaultConfig(fileType: SupportedFileType): ParserConfig {
    const parser = this.createParser(fileType);
    return parser.getDefaultConfig();
  }
  
  /**
   * Extract file extension from filename
   */
  private static getFileExtension(filename: string): string {
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }
  
  /**
   * Infer file type from extension
   */
  private static inferFileTypeFromExtension(extension: string): SupportedFileType | null {
    const extensionMap: Record<string, SupportedFileType> = {
      // PDF extensions
      'pdf': 'pdf',
      
      // CSV extensions
      'csv': 'csv',
      'tsv': 'csv',
      
      // Text extensions
      'txt': 'txt',
      'text': 'txt',
      'log': 'txt',
      'dat': 'txt',
      'asc': 'txt',
    };
    
    return extensionMap[extension] || null;
  }
}

/**
 * Convenience function to parse a file
 * 
 * @param fileBuffer - The file content as a buffer
 * @param filename - The original filename
 * @param config - Optional parser configuration
 * @returns Promise resolving to parse result
 */
export async function parseFile(
  fileBuffer: Buffer,
  filename: string,
  config?: Partial<ParserConfig>
): Promise<ParseResult> {
  return ParserFactory.parseFile(fileBuffer, filename, config);
}

/**
 * Convenience function to parse a file from string
 * 
 * @param content - The file content as a string
 * @param filename - The original filename
 * @param config - Optional parser configuration
 * @returns Promise resolving to parse result
 */
export async function parseFromString(
  content: string,
  filename: string,
  config?: Partial<ParserConfig>
): Promise<ParseResult> {
  return ParserFactory.parseFromString(content, filename, config);
}

/**
 * Convenience function to check if a file can be parsed
 * 
 * @param filename - The filename to check
 * @param fileBuffer - Optional file buffer for content-based detection
 * @returns true if the file can be parsed
 */
export function canParseFile(filename: string, fileBuffer?: Buffer): boolean {
  return ParserFactory.canParseFile(filename, fileBuffer);
}

/**
 * Get all supported file types
 * 
 * @returns Array of supported file types
 */
export function getSupportedFileTypes(): SupportedFileType[] {
  return ParserFactory.getSupportedFileTypes();
}
