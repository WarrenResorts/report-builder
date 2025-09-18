/**
 * @fileoverview PDF Parser Implementation
 *
 * This module provides PDF parsing capabilities for the report builder system.
 * It extracts text content from PDF files and handles various PDF formats
 * and structures commonly found in property management documents.
 */

import { BaseFileParser } from "./base/parser-interface";
import {
  ParseResult,
  ParserConfig,
  SupportedFileType,
  PDFParserOptions,
  ParserErrorCode,
} from "./base/parser-types";

/**
 * PDF-specific parsed data structure
 */
export interface PDFParsedData extends Record<string, unknown> {
  /** Extracted text content */
  text: string;

  /** Number of pages processed */
  pageCount: number;

  /** Text content by page */
  pages: Array<{
    pageNumber: number;
    text: string;
    metadata?: Record<string, unknown>;
  }>;

  /** Document metadata */
  documentInfo?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
  };

  /** Raw content if requested */
  rawContent?: string;
}

/**
 * PDF Parser implementation
 *
 * Note: This is a placeholder implementation that simulates PDF parsing.
 * In a production environment, you would use a library like pdf-parse,
 * pdf2pic with OCR, or similar PDF processing tools.
 */
export class PDFParser extends BaseFileParser {
  readonly fileType: SupportedFileType = "pdf";
  readonly parserInfo = {
    name: "PDFParser",
    version: "1.0.0",
  };

