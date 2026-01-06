import { describe, it, expect } from 'vitest';
import { BaseFileParser } from './parser-interface';
import { ParseResult, ParserConfig, SupportedFileType } from './parser-types';

// Create a concrete implementation of BaseFileParser for testing
class TestParser extends BaseFileParser {
  readonly fileType: SupportedFileType = 'txt';
  readonly parserInfo = {
    name: 'TestParser',
    version: '1.0.0',
  };

  async parseFromBuffer(
    fileBuffer: Buffer,
    filename: string,
    config?: Partial<ParserConfig>
  ): Promise<ParseResult> {
    const startTime = Date.now();
    const mergedConfig = { ...this.getDefaultConfig(), ...config };

    try {
      this.validateFileSize(fileBuffer, mergedConfig);

      if (filename === 'error.txt') {
        throw new Error('Simulated parsing error');
      }

      if (filename === 'timeout.txt') {
        throw new Error('Operation timed out after 1000ms');
      }

      const data = `Parsed content from ${filename}`;
      
      return {
        success: true,
        data,
        metadata: {
          ...this.createBaseMetadata(filename, fileBuffer, startTime),
          recordCount: 1,
        },
      };
    } catch (error) {
      return this.createErrorResult(
        filename,
        fileBuffer,
        startTime,
        error as Error,
        'PARSING_ERROR'
      );
    }
  }

  // Expose protected methods for testing
  public testGetFileExtension(filename: string): string {
    return this.getFileExtension(filename);
  }

  public testValidateFileSize(fileBuffer: Buffer, config: ParserConfig): void {
    return this.validateFileSize(fileBuffer, config);
  }

  public testCreateBaseMetadata(filename: string, fileBuffer: Buffer, startTime: number, warnings?: string[]) {
    return this.createBaseMetadata(filename, fileBuffer, startTime, warnings);
  }

  public testCreateErrorResult(
    filename: string,
    fileBuffer: Buffer,
    startTime: number,
    error: Error,
    errorCode: string
  ) {
    return this.createErrorResult(filename, fileBuffer, startTime, error, errorCode);
  }

  public testExecuteWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return this.executeWithTimeout(operation, timeoutMs, operationName);
  }
}

