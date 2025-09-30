import { describe, it, expect, vi } from "vitest";
import { PDFParser } from "./pdf-parser";

// Type for PDF parser data structure
interface PDFParserData {
  text?: string;
  pages?: Array<{
    pageNumber: number;
    text: string;
    metadata?: Record<string, unknown>;
  }>;
  pageCount?: number;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
  };
  rawContent?: string;
  extractionMethod?: string;
  documentInfo?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
  };
}

// Type for accessing private methods in tests
type PDFParserPrivate = PDFParser & {
  extractPDFContent: (buffer: Buffer, options: unknown) => Promise<unknown>;
};

describe("PDFParser", () => {
  let parser: PDFParser;

  beforeEach(() => {
    parser = new PDFParser();
  });

  describe("parser info", () => {
    it("should have correct parser info", () => {
      expect(parser.fileType).toBe("pdf");
      expect(parser.parserInfo.name).toBe("PDFParser");
      expect(parser.parserInfo.version).toBe("1.0.0");
    });
  });

  describe("canParse", () => {
    it("should return true for PDF files by extension", () => {
      expect(parser.canParse("document.pdf")).toBe(true);
      expect(parser.canParse("DOCUMENT.PDF")).toBe(true);
      expect(parser.canParse("report.PDF")).toBe(true);
    });

    it("should return false for non-PDF files by extension", () => {
      expect(parser.canParse("document.txt")).toBe(false);
      expect(parser.canParse("data.csv")).toBe(false);
      expect(parser.canParse("image.jpg")).toBe(false);
    });

    it("should detect PDF by content header", () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content here");
      expect(parser.canParse("unknown.file", pdfBuffer)).toBe(true);
    });

    it("should reject non-PDF content", () => {
      const textBuffer = Buffer.from("This is not a PDF file");
      expect(parser.canParse("unknown.file", textBuffer)).toBe(false);
    });

    it("should handle empty buffer", () => {
      const emptyBuffer = Buffer.from("");
      expect(parser.canParse("unknown.file", emptyBuffer)).toBe(false);
    });

    it("should handle buffer shorter than header", () => {
      const shortBuffer = Buffer.from("%PD");
      expect(parser.canParse("unknown.file", shortBuffer)).toBe(false);
    });
  });

  describe("parseFromBuffer", () => {
    it("should parse valid PDF successfully", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nSimulated PDF content");

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("text");
      expect(result.data).toHaveProperty("pageCount");
      expect(result.data).toHaveProperty("pages");
      expect(result.data).toHaveProperty("documentInfo");
      expect(result.metadata.fileType).toBe("pdf");
      expect(result.metadata.filename).toBe("test.pdf");
      expect(result.metadata.recordCount).toBeGreaterThan(0);
    });

    it("should include raw content when requested", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");
      const config = { includeRawContent: true };

      const result = await parser.parseFromBuffer(
        pdfBuffer,
        "test.pdf",
        config,
      );

      expect(result.success).toBe(true);
      expect((result.data as PDFParserData).rawContent).toBeDefined();
      expect((result.data as PDFParserData).rawContent).toBe(
        pdfBuffer.toString("base64"),
      );
    });

    it("should not include raw content by default", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      expect(result.success).toBe(true);
      expect((result.data as PDFParserData).rawContent).toBeUndefined();
    });

    it("should handle PDF with custom parser options", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");
      const config = {
        parserOptions: {
          maxPages: 5,
          enableOCR: true,
          preserveFormatting: true,
        },
      };

      const result = await parser.parseFromBuffer(
        pdfBuffer,
        "test.pdf",
        config,
      );

      expect(result.success).toBe(true);
      expect((result.data as PDFParserData).pageCount).toBeLessThanOrEqual(5);
    });

    it("should add warning for page limit reached", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nLarge PDF content");
      const config = { parserOptions: { maxPages: 1 } };

      // Mock random to ensure we get more than 1 page
      const originalRandom = Math.random;
      Math.random = vi.fn().mockReturnValue(0.9); // Will generate 10 pages

      const result = await parser.parseFromBuffer(
        pdfBuffer,
        "large.pdf",
        config,
      );

      Math.random = originalRandom;

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("more than")),
      ).toBe(true);
    });

    it("should add warning for low text content", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF");

      // Mock random to ensure minimal text
      const originalRandom = Math.random;
      Math.random = vi.fn().mockReturnValue(0.01); // Will generate minimal text

      const result = await parser.parseFromBuffer(pdfBuffer, "minimal.pdf");

      Math.random = originalRandom;

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("very little text")),
      ).toBe(true);
    });

    it("should return error for invalid PDF format", async () => {
      const invalidBuffer = Buffer.from("Not a PDF file");

      const result = await parser.parseFromBuffer(invalidBuffer, "invalid.pdf");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_FORMAT");
      expect(result.error?.message).toContain("Invalid PDF format");
    });

    it("should return error for file too large", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");
      const config = { maxFileSizeBytes: 10 }; // Very small limit

      const result = await parser.parseFromBuffer(
        pdfBuffer,
        "large.pdf",
        config,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FILE_TOO_LARGE");
    });

    it("should handle timeout errors", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");
      const config = { timeoutMs: 1 }; // Very short timeout

      const result = await parser.parseFromBuffer(
        pdfBuffer,
        "test.pdf",
        config,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TIMEOUT");
    });

    it("should handle corrupted file errors", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      // Mock the extraction to throw a corrupted file error
      const originalExtract = (parser as PDFParserPrivate).extractPDFContent;
      (parser as PDFParserPrivate).extractPDFContent = vi
        .fn()
        .mockRejectedValue(
          new Error("File is corrupted and cannot be processed"),
        );

      const result = await parser.parseFromBuffer(pdfBuffer, "corrupted.pdf");

      (parser as PDFParserPrivate).extractPDFContent = originalExtract;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CORRUPTED_FILE");
    });

    it("should generate document metadata", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      expect(result.success).toBe(true);
      const data = result.data as PDFParserData;
      expect(data.documentInfo).toBeDefined();
      expect(data.documentInfo.title).toBeDefined();
      expect(data.documentInfo.creator).toBeDefined();
      expect(data.documentInfo.creationDate).toBeInstanceOf(Date);
    });

    it("should include additional metadata", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      expect(result.success).toBe(true);
      expect(result.metadata.additionalMetadata).toBeDefined();
      expect(result.metadata.additionalMetadata).toHaveProperty("hasText");
      expect(result.metadata.additionalMetadata).toHaveProperty(
        "averageTextPerPage",
      );
    });
  });

  describe("parseFromString", () => {
    it("should parse base64 encoded PDF", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");
      const base64Content = pdfBuffer.toString("base64");

      const result = await parser.parseFromString(base64Content, "test.pdf");

      expect(result.success).toBe(true);
      expect(result.metadata.fileType).toBe("pdf");
    });

    it("should handle invalid base64 content", async () => {
      const invalidBase64 = "invalid base64 content!!!";

      const result = await parser.parseFromString(invalidBase64, "test.pdf");

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Failed to decode base64");
    });
  });

  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = parser.getDefaultConfig();

      expect(config.maxFileSizeBytes).toBe(50 * 1024 * 1024);
      expect(config.timeoutMs).toBe(30000);
      expect(config.includeRawContent).toBe(false);
      expect(config.parserOptions).toHaveProperty("enableOCR", false);
      expect(config.parserOptions).toHaveProperty("maxPages", 100);
      expect(config.parserOptions).toHaveProperty("preserveFormatting", false);
    });
  });

  describe("error code determination", () => {
    it("should determine timeout error code", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      // Mock extraction to throw timeout error
      const originalExtract = (parser as PDFParserPrivate).extractPDFContent;
      (parser as PDFParserPrivate).extractPDFContent = vi
        .fn()
        .mockRejectedValue(new Error("Operation timed out after 1000ms"));

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      (parser as PDFParserPrivate).extractPDFContent = originalExtract;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TIMEOUT");
    });

    it("should determine file size error code", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      // Mock extraction to throw size error
      const originalExtract = (parser as PDFParserPrivate).extractPDFContent;
      (parser as PDFParserPrivate).extractPDFContent = vi
        .fn()
        .mockRejectedValue(new Error("File size exceeds maximum allowed"));

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      (parser as PDFParserPrivate).extractPDFContent = originalExtract;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FILE_TOO_LARGE");
    });

    it("should determine damaged file error code", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      // Mock extraction to throw damaged error
      const originalExtract = (parser as PDFParserPrivate).extractPDFContent;
      (parser as PDFParserPrivate).extractPDFContent = vi
        .fn()
        .mockRejectedValue(new Error("File is damaged and cannot be read"));

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      (parser as PDFParserPrivate).extractPDFContent = originalExtract;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CORRUPTED_FILE");
    });

    it("should default to parsing error code", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      // Mock extraction to throw generic error
      const originalExtract = (parser as PDFParserPrivate).extractPDFContent;
      (parser as PDFParserPrivate).extractPDFContent = vi
        .fn()
        .mockRejectedValue(new Error("Generic parsing error"));

      const result = await parser.parseFromBuffer(pdfBuffer, "test.pdf");

      (parser as PDFParserPrivate).extractPDFContent = originalExtract;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PARSING_ERROR");
    });
  });

  describe("simulated content generation", () => {
    it("should generate varied page content", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nPDF content");

      // Test multiple times to get different content
      const results = await Promise.all([
        parser.parseFromBuffer(pdfBuffer, "test1.pdf"),
        parser.parseFromBuffer(pdfBuffer, "test2.pdf"),
        parser.parseFromBuffer(pdfBuffer, "test3.pdf"),
      ]);

      // All should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect((result.data as PDFParserData).pages.length).toBeGreaterThan(0);
      });
    });
  });

  describe("property name extraction", () => {
    it("should test extractPropertyName method indirectly", async () => {
      // Test the extractPropertyName method by calling it through the parser's private methods
      const parser = new PDFParser() as any;

      // Create test text that should extract a property name
      const testText = `Crown City Inn
Daily Report
Date: 2024-01-15
Revenue: $1,234.56

Crown City Inn
Page 2
More data here

Crown City Inn
Summary Page`;

      // Call the private extractPropertyName method
      const propertyName = parser.extractPropertyName(testText);

      expect(propertyName).toBe("Crown City Inn");
    });

    it("should test extractPropertyName with no match", async () => {
      const parser = new PDFParser() as any;

      // Create test text that should NOT extract a property name
      const testText = `Some Random Text
Daily Report
Date: 2024-01-15
No property name here`;

      const propertyName = parser.extractPropertyName(testText);

      expect(propertyName).toBeUndefined();
    });

    it("should extract property name from date-based header format", async () => {
      const parser = new PDFParser() as any;

      // Test the actual format from VisualMatrix PDFs
      const testText = `THE BARD'S INN HOTEL 07/15/2025 04:19 Mbald
Room Revenue Report
Some content here

THE BARD'S INN HOTEL 07/15/2025 04:19 Mbald
Page 2 content

THE BARD'S INN HOTEL 07/15/2025 04:19 Mbald
Final page`;

      const propertyName = parser.extractPropertyName(testText);

      expect(propertyName).toBe("THE BARD'S INN HOTEL");
    });
  });
});
