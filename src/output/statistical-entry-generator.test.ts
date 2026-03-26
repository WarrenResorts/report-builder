/**
 * @fileoverview Tests for Statistical Entry Generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StatisticalEntryGenerator,
  type TransformedStatJEData,
} from "./statistical-entry-generator";

// Mock the logger
vi.mock("../utils/logger", () => ({
  createCorrelatedLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock property config service
const mockGetPropertyConfigOrDefault = vi.fn();
vi.mock("../config/property-config", () => ({
  getPropertyConfigService: vi.fn(() => ({
    getPropertyConfigOrDefault: mockGetPropertyConfigOrDefault,
  })),
}));

const CORRELATION_ID = "test-correlation-id";

const mockPropertyConfig = {
  subsidiaryInternalId: "26",
  subsidiaryFullName: "Warren Resort Hotels, Inc.",
  locationInternalId: "36",
  creditCardDepositAccount: "2100-418",
};

describe("StatisticalEntryGenerator", () => {
  let generator: StatisticalEntryGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPropertyConfigOrDefault.mockReturnValue(mockPropertyConfig);
    generator = new StatisticalEntryGenerator();
  });

  describe("generateStatisticalEntryCSV", () => {
    it("should generate header row for empty input", async () => {
      const result = await generator.generateStatisticalEntryCSV(
        [],
        CORRELATION_ID,
      );

      expect(result).toContain("Transaction ID");
      expect(result).toContain("Date");
      expect(result).toContain("Subsidiary");
      expect(result).toContain("Property Name");
      expect(result).toContain("Amount");
    });

    it("should generate CSV rows for statistical records with 90xxx account codes", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Best Western Windsor Inn",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001-418",
              sourceDescription: "Rooms Sold",
              sourceAmount: 150,
              targetCode: "90001-418",
              targetDescription: "Rooms Sold",
              mappedAmount: 150,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      expect(result).toContain("WRH26");
      expect(result).toContain("Warren Resort Hotels, Inc.");
      expect(result).toContain("150.00");
    });

    it("should skip property when no statistical records exist", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "1000-100",
              sourceDescription: "Regular Account",
              sourceAmount: 500,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      // Only the header row should be present — the property is skipped
      const lines = result.split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("Transaction ID");
    });

    it("should detect statistical records by keyword in description", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "1000",
              sourceDescription: "ADR metric",
              sourceAmount: 125.5,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      expect(result).toContain("125.50");
    });

    it("should handle account codes without a dash (no suffix)", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001",
              sourceDescription: "Rooms Sold",
              sourceAmount: 75,
              targetCode: "90001",
              targetDescription: "Rooms Sold",
              mappedAmount: 75,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      const lines = result.split("\n");
      // There should be a data row (header + 1 record)
      expect(lines).toHaveLength(2);

      // Account number is "90001" and internal id is "" (empty suffix)
      expect(lines[1]).toContain('"90001"');
      // The internalId field should be an empty quoted string
      expect(lines[1]).toContain('""');
    });

    it("should quote fields that contain commas", async () => {
      mockGetPropertyConfigOrDefault.mockReturnValue({
        ...mockPropertyConfig,
        subsidiaryFullName: "Warren, Resort Hotels",
      });

      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001-418",
              sourceDescription: "Rooms Sold",
              sourceAmount: 50,
              targetCode: "90001-418",
              targetDescription: "Rooms, Sold",
              mappedAmount: 50,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      // Fields with commas should be double-quoted
      expect(result).toContain('"Rooms, Sold"');
    });

    it("should quote fields that contain double quotes", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001-418",
              sourceDescription: "Rooms Sold",
              sourceAmount: 50,
              targetCode: "90001-418",
              targetDescription: 'Rooms "Sold"',
              mappedAmount: 50,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      // Double quotes in content should be escaped
      expect(result).toContain('""Sold""');
    });

    it("should use sourceAmount when mappedAmount is not provided", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001-418",
              sourceDescription: "Rooms Sold",
              sourceAmount: 99,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      expect(result).toContain("99.00");
    });

    it("should format the transaction ID correctly", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Test Property",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001-418",
              sourceDescription: "Rooms Sold",
              sourceAmount: 10,
              mappedAmount: 10,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      // Transaction ID format: MM/DD/YYYY WRH{SubsidiaryID}
      expect(result).toContain("01/06/2025 WRH26");
    });

    it("should process multiple properties and skip those with no stats", async () => {
      const data: TransformedStatJEData[] = [
        {
          propertyId: "PROP001",
          propertyName: "Hotel With Stats",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "90001-418",
              sourceDescription: "Rooms Sold",
              sourceAmount: 100,
              mappedAmount: 100,
            },
          ],
        },
        {
          propertyId: "PROP002",
          propertyName: "Hotel Without Stats",
          reportDate: "2025-01-06",
          records: [
            {
              sourceCode: "1000-100",
              sourceDescription: "Regular Account",
              sourceAmount: 500,
            },
          ],
        },
      ];

      const result = await generator.generateStatisticalEntryCSV(
        data,
        CORRELATION_ID,
      );

      const lines = result.split("\n");
      // Header + 1 record (second property is skipped)
      expect(lines).toHaveLength(2);
    });
  });
});
