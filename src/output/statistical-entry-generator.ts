/**
 * @fileoverview Statistical Journal Entry CSV Generator
 *
 * Generates Statistical Journal Entry (StatJE) CSV files in NetSuite-compatible format.
 * Handles statistical/metrics data like ADR, RevPAR, Occupancy, Rooms Sold, etc.
 */

import { createCorrelatedLogger, Logger } from "../utils/logger";
import {
  getPropertyConfigService,
  PropertyConfig,
} from "../config/property-config";

/**
 * Statistical Journal Entry record structure
 */
export interface StatisticalJournalEntryRecord {
  /** Transaction ID: MM/DD/YYYY WRH */
  transactionId: string;
  /** Business date in MM/DD/YYYY format */
  date: string;
  /** Subsidiary full name */
  subsidiary: string;
  /** Unit of measure type (always "statistical") */
  unitOfMeasureType: string;
  /** Unit of measure (always "Each") */
  unitOfMeasure: string;
  /** Account number (prefix only, before "-") */
  acctNumber: string;
  /** Internal ID (suffix only, after "-") */
  internalId: string;
  /** Account name from mapping file */
  accountName: string;
  /** Department ID (always "1") */
  departmentId: string;
  /** Location Internal ID */
  location: string;
  /** Amount/value */
  amount: string;
  /** Line units (always "EA") */
  lineUnits: string;
}

/**
 * Transformed data structure for statistical processing
 */
export interface TransformedStatJEData {
  propertyId: string;
  propertyName: string;
  reportDate: string; // Business date from report (YYYY-MM-DD)
  records: TransformedStatJERecord[];
}

/**
 * Individual transformed statistical record
 */
export interface TransformedStatJERecord {
  sourceCode: string;
  sourceDescription: string;
  sourceAmount: number;
  targetCode?: string;
  targetDescription?: string;
  mappedAmount?: number;
}

/**
 * Statistical Journal Entry CSV Generator
 *
 * Generates NetSuite-compatible Statistical Journal Entry CSV files.
 */
export class StatisticalEntryGenerator {
  private logger: Logger;
  private propertyConfigService = getPropertyConfigService();

  constructor() {
    this.logger = createCorrelatedLogger("StatisticalEntryGenerator");
  }

  /**
   * Generate Statistical Entry CSV content
   *
   * @param allTransformedData - Array of transformed data for all properties
   * @param correlationId - Correlation ID for logging
   * @returns CSV content as string
   */
  async generateStatisticalEntryCSV(
    allTransformedData: TransformedStatJEData[],
    correlationId: string,
  ): Promise<string> {
    const csvLines: string[] = [];

    this.logger.info("Starting Statistical Entry CSV generation", {
      correlationId,
      propertiesCount: allTransformedData.length,
    });

    // Add header row (only once)
    csvLines.push(this.generateStatJEHeader());

    // Process each property's data
    for (const transformedData of allTransformedData) {
      const propertyConfig =
        this.propertyConfigService.getPropertyConfigOrDefault(
          transformedData.propertyName,
        );

      // Filter only statistical records (90xxx accounts)
      const statisticalRecords = transformedData.records.filter((record) =>
        this.isStatisticalRecord(record),
      );

      if (statisticalRecords.length === 0) {
        this.logger.warn("No statistical records found for property", {
          correlationId,
          propertyName: transformedData.propertyName,
        });
        continue;
      }

      // Generate transaction ID
      const transactionId = this.generateTransactionId(
        transformedData.reportDate,
      );

      // Format date
      const formattedDate = this.formatDate(transformedData.reportDate);

      // Process each record
      for (const record of statisticalRecords) {
        const statJERecord = this.transformToStatJERecord(
          record,
          transactionId,
          formattedDate,
          propertyConfig,
        );
        csvLines.push(this.formatStatJERecord(statJERecord));
      }

      this.logger.info("Processed property for StatJE", {
        correlationId,
        propertyName: transformedData.propertyName,
        recordCount: statisticalRecords.length,
        transactionId,
      });
    }

    const csvContent = csvLines.join("\n");

    this.logger.info("Statistical Entry CSV generation completed", {
      correlationId,
      totalLines: csvLines.length,
      outputSize: Buffer.byteLength(csvContent, "utf8"),
    });

    return csvContent;
  }