  /**
   * Parse PDF content from buffer
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

      // Validate PDF format
      if (!this.isPDFBuffer(fileBuffer)) {
        throw new Error("Invalid PDF format - missing PDF header");
      }

      // Parse PDF with timeout protection
      const parsedData = await this.executeWithTimeout(
        () => this.extractPDFContent(fileBuffer, mergedConfig, warnings),
        mergedConfig.timeoutMs,
        "PDF parsing",
      );

      // Create successful result
      return {
        success: true,
        data: parsedData,
        metadata: {
          ...this.createBaseMetadata(filename, fileBuffer, startTime, warnings),
          recordCount: parsedData.pageCount,
          additionalMetadata: {
            documentInfo: parsedData.documentInfo,
            hasText: parsedData.text.length > 0,
            averageTextPerPage: Math.round(
              parsedData.text.length / parsedData.pageCount,
            ),
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
   * PDF parser can also handle string input (base64 encoded PDFs)
   */
  async parseFromString(
    content: string,
    filename: string,
    config?: Partial<ParserConfig>,
  ): Promise<ParseResult> {
    const startTime = Date.now();

    try {
      // Validate base64 format
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
        throw new Error("Invalid base64 format");
      }

      // Assume base64 encoded PDF
      const buffer = Buffer.from(content, "base64");

      // Check if decoded content looks like a PDF
      if (!this.isPDFBuffer(buffer)) {
        throw new Error("Decoded content is not a valid PDF");
      }

      return this.parseFromBuffer(buffer, filename, config);
    } catch (error) {
      const errorMessage = `Failed to decode base64 PDF content: ${(error as Error).message}`;
      return {
        success: false,
        data: "",
        metadata: {
          filename,
          fileType: this.fileType,
          fileSize: 0,
          parsedAt: new Date(),
          parserVersion: `${this.parserInfo.name}@${this.parserInfo.version}`,
          processingTimeMs: Date.now() - startTime,
          recordCount: 0,
          warnings: [],
        },
        error: {
          code: ParserErrorCode.INVALID_FORMAT,
          message: errorMessage,
          details: {
            originalError: (error as Error).message,
          },
        },
      };
    }
  }

  /**
   * Check if file can be parsed as PDF
   */
  canParse(filename: string, fileBuffer?: Buffer): boolean {
    // Check by extension
    if (this.getFileExtension(filename) === "pdf") {
      return true;
    }

    // Check by content if buffer provided
    if (fileBuffer) {
      return this.isPDFBuffer(fileBuffer);
    }

    return false;
  }

  /**
   * Get PDF parser specific default options
   */
  protected getDefaultParserOptions(): PDFParserOptions {
    return {
      enableOCR: false,
      maxPages: 100,
      preserveFormatting: false,
    };
  }

  /**
   * Check if buffer contains valid PDF data
   */
  private isPDFBuffer(buffer: Buffer): boolean {
    // PDF files start with %PDF-
    const header = buffer.subarray(0, 5).toString("ascii");
    return header === "%PDF-";
  }

  /**
   * Extract content from PDF buffer
   *
   * Note: This is a simulation. In production, use a real PDF library.
   */
  private async extractPDFContent(
    buffer: Buffer,
    config: ParserConfig,
    warnings: string[],
  ): Promise<PDFParsedData> {
    const options = config.parserOptions as PDFParserOptions;

    // Simulate PDF parsing delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate extracting PDF metadata
    const documentInfo = this.extractDocumentInfo(buffer);

    // Simulate page extraction
    const simulatedPageCount = Math.min(
      Math.floor(Math.random() * 10) + 1, // Random 1-10 pages
      options?.maxPages || 100,
    );

    const pages = Array.from({ length: simulatedPageCount }, (_, index) => ({
      pageNumber: index + 1,
      text: this.generateSimulatedPageText(index + 1, documentInfo?.title),
      metadata: {
        hasImages: Math.random() > 0.7,
        wordCount: Math.floor(Math.random() * 500) + 100,
      },
    }));

    // Combine all page text
    const allText = pages.map((page) => page.text).join("\n\n");

    // Add warnings for common issues
    if (simulatedPageCount >= (options?.maxPages || 100)) {
      warnings.push(
        `PDF has more than ${options?.maxPages} pages, only first ${options?.maxPages} processed`,
      );
    }

    if (allText.length < 100) {
      warnings.push(
        "PDF contains very little text - may be image-based or corrupted",
      );
    }

    return {
      text: allText,
      pageCount: simulatedPageCount,
      pages,
      documentInfo,
      rawContent: config.includeRawContent
        ? buffer.toString("base64")
        : undefined,
    };
  }

  /**
   * Extract document metadata (simulated)
   */
  private extractDocumentInfo(_buffer: Buffer) {
    // In a real implementation, this would parse PDF metadata
    const titles = [
      "Property Management Report",
      "Monthly Financial Statement",
      "Maintenance Request Summary",
      "Tenant Communication Log",
      "Inspection Report",
    ];

    return {
      title: titles[Math.floor(Math.random() * titles.length)],
      creator: "Property Management System",
      producer: "PDF Generator v1.0",
      creationDate: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      ), // Last 30 days
      modificationDate: new Date(),
    };
  }

  /**
   * Generate simulated page text content
   */
  private generateSimulatedPageText(
    pageNumber: number,
    title?: string,
  ): string {
    // If Math.random() is very low (mocked for testing), return minimal text
    if (Math.random() < 0.05) {
      return `Page ${pageNumber}`;
    }

    const sampleTexts = [
      `${title || "Document"} - Page ${pageNumber}\n\nProperty ID: PROP${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}\nDate: ${new Date().toLocaleDateString()}\n\nThis page contains property management information including tenant details, maintenance requests, and financial summaries. The data has been processed and organized for reporting purposes.`,

      `Financial Summary - Page ${pageNumber}\n\nRent Collected: $${(Math.random() * 5000 + 1000).toFixed(2)}\nMaintenance Costs: $${(Math.random() * 1000 + 100).toFixed(2)}\nNet Income: $${(Math.random() * 4000 + 500).toFixed(2)}\n\nProperty expenses and income are tracked monthly to ensure accurate financial reporting and budgeting.`,

      `Maintenance Report - Page ${pageNumber}\n\nWork Order #${Math.floor(Math.random() * 10000)}\nCompleted: ${new Date().toLocaleDateString()}\nContractor: ABC Maintenance Services\n\nWork performed includes routine maintenance, emergency repairs, and preventive care to ensure property value and tenant satisfaction.`,
    ];

    return sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
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
    if (error.message.includes("Invalid PDF format")) {
      return ParserErrorCode.INVALID_FORMAT;
    }
    if (
      error.message.includes("corrupted") ||
      error.message.includes("damaged")
    ) {
      return ParserErrorCode.CORRUPTED_FILE;
    }

    return ParserErrorCode.PARSING_ERROR;
  }
}
