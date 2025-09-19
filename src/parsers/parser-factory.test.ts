import { describe, it, expect } from "vitest";
import {
  ParserFactory,
  parseFile,
  parseFromString,
  canParseFile,
  getSupportedFileTypes,
} from "./parser-factory";
import { PDFParser } from "./pdf-parser";
import { CSVParser } from "./csv-parser";
import { TXTParser } from "./txt-parser";
import type { SupportedFileType } from "./base/parser-types";

// Type for testing unsupported file types
type TestFileType = SupportedFileType | "unsupported" | "custom" | "temp";

describe("ParserFactory", () => {
  describe("getSupportedFileTypes", () => {
    it("should return all supported file types", () => {
      const types = ParserFactory.getSupportedFileTypes();
      expect(types).toEqual(["pdf", "csv", "txt", "excel-mapping"]);
    });
  });

  describe("createParser", () => {
    it("should create PDF parser for pdf type", () => {
      const parser = ParserFactory.createParser("pdf");
      expect(parser).toBeInstanceOf(PDFParser);
      expect(parser.fileType).toBe("pdf");
    });

    it("should create CSV parser for csv type", () => {
      const parser = ParserFactory.createParser("csv");
      expect(parser).toBeInstanceOf(CSVParser);
      expect(parser.fileType).toBe("csv");
    });

    it("should create TXT parser for txt type", () => {
      const parser = ParserFactory.createParser("txt");
      expect(parser).toBeInstanceOf(TXTParser);
      expect(parser.fileType).toBe("txt");
    });

    it("should create Excel mapping parser for excel-mapping type", () => {
      const parser = ParserFactory.createParser("excel-mapping");
      expect(parser.fileType).toBe("excel-mapping");
    });

    it("should throw error for unsupported file type", () => {
      expect(() => {
        ParserFactory.createParser("unsupported" as TestFileType);
      }).toThrow("Unsupported file type: unsupported");
    });
  });

  describe("createParserForFile", () => {
    it("should create PDF parser for .pdf files", () => {
      const parser = ParserFactory.createParserForFile("document.pdf");
      expect(parser).toBeInstanceOf(PDFParser);
    });

    it("should create CSV parser for .csv files", () => {
      const parser = ParserFactory.createParserForFile("data.csv");
      expect(parser).toBeInstanceOf(CSVParser);
    });

    it("should create CSV parser for .tsv files", () => {
      const parser = ParserFactory.createParserForFile("data.tsv");
      expect(parser).toBeInstanceOf(CSVParser);
    });

    it("should create TXT parser for .txt files", () => {
      const parser = ParserFactory.createParserForFile("document.txt");
      expect(parser).toBeInstanceOf(TXTParser);
    });

    it("should create TXT parser for .log files", () => {
      const parser = ParserFactory.createParserForFile("application.log");
      expect(parser).toBeInstanceOf(TXTParser);
    });

    it("should create parser based on content when provided", () => {
      const pdfBuffer = Buffer.from("%PDF-1.4 content");
      const parser = ParserFactory.createParserForFile(
        "unknown.file",
        pdfBuffer,
      );
      expect(parser).toBeInstanceOf(PDFParser);
    });

    it("should throw error for unsupported files", () => {
      expect(() => {
        ParserFactory.createParserForFile("document.unknown");
      }).toThrow("No suitable parser found for file: document.unknown");
    });
  });

  describe("parseFile", () => {
    it("should parse PDF file successfully", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4\nSimulated PDF content");
      const result = await ParserFactory.parseFile(pdfBuffer, "test.pdf");

      expect(result.success).toBe(true);
      expect(result.metadata.fileType).toBe("pdf");
      expect(result.metadata.filename).toBe("test.pdf");
    });

    it("should parse CSV file successfully", async () => {
      const csvBuffer = Buffer.from("name,age,city\nJohn,30,NYC\nJane,25,LA");
      const result = await ParserFactory.parseFile(csvBuffer, "test.csv");

      expect(result.success).toBe(true);
      expect(result.metadata.fileType).toBe("csv");
      expect(result.metadata.recordCount).toBeGreaterThan(0);
    });

    it("should return error result for unsupported files", async () => {
      // Use binary content that doesn't look like text
      const buffer = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]);
      const result = await ParserFactory.parseFile(buffer, "unknown.xyz");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PARSER_SELECTION_ERROR");
    });
  });

  describe("canParseFile", () => {
    it("should return true for supported file extensions", () => {
      expect(ParserFactory.canParseFile("document.pdf")).toBe(true);
      expect(ParserFactory.canParseFile("data.csv")).toBe(true);
      expect(ParserFactory.canParseFile("notes.txt")).toBe(true);
    });

    it("should return false for unsupported file extensions", () => {
      expect(ParserFactory.canParseFile("image.jpg")).toBe(false);
      expect(ParserFactory.canParseFile("document.docx")).toBe(false);
    });

    it("should return true when content matches supported format", () => {
      const pdfBuffer = Buffer.from("%PDF-1.4");
      expect(ParserFactory.canParseFile("unknown.file", pdfBuffer)).toBe(true);
    });
  });

  describe("getParserInfo", () => {
    it("should return parser info for supported files", () => {
      const info = ParserFactory.getParserInfo("document.pdf");
      expect(info).toEqual({
        fileType: "pdf",
        parserName: "PDFParser",
        parserVersion: "1.0.0",
      });
    });

    it("should return null for unsupported files", () => {
      const info = ParserFactory.getParserInfo("image.jpg");
      expect(info).toBeNull();
    });
  });

  describe("isFileTypeSupported", () => {
    it("should return true for supported file types", () => {
      expect(ParserFactory.isFileTypeSupported("pdf")).toBe(true);
      expect(ParserFactory.isFileTypeSupported("csv")).toBe(true);
      expect(ParserFactory.isFileTypeSupported("txt")).toBe(true);
      expect(ParserFactory.isFileTypeSupported("excel-mapping")).toBe(true);
    });

    it("should return false for unsupported file types", () => {
      expect(ParserFactory.isFileTypeSupported("jpg")).toBe(false);
      expect(ParserFactory.isFileTypeSupported("docx")).toBe(false);
      expect(ParserFactory.isFileTypeSupported("unknown")).toBe(false);
    });
  });

  describe("registerParser and unregisterParser", () => {
    it("should register a new parser type", () => {
      const mockParser = () => new TXTParser();
      
      // Register a custom type
      ParserFactory.registerParser("custom" as TestFileType, mockParser);
      
      // Should now be supported
      expect(ParserFactory.isFileTypeSupported("custom")).toBe(true);
      
      // Should be able to create parser
      const parser = ParserFactory.createParser("custom" as TestFileType);
      expect(parser).toBeInstanceOf(TXTParser);
      
      // Clean up
      ParserFactory.unregisterParser("custom" as TestFileType);
    });

    it("should unregister a parser type", () => {
      const mockParser = () => new TXTParser();
      
      // Register then unregister
      ParserFactory.registerParser("temp" as TestFileType, mockParser);
      expect(ParserFactory.isFileTypeSupported("temp")).toBe(true);
      
      ParserFactory.unregisterParser("temp" as TestFileType);
      expect(ParserFactory.isFileTypeSupported("temp")).toBe(false);
    });
  });

  describe("getDefaultConfig", () => {
    it("should return default config for PDF parser", () => {
      const config = ParserFactory.getDefaultConfig("pdf");
      expect(config).toBeDefined();
      expect(config.timeoutMs).toBeDefined();
    });

    it("should return default config for CSV parser", () => {
      const config = ParserFactory.getDefaultConfig("csv");
      expect(config).toBeDefined();
      expect(config.timeoutMs).toBeDefined();
    });

    it("should return default config for TXT parser", () => {
      const config = ParserFactory.getDefaultConfig("txt");
      expect(config).toBeDefined();
      expect(config.timeoutMs).toBeDefined();
    });
  });

  describe("convenience functions", () => {
    it("parseFile should work as standalone function", async () => {
      const buffer = Buffer.from("Simple text content");
      const result = await parseFile(buffer, "test.txt");
      expect(result.success).toBe(true);
    });

    it("canParseFile should work as standalone function", () => {
      expect(canParseFile("test.pdf")).toBe(true);
      expect(canParseFile("test.unknown")).toBe(false);
    });

    it("getSupportedFileTypes should work as standalone function", () => {
      const types = getSupportedFileTypes();
      expect(types).toContain("pdf");
      expect(types).toContain("csv");
      expect(types).toContain("txt");
    });

    it("parseFile should work as standalone function", async () => {
      const csvContent = "name,age\nJohn,30";
      const buffer = Buffer.from(csvContent);

      const result = await parseFile(buffer, "test.csv");

      expect(result.success).toBe(true);
      expect(result.metadata.fileType).toBe("csv");
    });

    it("parseFromString should work as standalone function", async () => {
      const textContent = "This is a test document\nWith multiple lines";

      const result = await parseFromString(textContent, "test.txt");

      expect(result.success).toBe(true);
      expect(result.metadata.fileType).toBe("txt");
    });
  });
});
