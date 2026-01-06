import { describe, it, expect } from "vitest";
import { TXTParser } from "./txt-parser";

// Type for TXT parser data structure
interface TXTParserData {
  text?: string;
  lines?: string[];
  structureType?: string;
  keyValuePairs?: Record<string, string>;
  structuredData?: unknown[];
  patterns?: {
    hasEmailAddresses?: boolean;
    hasPhoneNumbers?: boolean;
    hasUrls?: boolean;
    hasDates?: boolean;
  };
  statistics?: {
    lineCount?: number;
    wordCount?: number;
    characterCount?: number;
  };
  encoding?: {
    detected?: string;
    confidence?: number;
  };
  rawContent?: string;
}

// Type for accessing private methods in tests
type TXTParserPrivate = TXTParser & {
  parseTextContent: (content: string, options: unknown) => Promise<unknown>;
  detectEncodingAndConvert: (buffer: Buffer) => {
    text: string;
    encoding: unknown;
  };
};

describe("TXTParser", () => {
  let parser: TXTParser;

  beforeEach(() => {
    parser = new TXTParser();
  });

  describe("parser info", () => {
    it("should have correct parser info", () => {
      expect(parser.fileType).toBe("txt");
      expect(parser.parserInfo.name).toBe("TXTParser");
      expect(parser.parserInfo.version).toBe("1.0.0");
    });
  });

  describe("canParse", () => {
    it("should return true for text file extensions", () => {
      expect(parser.canParse("document.txt")).toBe(true);
      expect(parser.canParse("notes.text")).toBe(true);
      expect(parser.canParse("app.log")).toBe(true);
      expect(parser.canParse("data.dat")).toBe(true);
      expect(parser.canParse("file.asc")).toBe(true);
    });

    it("should return false for non-text file extensions", () => {
      expect(parser.canParse("document.pdf")).toBe(false);
      expect(parser.canParse("data.csv")).toBe(false);
      expect(parser.canParse("image.jpg")).toBe(false);
    });

    it("should detect text content by buffer analysis", () => {
      const textBuffer = Buffer.from(
        "This is plain text content\nWith multiple lines",
      );
      expect(parser.canParse("unknown.file", textBuffer)).toBe(true);
    });

    it("should reject binary content", () => {
      const binaryBuffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      expect(parser.canParse("unknown.file", binaryBuffer)).toBe(false);
    });

    it("should handle mixed content with high control character ratio", () => {
      const mixedBuffer = Buffer.from([
        0x41, 0x42, 0x00, 0x01, 0x02, 0x03, 0x43,
      ]); // ABC with control chars
      expect(parser.canParse("unknown.file", mixedBuffer)).toBe(false);
    });
  });

  describe("parseFromBuffer", () => {
    it("should parse simple text content", async () => {
      const textContent =
        "This is a simple text file.\nWith multiple lines.\nAnd some content.";
      const buffer = Buffer.from(textContent);

      const result = await parser.parseFromBuffer(buffer, "test.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).text).toBe(textContent);
      expect((result.data as TXTParserData).lines).toHaveLength(3);
      expect((result.data as TXTParserData).structureType).toBe("unstructured");
      expect(result.metadata.recordCount).toBe(3);
    });

    it("should detect key-value structure", async () => {
      const kvContent =
        "Name: John Doe\nAge: 30\nCity: New York\nOccupation: Developer";
      const buffer = Buffer.from(kvContent);

      const result = await parser.parseFromBuffer(buffer, "config.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("key-value");
      expect((result.data as TXTParserData).keyValuePairs).toHaveProperty(
        "Name",
        "John Doe",
      );
      expect((result.data as TXTParserData).keyValuePairs).toHaveProperty(
        "Age",
        "30",
      );
    });

    it("should detect tabular structure", async () => {
      const tabContent =
        "Name\tAge\tCity\nJohn\t30\tNYC\nJane\t25\tLA\nBob\t35\tChicago";
      const buffer = Buffer.from(tabContent);

      const result = await parser.parseFromBuffer(buffer, "data.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("tabular");
      expect((result.data as TXTParserData).structuredData).toHaveLength(4);
    });

    it("should detect pipe-delimited structure", async () => {
      const pipeContent = "Name|Age|City\nJohn|30|NYC\nJane|25|LA";
      const buffer = Buffer.from(pipeContent);

      const result = await parser.parseFromBuffer(buffer, "data.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("delimited");
    });

    it("should detect log structure", async () => {
      const logContent =
        "2024-01-15 Application started\n2024-01-16 Loading configuration\n2024-01-17 Failed to connect\n2024-01-18 System ready\n2024-01-19 Process complete";
      const buffer = Buffer.from(logContent);

      const result = await parser.parseFromBuffer(buffer, "app.log");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("log");
    });

    it("should detect list structure", async () => {
      const listContent =
        "• First item\n• Second item\n• Third item\n1. Numbered item\n2. Another numbered item";
      const buffer = Buffer.from(listContent);

      const result = await parser.parseFromBuffer(buffer, "list.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("list");
    });

    it("should detect report structure", async () => {
      const reportContent =
        "MONTHLY REPORT\n\nSales Summary\nRevenue: $50,000\n\nEXPENSES\nMarketing: $10,000\nOperations: $15,000";
      const buffer = Buffer.from(reportContent);

      const result = await parser.parseFromBuffer(buffer, "report.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("report");
    });

    it("should handle UTF-8 BOM", async () => {
      const textContent = "Text with BOM";
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const buffer = Buffer.concat([bom, Buffer.from(textContent)]);

      const result = await parser.parseFromBuffer(buffer, "bom.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).text).toBe(textContent);
      expect(result.metadata.warnings).toContain(
        "UTF-8 BOM detected and removed",
      );
    });

    it("should handle UTF-16 LE BOM", async () => {
      const textContent = "UTF-16 text";
      const bom = Buffer.from([0xff, 0xfe]);
      const content = Buffer.from(textContent, "utf16le");
      const buffer = Buffer.concat([bom, content]);

      const result = await parser.parseFromBuffer(buffer, "utf16.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).encoding.detected).toBe("utf16le");
    });

    it("should handle UTF-16 BE BOM", async () => {
      const textContent = "UTF-16 BE text";
      const bom = Buffer.from([0xfe, 0xff]);
      const content = Buffer.from(textContent, "utf16le"); // Using utf16le as fallback
      const buffer = Buffer.concat([bom, content]);

      const result = await parser.parseFromBuffer(buffer, "utf16be.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).encoding.detected).toBe("utf16be");
    });

    it("should warn about high non-ASCII character ratio", async () => {
      const textContent =
        "Тест с русскими символами и другими не-ASCII символами";
      const buffer = Buffer.from(textContent);

      const result = await parser.parseFromBuffer(buffer, "russian.txt");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("non-ASCII")),
      ).toBe(true);
    });

    it("should warn about replacement characters", async () => {
      const textContent = "Text with replacement char: \uFFFD";
      const buffer = Buffer.from(textContent);

      const result = await parser.parseFromBuffer(buffer, "replacement.txt");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) =>
          w.includes("Replacement characters"),
        ),
      ).toBe(true);
    });

    it("should detect various patterns", async () => {
      const textContent = `Contact Info:
Email: john.doe@example.com
Phone: (555) 123-4567
Address: 123 Main Street Anytown
Date: 2024-01-15
Amount: $1,234.56
ID: 12345`;
      const buffer = Buffer.from(textContent);

      const result = await parser.parseFromBuffer(buffer, "contact.txt");

      expect(result.success).toBe(true);
      const patterns = (result.data as TXTParserData).patterns;
      expect(patterns.hasEmailAddresses).toBe(true);
      expect(patterns.hasPhoneNumbers).toBe(true);
      expect(patterns.hasAddresses).toBe(true);
      expect(patterns.hasTimestamps).toBe(true);
      expect(patterns.hasCurrency).toBe(true);
      expect(patterns.hasNumbers).toBe(true);
    });

    it("should handle large files with line limit", async () => {
      const lines = Array.from({ length: 60000 }, (_, i) => `Line ${i + 1}`);
      const textContent = lines.join("\n");
      const buffer = Buffer.from(textContent);
      const config = { parserOptions: { maxLines: 50000 } };

      const result = await parser.parseFromBuffer(buffer, "large.txt", config);

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).lines).toHaveLength(50000);
      expect(
        result.metadata.warnings.some((w) =>
          w.includes("only processing first"),
        ),
      ).toBe(true);
    });

    it("should calculate text statistics correctly", async () => {
      const textContent =
        "Line 1\n\nLine 3 with more words\nShort\nThis is the longest line in the file";
      const buffer = Buffer.from(textContent);

      const result = await parser.parseFromBuffer(buffer, "stats.txt");

      expect(result.success).toBe(true);
      const stats = (result.data as TXTParserData).statistics;
      expect(stats.lineCount).toBe(5);
      expect(stats.emptyLines).toBe(1);
      expect(stats.longestLine).toBe(36); // Length of longest line
      expect(stats.wordCount).toBeGreaterThan(0);
      expect(stats.characterCount).toBeGreaterThan(0);
      expect(stats.averageLineLength).toBeGreaterThan(0);
    });

    it("should handle key-value pairs with duplicate keys", async () => {
      const kvContent = "Name: John\nAge: 30\nName: Jane\nAge: 25";
      const buffer = Buffer.from(kvContent);

      const result = await parser.parseFromBuffer(buffer, "duplicate.txt");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("Duplicate key")),
      ).toBe(true);
    });

    it("should handle inconsistent tabular data", async () => {
      const tabContent = "A\tB\tC\nX\tY\nP\tQ\tR\tS"; // Different column counts
      const buffer = Buffer.from(tabContent);

      const result = await parser.parseFromBuffer(buffer, "inconsistent.txt");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("inconsistent")),
      ).toBe(true);
    });

    it("should include raw content when requested", async () => {
      const textContent = "Test content";
      const buffer = Buffer.from(textContent);
      const config = { includeRawContent: true };

      const result = await parser.parseFromBuffer(buffer, "test.txt", config);

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).rawContent).toBe(textContent);
    });

    it("should not include raw content by default", async () => {
      const textContent = "Test content";
      const buffer = Buffer.from(textContent);

      const result = await parser.parseFromBuffer(buffer, "test.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).rawContent).toBeUndefined();
    });

    it("should disable structure detection when configured", async () => {
      const kvContent = "Name: John\nAge: 30";
      const buffer = Buffer.from(kvContent);
      const config = { parserOptions: { detectStructure: false } };

      const result = await parser.parseFromBuffer(
        buffer,
        "no-structure.txt",
        config,
      );

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("unstructured");
      expect((result.data as TXTParserData).keyValuePairs).toBeUndefined();
    });

    it("should handle file size limits", async () => {
      const buffer = Buffer.alloc(1024 * 1024); // 1MB buffer
      const config = { maxFileSizeBytes: 512 * 1024 }; // 512KB limit

      const result = await parser.parseFromBuffer(buffer, "large.txt", config);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FILE_TOO_LARGE");
    });

    it("should handle timeout", async () => {
      const textContent = "Test content";
      const buffer = Buffer.from(textContent);
      // Simulate timeout by mocking the parsing method to take longer
      const originalParse = (parser as TXTParserPrivate).parseTextContent;
      (parser as TXTParserPrivate).parseTextContent = () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                text: textContent,
                lines: [textContent],
                structureType: "unstructured",
                statistics: {
                  lineCount: 1,
                  wordCount: 2,
                  characterCount: 12,
                  emptyLines: 0,
                  longestLine: 12,
                  averageLineLength: 12,
                },
                patterns: {
                  hasTimestamps: false,
                  hasEmailAddresses: false,
                  hasPhoneNumbers: false,
                  hasAddresses: false,
                  hasCurrency: false,
                  hasNumbers: false,
                },
                encoding: { detected: "utf8", confidence: 1.0 },
              }),
            200,
          ),
        );

      const config = { timeoutMs: 100 }; // 100ms timeout
      const result = await parser.parseFromBuffer(buffer, "test.txt", config);

      (parser as TXTParserPrivate).parseTextContent = originalParse;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TIMEOUT");
    });

    it("should handle encoding decode errors", async () => {
      // Create buffer that will cause encoding issues - UTF-16 without proper content
      const buffer = Buffer.from([0xff, 0xfe, 0x00, 0x01]);

      const result = await parser.parseFromBuffer(buffer, "bad-encoding.txt");

      // Should still succeed but detect UTF-16
      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).encoding.detected).toBe("utf16le");
    });
  });

  describe("parseFromString", () => {
    it("should parse text from string", async () => {
      const textContent = "Simple text content\nWith multiple lines";

      const result = await parser.parseFromString(textContent, "test.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).text).toBe(textContent);
    });
  });

  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = parser.getDefaultConfig();

      expect(config.maxFileSizeBytes).toBe(50 * 1024 * 1024);
      expect(config.timeoutMs).toBe(30000);
      expect(config.includeRawContent).toBe(false);
      expect(config.parserOptions).toHaveProperty("encoding", "auto");
      expect(config.parserOptions).toHaveProperty("lineEnding", "auto");
      expect(config.parserOptions).toHaveProperty("detectStructure", true);
      expect(config.parserOptions).toHaveProperty("maxLines", 50000);
    });
  });

  describe("error handling", () => {
    it("should handle decode errors", async () => {
      const buffer = Buffer.from([0x80, 0x81, 0x82]); // Invalid UTF-8 sequence

      const result = await parser.parseFromBuffer(buffer, "invalid.txt");

      // Should still process but may have encoding warnings
      expect(result.success).toBe(true);
    });

    it("should determine correct error codes", async () => {
      // Mock the parsing to throw a decode error
      const originalDetect = (parser as TXTParserPrivate)
        .detectEncodingAndConvert;
      (parser as TXTParserPrivate).detectEncodingAndConvert = () => {
        throw new Error("Failed to decode text file: invalid encoding");
      };

      const buffer = Buffer.from("test");
      const result = await parser.parseFromBuffer(buffer, "test.txt");

      (parser as TXTParserPrivate).detectEncodingAndConvert = originalDetect;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_FORMAT");
    });
  });

  describe("structure analysis edge cases", () => {
    it("should handle empty files", async () => {
      const buffer = Buffer.from("");

      const result = await parser.parseFromBuffer(buffer, "empty.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("unstructured");
      expect((result.data as TXTParserData).statistics.lineCount).toBe(1); // Empty string creates one line
    });

    it("should handle files with only whitespace", async () => {
      const buffer = Buffer.from("   \n\n  \t  \n   ");

      const result = await parser.parseFromBuffer(buffer, "whitespace.txt");

      expect(result.success).toBe(true);
      expect((result.data as TXTParserData).structureType).toBe("unstructured");
    });

    it("should handle mixed structure types", async () => {
      const mixedContent = "Name: John\nAge: 30\nCity: NYC\nState: NY";
      const buffer = Buffer.from(mixedContent);

      const result = await parser.parseFromBuffer(buffer, "mixed.txt");

      expect(result.success).toBe(true);
      // Should detect key-value structure (most prominent)
      expect((result.data as TXTParserData).structureType).toBe("key-value");
    });
  });
});