  /**
   * Generate StatJE header row
   */
  private generateStatJEHeader(): string {
    const headers = [
      "Transaction ID",
      "Date",
      "Subsidiary",
      "Unit of Measure Type",
      "Unit of Measure",
      "acctNumber",
      "internal id",
      "account name",
      "department id",
      "location",
      "Amount",
      "Line Units",
    ];
    return headers.map((h) => `"${h}"`).join(",");
  }

  /**
   * Check if record is statistical
   */
  private isStatisticalRecord(record: TransformedStatJERecord): boolean {
    const accountCode = record.targetCode || record.sourceCode || "";

    // Statistical accounts start with 90xxx
    if (accountCode.startsWith("90")) {
      return true;
    }

    // Also check description for statistical keywords
    const statisticalKeywords = [
      "ADR",
      "RevPAR",
      "Rooms Sold",
      "OOS",
      "Comps",
      "Occy",
    ];
    const description = (record.sourceDescription || "").toUpperCase();
    return statisticalKeywords.some((keyword) =>
      description.includes(keyword.toUpperCase()),
    );
  }

  /**
   * Transform record to StatJE format
   */
  private transformToStatJERecord(
    record: TransformedStatJERecord,
    transactionId: string,
    formattedDate: string,
    propertyConfig: PropertyConfig,
  ): StatisticalJournalEntryRecord {
    // Get account code from mapping (targetCode) or fallback to sourceCode
    const fullAccountCode = record.targetCode || record.sourceCode || "";
    const { prefix, suffix } = this.splitAccountCode(fullAccountCode);

    // Get account name from mapping
    const accountName =
      record.targetDescription || record.sourceDescription || "";

    // Get amount (use mapped amount if available, otherwise source amount)
    const amount = Math.abs(record.mappedAmount ?? record.sourceAmount);

    return {
      transactionId,
      date: formattedDate,
      subsidiary: propertyConfig.subsidiaryFullName,
      unitOfMeasureType: "statistical",
      unitOfMeasure: "Each",
      acctNumber: prefix,
      internalId: suffix,
      accountName,
      departmentId: "1",
      location: propertyConfig.locationInternalId,
      amount: amount.toFixed(2),
      lineUnits: "EA",
    };
  }

  /**
   * Split account code into prefix and suffix
   * Example: "90001-418" -> { prefix: "90001", suffix: "418" }
   */
  private splitAccountCode(accountCode: string): {
    prefix: string;
    suffix: string;
  } {
    const parts = accountCode.split("-");
    if (parts.length >= 2) {
      return {
        prefix: parts[0].trim(),
        suffix: parts[1].trim(),
      };
    }
    return {
      prefix: accountCode.trim(),
      suffix: "",
    };
  }

  /**
   * Format StatJE record into CSV line
   */
  private formatStatJERecord(record: StatisticalJournalEntryRecord): string {
    return [
      record.transactionId,
      record.date,
      record.subsidiary,
      record.unitOfMeasureType,
      record.unitOfMeasure,
      record.acctNumber,
      record.internalId,
      record.accountName,
      record.departmentId,
      record.location,
      record.amount,
      record.lineUnits,
    ]
      .map((field) => this.quoteField(field))
      .join(",");
  }

  /**
   * Quote field for CSV output if needed
   */
  private quoteField(field: string | number): string {
    const stringValue = String(field);
    if (
      stringValue.includes(",") ||
      stringValue.includes('"') ||
      stringValue.includes("\n")
    ) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return `"${stringValue}"`;
  }

  /**
   * Generate transaction ID: MM/DD/YYYY WRH
   */
  private generateTransactionId(reportDate: string): string {
    const formattedDate = this.formatDate(reportDate);
    return `${formattedDate} WRH`;
  }

  /**
   * Format date from YYYY-MM-DD to MM/DD/YYYY
   */
  private formatDate(reportDate: string): string {
    const [year, month, day] = reportDate.split("-");
    return `${month}/${day}/${year}`;
  }
}
