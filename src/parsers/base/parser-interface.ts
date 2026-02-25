/**
 * @fileoverview Base Parser Interface
 * 
 * This module defines the core interface that all file parsers must implement.
 * It provides a consistent API for parsing different file types and handling
 * errors in a standardized way.
 */

import { ParseResult, ParserConfig, SupportedFileType } from './parser-types';

/**
 * Base interface that all file parsers must implement
 */
export interface IFileParser {
  /**
   * The file type this parser handles
   */
  readonly fileType: SupportedFileType;
  
  /**
   * Parser name and version for identification
   */
  readonly parserInfo: {
    name: string;
    version: string;
  };
  
  /**
   * Parse file content from a buffer
   * 
   * @param fileBuffer - The raw file content as a Buffer
   * @param filename - Original filename for metadata
   * @param config - Parser configuration options
   * @returns Promise resolving to parse result
   */
  parseFromBuffer(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>
  ): Promise<ParseResult>;
  
  /**
   * Parse file content from a string (for text-based files)
   * 
   * @param content - The file content as a string
   * @param filename - Original filename for metadata
   * @param config - Parser configuration options
   * @returns Promise resolving to parse result
   */
  parseFromString?(
    content: string,
    filename: string,
    config?: Partial<ParserConfig>
  ): Promise<ParseResult>;
  
  /**
   * Validate if this parser can handle the given file
   * 
   * @param filename - The filename to check
   * @param fileBuffer - Optional file buffer for content-based detection
   * @returns true if this parser can handle the file
   */
  canParse(filename: string, _fileBuffer?: Buffer): boolean;
  
  /**
   * Get default configuration for this parser
   * 
   * @returns Default parser configuration
   */
  getDefaultConfig(): ParserConfig;
}

/**
 * Abstract base class providing common parser functionality
 */
export abstract class BaseFileParser implements IFileParser {
  abstract readonly fileType: SupportedFileType;
  abstract readonly parserInfo: { name: string; version: string };
  
  /**
   * Parse file content from a buffer
   */
  abstract parseFromBuffer(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>
  ): Promise<ParseResult>;
  
  /**
   * Default implementation of canParse based on file extension
   */
  canParse(filename: string, _fileBuffer?: Buffer): boolean {
    const extension = this.getFileExtension(filename);
    return extension === this.fileType;
  }
  
  /**
   * Get default configuration merged with parser-specific defaults
   */
  getDefaultConfig(): ParserConfig {
    return {
      maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
      timeoutMs: 30000, // 30 seconds
      includeRawContent: false,
      parserOptions: this.getDefaultParserOptions(),
    };
  }
  
  /**
   * Get parser-specific default options
   * Override in subclasses to provide parser-specific defaults
   */
  protected getDefaultParserOptions(): Record<string, unknown> {
    return {};
  }
  
  /**
   * Extract file extension from filename
   */
  protected getFileExtension(filename: string): string {
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }
  
  /**
   * Validate file size against configuration limits
   */
  protected validateFileSize(fileBuffer: Buffer, config: ParserConfig): void {
    if (fileBuffer.length > config.maxFileSizeBytes) {
      throw new Error(
        `File size ${fileBuffer.length} bytes exceeds maximum allowed size of ${config.maxFileSizeBytes} bytes`
      );
    }
  }
  
  /**
   * Create base metadata for parse results
   */
  protected createBaseMetadata(
    filename: string,
    fileBuffer: Buffer,
    startTime: number,
    warnings: string[] = []
  ) {
    return {
      filename,
      fileType: this.fileType,
      fileSize: fileBuffer.length,
      parsedAt: new Date(),
      parserVersion: `${this.parserInfo.name}@${this.parserInfo.version}`,
      processingTimeMs: Date.now() - startTime,
      recordCount: 0, // Will be set by specific parsers
      warnings,
    };
  }
  
  /**
   * Create an error result for failed parsing
   */
  protected createErrorResult(
    filename: string,
    fileBuffer: Buffer,
    startTime: number,
    error: Error,
    errorCode: string
  ): ParseResult {
    return {
      success: false,
      data: '',
      metadata: {
        ...this.createBaseMetadata(filename, fileBuffer, startTime),
        recordCount: 0,
      },
      error: {
        code: errorCode,
        message: error.message,
        details: {
          stack: error.stack,
          name: error.name,
        },
      },
    };
  }
  
  /**
   * Execute parsing with timeout protection
   */
  protected async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      operation()
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
}

