import { describe, it, expect } from "vitest";
import { CSVParser } from "./csv-parser";

describe("CSVParser", () => {
  let parser: CSVParser;

  beforeEach(() => {
    parser = new CSVParser();
  });

  describe("canParse", () => {
    it("should return true for CSV files", () => {
      expect(parser.canParse("data.csv")).toBe(true);
      expect(parser.canParse("DATA.CSV")).toBe(true);
    });

    it("should return true for TSV files", () => {
      expect(parser.canParse("data.tsv")).toBe(true);
    });

    it("should return false for TXT files by extension", () => {
      expect(parser.canParse("data.txt")).toBe(false);
    });

    it("should return false for non-CSV files", () => {
      expect(parser.canParse("document.pdf")).toBe(false);
      expect(parser.canParse("image.jpg")).toBe(false);
    });

    it("should detect CSV content by buffer analysis", () => {
      const csvBuffer = Buffer.from("name,age,city\nJohn,30,NYC");
      expect(parser.canParse("unknown.file", csvBuffer)).toBe(true);
    });

    it("should reject non-CSV content", () => {
      const textBuffer = Buffer.from(
        "This is just plain text without delimiters",
      );
      expect(parser.canParse("unknown.file", textBuffer)).toBe(false);
    });
  });

  describe("parseFromBuffer", () => {
    it("should parse simple CSV with headers", async () => {
      const csvContent = "name,age,city\nJohn,30,NYC\nJane,25,LA";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("headers");
      expect((result.data as any).headers).toEqual(["name", "age", "city"]);
      expect((result.data as any).dataRowCount).toBe(2);
      expect((result.data as any).delimiter).toBe(",");
      expect(result.metadata.recordCount).toBe(2);
    });

    it("should parse CSV without headers", async () => {
      const csvContent = "John,30,NYC\nJane,25,LA";
      const buffer = Buffer.from(csvContent);

      const config = { parserOptions: { hasHeaders: false } };
      const result = await parser.parseFromBuffer(buffer, "test.csv", config);

      expect(result.success).toBe(true);
      expect((result.data as any).headers).toBeUndefined();
      expect((result.data as any).dataRowCount).toBe(2);
    });

    it("should detect semicolon delimiter", async () => {
      const csvContent = "name;age;city\nJohn;30;NYC\nJane;25;LA";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe(";");
    });

    it("should detect tab delimiter", async () => {
      const tsvContent = "name\tage\tcity\nJohn\t30\tNYC\nJane\t25\tLA";
      const buffer = Buffer.from(tsvContent);

      const result = await parser.parseFromBuffer(buffer, "test.tsv");

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe("\t");
    });

    it("should handle quoted fields", async () => {
      const csvContent =
        'name,description\n"John Doe","A person with, comma"\n"Jane Smith","Another person"';
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].description).toBe("A person with, comma");
    });

    it("should handle escaped quotes", async () => {
      const csvContent =
        'name,quote\n"John","He said ""Hello"""\n"Jane","She said ""Hi"""';
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].quote).toBe('He said "Hello"');
    });

    it("should skip empty lines when configured", async () => {
      const csvContent = "name,age\nJohn,30\n\nJane,25\n\n";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      expect((result.data as any).dataRowCount).toBe(2);
    });

    it("should handle UTF-8 BOM", async () => {
      const csvContent = "name,age\nJohn,30\nJane,25";
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const buffer = Buffer.concat([bom, Buffer.from(csvContent)]);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      expect(result.metadata.warnings).toContain(
        "UTF-8 BOM detected and removed",
      );
    });

    it("should handle inconsistent column counts", async () => {
      const csvContent = "name,age,city\nJohn,30,NYC\nJane,25\nBob,35,LA,Extra";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "test.csv");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("inconsistent")),
      ).toBe(true);
    });

    it("should handle large files with warning", async () => {
      // Create a large CSV (simulate)
      const header = "name,age,city\n";
      const rows = Array.from(
        { length: 15000 },
        (_, i) => `Person${i},${20 + i},City${i}`,
      ).join("\n");
      const csvContent = header + rows;
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "large.csv");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) => w.includes("Large CSV")),
      ).toBe(true);
    });

    it("should return error for empty file", async () => {
      const buffer = Buffer.from("");

      const result = await parser.parseFromBuffer(buffer, "empty.csv");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_FORMAT");
    });

    it("should handle file size limits", async () => {
      const buffer = Buffer.alloc(1024 * 1024); // 1MB buffer
      const config = { maxFileSizeBytes: 512 * 1024 }; // 512KB limit

      const result = await parser.parseFromBuffer(buffer, "large.csv", config);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FILE_TOO_LARGE");
    });
  });

  describe("parseFromString", () => {
    it("should parse CSV from string", async () => {
      const csvContent = "name,age\nJohn,30\nJane,25";

      const result = await parser.parseFromString(csvContent, "test.csv");

      expect(result.success).toBe(true);
      expect((result.data as any).dataRowCount).toBe(2);
    });
  });

  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = parser.getDefaultConfig();

      expect(config.maxFileSizeBytes).toBe(50 * 1024 * 1024);
      expect(config.timeoutMs).toBe(30000);
      expect(config.includeRawContent).toBe(false);
      expect(config.parserOptions).toHaveProperty("hasHeaders", true);
      expect(config.parserOptions).toHaveProperty("skipEmptyLines", true);
    });
  });

  describe("advanced CSV parsing", () => {
    it("should handle CSV with specific delimiter", async () => {
      const csvContent = "name|age|city\nJohn|30|NYC\nJane|25|LA";
      const buffer = Buffer.from(csvContent);
      const config = {
        parserOptions: { delimiter: "|", autoDetectDelimiter: false },
      };

      const result = await parser.parseFromBuffer(buffer, "pipe.csv", config);

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe("|");
    });

    it("should handle CSV without auto-detection", async () => {
      const csvContent = "name,age,city\nJohn,30,NYC";
      const buffer = Buffer.from(csvContent);
      const config = { parserOptions: { autoDetectDelimiter: false } };

      const result = await parser.parseFromBuffer(buffer, "test.csv", config);

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe(",");
    });

    it("should handle CSV with auto-detection fallback", async () => {
      const csvContent = "no delimiters here\njust plain text";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "plain.csv");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) =>
          w.includes("Could not reliably detect"),
        ),
      ).toBe(true);
    });

    it("should handle CSV with custom quote and escape characters", async () => {
      const csvContent =
        "name,description\n'John','He said ''Hello'''\n'Jane','Simple text'";
      const buffer = Buffer.from(csvContent);
      const config = { parserOptions: { quote: "'", escape: "'" } };

      const result = await parser.parseFromBuffer(buffer, "custom.csv", config);

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].description).toBe("He said 'Hello'");
    });

    it("should handle CSV with non-string headers detected", async () => {
      const csvContent = "1,2,3\nJohn,30,NYC\nJane,25,LA";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(
        buffer,
        "numeric-headers.csv",
      );

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) =>
          w.includes("headers appear to be numeric"),
        ),
      ).toBe(true);
    });

    it("should handle CSV with extra columns in data rows", async () => {
      const csvContent = "name,age\nJohn,30,NYC,Extra\nJane,25";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "extra-cols.csv");

      expect(result.success).toBe(true);
      expect(
        result.metadata.warnings.some((w) =>
          w.includes("more columns than headers"),
        ),
      ).toBe(true);
    });

    it("should handle UTF-16 CSV files", async () => {
      const csvContent = "name,age\nJohn,30";
      const bom = Buffer.from([0xff, 0xfe]);
      const content = Buffer.from(csvContent, "utf16le");
      const buffer = Buffer.concat([bom, content]);

      const result = await parser.parseFromBuffer(buffer, "utf16.csv");

      expect(result.success).toBe(true);
      expect(result.metadata.warnings.some((w) => w.includes("UTF-16"))).toBe(
        true,
      );
    });

    it("should handle CSV with complex quoted fields and line breaks", async () => {
      const csvContent =
        'name,description\n"John Doe","Line 1\nLine 2\nLine 3"\n"Jane","Simple"';
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "multiline.csv");

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].description).toContain("Line 1");
      expect(rows[0].description).toContain("Line 2");
    });

    it("should not skip empty lines when configured", async () => {
      const csvContent = "name,age\nJohn,30\n\nJane,25\n\n";
      const buffer = Buffer.from(csvContent);
      const config = { parserOptions: { skipEmptyLines: false } };

      const result = await parser.parseFromBuffer(
        buffer,
        "with-empty.csv",
        config,
      );

      expect(result.success).toBe(true);
      expect(
        (result.data as any).rawRows.some(
          (row: string[]) => row.length === 1 && row[0] === "",
        ),
      ).toBe(true);
    });

    it("should handle timeout errors", async () => {
      const csvContent = "name,age\nJohn,30";
      const buffer = Buffer.from(csvContent);

      // Mock the parsing method to simulate a slow operation
      const originalParse = (parser as any).parseCSVContent;
      (parser as any).parseCSVContent = () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                rows: [],
                headers: ["name", "age"],
                rawRows: [
                  ["name", "age"],
                  ["John", "30"],
                ],
                dataRowCount: 1,
                columnCount: 2,
                delimiter: ",",
                statistics: {
                  emptyRows: 0,
                  inconsistentColumnCounts: 0,
                  maxColumns: 2,
                  minColumns: 2,
                },
              }),
            200,
          ),
        );

      const config = { timeoutMs: 100 }; // 100ms timeout
      const result = await parser.parseFromBuffer(buffer, "test.csv", config);

      (parser as any).parseCSVContent = originalParse;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TIMEOUT");
    });
  });

  describe("delimiter detection edge cases", () => {
    it("should detect delimiter with consistent usage", async () => {
      const csvContent = "A;B;C\nX;Y;Z\nP;Q;R";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "semicolon.csv");

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe(";");
    });

    it("should handle mixed delimiters and choose best one", async () => {
      const csvContent = "A,B,C\nX,Y;Z\nP,Q,R"; // Mixed , and ;
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "mixed.csv");

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe(","); // Should prefer comma
    });

    it("should warn about non-comma delimiter detection", async () => {
      const csvContent = "A\tB\tC\nX\tY\tZ";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "tab.csv");

      expect(result.success).toBe(true);
      expect((result.data as any).delimiter).toBe("\t");
      expect(
        result.metadata.warnings.some((w) => w.includes("Detected delimiter")),
      ).toBe(true);
    });
  });

  describe("CSV line parsing edge cases", () => {
    it("should handle quotes at end of line", async () => {
      const csvContent =
        'name,quote\nJohn,"He said ""Hello"""\nJane,"Simple text"';
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "end-quotes.csv");

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].quote).toBe('He said "Hello"');
    });

    it("should handle empty quoted fields", async () => {
      const csvContent = 'name,empty,value\nJohn,"",30\nJane,"",25';
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "empty-quoted.csv");

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].empty).toBe("");
    });

    it("should handle fields with only delimiters", async () => {
      const csvContent = "a,b,c\n,,,\nx,y,z";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(
        buffer,
        "only-delimiters.csv",
      );

      expect(result.success).toBe(true);
      const rows = (result.data as any).rows;
      expect(rows[0].a).toBe("");
      expect(rows[0].b).toBe("");
      expect(rows[0].c).toBe("");
    });
  });

  describe("statistics and validation", () => {
    it("should calculate statistics correctly", async () => {
      const csvContent = "name,age\nJohn,30\n\nJane,25,Extra"; // Inconsistent row
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "stats.csv");

      expect(result.success).toBe(true);
      const stats = (result.data as any).statistics;
      expect(stats.emptyRows).toBe(1);
      expect(stats.inconsistentColumnCounts).toBe(1);
      expect(stats.maxColumns).toBe(3);
      expect(stats.minColumns).toBe(2);
    });

    it("should handle all rows having same column count", async () => {
      const csvContent = "a,b,c\n1,2,3\n4,5,6";
      const buffer = Buffer.from(csvContent);

      const result = await parser.parseFromBuffer(buffer, "consistent.csv");

      expect(result.success).toBe(true);
      const stats = (result.data as any).statistics;
      expect(stats.inconsistentColumnCounts).toBe(0);
    });
  });
});