describe('BaseFileParser', () => {
  let parser: TestParser;

  beforeEach(() => {
    parser = new TestParser();
  });

  describe('basic functionality', () => {
    it('should have correct parser info', () => {
      expect(parser.fileType).toBe('txt');
      expect(parser.parserInfo.name).toBe('TestParser');
      expect(parser.parserInfo.version).toBe('1.0.0');
    });

    it('should parse files successfully', async () => {
      const buffer = Buffer.from('test content');
      const result = await parser.parseFromBuffer(buffer, 'test.txt');

      expect(result.success).toBe(true);
      expect(result.data).toContain('Parsed content from test.txt');
      expect(result.metadata.filename).toBe('test.txt');
      expect(result.metadata.fileType).toBe('txt');
    });
  });

  describe('canParse', () => {
    it('should return true for matching file extensions', () => {
      expect(parser.canParse('document.txt')).toBe(true);
      expect(parser.canParse('DOCUMENT.TXT')).toBe(true);
    });

    it('should return false for non-matching file extensions', () => {
      expect(parser.canParse('document.pdf')).toBe(false);
      expect(parser.canParse('data.csv')).toBe(false);
    });

    it('should handle files without extensions', () => {
      expect(parser.canParse('README')).toBe(false);
      expect(parser.canParse('file.')).toBe(false);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return default configuration', () => {
      const config = parser.getDefaultConfig();

      expect(config.maxFileSizeBytes).toBe(50 * 1024 * 1024);
      expect(config.timeoutMs).toBe(30000);
      expect(config.includeRawContent).toBe(false);
      expect(config.parserOptions).toEqual({});
    });
  });

  describe('protected utility methods', () => {
    it('should extract file extensions correctly', () => {
      expect(parser.testGetFileExtension('document.txt')).toBe('txt');
      expect(parser.testGetFileExtension('DOCUMENT.TXT')).toBe('txt');
      expect(parser.testGetFileExtension('file.with.multiple.dots.pdf')).toBe('pdf');
      expect(parser.testGetFileExtension('README')).toBe('');
      expect(parser.testGetFileExtension('file.')).toBe('');
    });

    it('should validate file size correctly', () => {
      const smallBuffer = Buffer.from('small content');
      const config = { maxFileSizeBytes: 1000 } as ParserConfig;

      expect(() => {
        parser.testValidateFileSize(smallBuffer, config);
      }).not.toThrow();
    });

    it('should throw error for files exceeding size limit', () => {
      const largeBuffer = Buffer.alloc(2000);
      const config = { maxFileSizeBytes: 1000 } as ParserConfig;

      expect(() => {
        parser.testValidateFileSize(largeBuffer, config);
      }).toThrow('File size 2000 bytes exceeds maximum allowed size of 1000 bytes');
    });

    it('should create base metadata correctly', () => {
      const buffer = Buffer.from('test content');
      const startTime = Date.now();
      
      const metadata = parser.testCreateBaseMetadata('test.txt', buffer, startTime);

      expect(metadata.filename).toBe('test.txt');
      expect(metadata.fileType).toBe('txt');
      expect(metadata.fileSize).toBe(buffer.length);
      expect(metadata.parsedAt).toBeInstanceOf(Date);
      expect(metadata.parserVersion).toBe('TestParser@1.0.0');
      expect(metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(metadata.warnings).toEqual([]);
    });

    it('should create base metadata with warnings', () => {
      const buffer = Buffer.from('test content');
      const startTime = Date.now();
      const warnings = ['Warning 1', 'Warning 2'];
      
      const metadata = parser.testCreateBaseMetadata('test.txt', buffer, startTime, warnings);

      expect(metadata.warnings).toEqual(warnings);
    });

    it('should create error result correctly', () => {
      const buffer = Buffer.from('test content');
      const startTime = Date.now();
      const error = new Error('Test error');
      
      const result = parser.testCreateErrorResult('test.txt', buffer, startTime, error, 'TEST_ERROR');

      expect(result.success).toBe(false);
      expect(result.data).toBe('');
      expect(result.metadata.recordCount).toBe(0);
      expect(result.error?.code).toBe('TEST_ERROR');
      expect(result.error?.message).toBe('Test error');
      expect(result.error?.details?.stack).toBeDefined();
    });
  });

  describe('executeWithTimeout', () => {
    it('should execute operation successfully within timeout', async () => {
      const operation = () => Promise.resolve('success');
      
      const result = await parser.testExecuteWithTimeout(operation, 1000, 'test-operation');

      expect(result).toBe('success');
    });

    it('should timeout when operation takes too long', async () => {
      const operation = () => new Promise(resolve => setTimeout(() => resolve('late'), 200));
      
      await expect(
        parser.testExecuteWithTimeout(operation, 100, 'slow-operation')
      ).rejects.toThrow('slow-operation timed out after 100ms');
    });

    it('should handle operation errors', async () => {
      const operation = () => Promise.reject(new Error('Operation failed'));
      
      await expect(
        parser.testExecuteWithTimeout(operation, 1000, 'failing-operation')
      ).rejects.toThrow('Operation failed');
    });

    it('should clear timeout when operation completes successfully', async () => {
      const operation = () => Promise.resolve('success');
      
      // This should not hang or cause issues
      const result = await parser.testExecuteWithTimeout(operation, 1000, 'quick-operation');
      expect(result).toBe('success');
    });

    it('should clear timeout when operation fails', async () => {
      const operation = () => Promise.reject(new Error('Failed'));
      
      await expect(
        parser.testExecuteWithTimeout(operation, 1000, 'failing-operation')
      ).rejects.toThrow('Failed');
    });
  });

  describe('error handling in parseFromBuffer', () => {
    it('should handle parsing errors', async () => {
      const buffer = Buffer.from('test content');
      
      const result = await parser.parseFromBuffer(buffer, 'error.txt');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PARSING_ERROR');
      expect(result.error?.message).toBe('Simulated parsing error');
    });

    it('should handle file size errors', async () => {
      const buffer = Buffer.alloc(2000);
      const config = { maxFileSizeBytes: 1000 };
      
      const result = await parser.parseFromBuffer(buffer, 'large.txt', config);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PARSING_ERROR');
      expect(result.error?.message).toContain('exceeds maximum allowed size');
    });

    it('should include error details in result', async () => {
      const buffer = Buffer.from('test content');
      
      const result = await parser.parseFromBuffer(buffer, 'error.txt');

      expect(result.success).toBe(false);
      expect(result.error?.details?.stack).toBeDefined();
      expect(result.error?.details?.name).toBe('Error');
    });
  });

  describe('configuration merging', () => {
    it('should merge partial config with defaults', async () => {
      const buffer = Buffer.from('test content');
      const partialConfig = { timeoutMs: 5000 };
      
      const result = await parser.parseFromBuffer(buffer, 'test.txt', partialConfig);

      expect(result.success).toBe(true);
      // The merged config should be used internally
    });

    it('should use default config when none provided', async () => {
      const buffer = Buffer.from('test content');
      
      const result = await parser.parseFromBuffer(buffer, 'test.txt');

      expect(result.success).toBe(true);
    });
  });

  describe('metadata generation', () => {
    it('should include processing time in metadata', async () => {
      const buffer = Buffer.from('test content');
      
      const result = await parser.parseFromBuffer(buffer, 'test.txt');

      expect(result.success).toBe(true);
      expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should include correct file information', async () => {
      const buffer = Buffer.from('test content with more text');
      
      const result = await parser.parseFromBuffer(buffer, 'document.txt');

      expect(result.success).toBe(true);
      expect(result.metadata.filename).toBe('document.txt');
      expect(result.metadata.fileSize).toBe(buffer.length);
      expect(result.metadata.fileType).toBe('txt');
      expect(result.metadata.parserVersion).toContain('TestParser@1.0.0');
    });
  });
});
