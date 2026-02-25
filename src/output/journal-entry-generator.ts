/**
 * @fileoverview Journal Entry CSV Generator
 *
 * Generates Journal Entry (JE) CSV files in NetSuite-compatible format.
 * Handles financial transactions including revenue, expenses, assets, and liabilities.
 */

import { createCorrelatedLogger, Logger } from "../utils/logger";
import {
  getPropertyConfigService,
  PropertyConfig,
} from "../config/property-config";

/**
 * Journal Entry record structure
 */
export interface JournalEntryRecord {
  /** Entry ID: WR{locationId}{YYYYMMDD} */
  entry: string;
  /** Business date in MM/DD/YYYY format */
  date: string;
  /** Subsidiary full name */
  subName: string;
  /** Subsidiary Internal ID */
  subsidiary: string;
  /** Account number (prefix only, before "-") */
  acctnumber: string;
  /** Internal ID (suffix only, after "-") */
  internalId: string;
  /** Location Internal ID */
  location: string;
  /** Account name from mapping file */
  accountName: string;
  /** Debit amount (empty if credit) */
  debit: string;
  /** Credit amount (empty if debit) */
  credit: string;
  /** Comment/description from Daily Report */
  comment: string;
  /** Payment type (only for credit cards: VISA/MASTER, AMEX, DISCOVER) */
  paymentType: string;
}

/**
 * Transformed data structure for processing
 */
export interface TransformedJEData {
  propertyId: string;
  propertyName: string;
  reportDate: string; // Business date from report (YYYY-MM-DD)
  records: TransformedJERecord[];
}

/**
 * Individual transformed record
 */
export interface TransformedJERecord {
  sourceCode: string;
  sourceDescription: string;
  sourceAmount: number;
  targetCode?: string;
  targetDescription?: string;
  mappedAmount?: number;
  paymentMethod?: string;
  originalLine?: string;
}

/**
 * Journal Entry CSV Generator
 *
 * Generates NetSuite-compatible Journal Entry CSV files for financial transactions.
 */
export class JournalEntryGenerator {
  private logger: Logger;
  private propertyConfigService = getPropertyConfigService();

  constructor() {
    this.logger = createCorrelatedLogger("JournalEntryGenerator");
  }

  /**
   * Generate Journal Entry CSV content
   *
   * @param allTransformedData - Array of transformed data for all properties
   * @param correlationId - Correlation ID for logging
   * @returns CSV content as string
   */
  async generateJournalEntryCSV(
    allTransformedData: TransformedJEData[],
    correlationId: string,
  ): Promise<string> {
    const csvLines: string[] = [];

    this.logger.info("Starting Journal Entry CSV generation", {
      correlationId,
      propertiesCount: allTransformedData.length,
    });

    // Add header row (only once)
    csvLines.push(this.generateJEHeader());

    // Process each property's data
    for (const transformedData of allTransformedData) {
      const propertyConfig =
        this.propertyConfigService.getPropertyConfigOrDefault(
          transformedData.propertyName,
        );

      // Filter out statistical records (90xxx accounts)
      const financialRecords = transformedData.records.filter(
        (record) => !this.isStatisticalRecord(record),
      );

      if (financialRecords.length === 0) {
        this.logger.warn("No financial records found for property", {
          correlationId,
          propertyName: transformedData.propertyName,
        });
        continue;
      }

      // Generate entry ID
      const entryId = this.generateEntryId(
        propertyConfig.locationInternalId,
        transformedData.reportDate,
      );

      // Format date
      const formattedDate = this.formatDate(transformedData.reportDate);

      // Process each record
      for (const record of financialRecords) {
        const jeRecord = this.transformToJERecord(
          record,
          entryId,
          formattedDate,
          propertyConfig,
        );
        csvLines.push(this.formatJERecord(jeRecord));
      }

      this.logger.info("Processed property for JE", {
        correlationId,
        propertyName: transformedData.propertyName,
        recordCount: financialRecords.length,
        entryId,
      });
    }

    const csvContent = csvLines.join("\n");

    this.logger.info("Journal Entry CSV generation completed", {
      correlationId,
      totalLines: csvLines.length,
      outputSize: Buffer.byteLength(csvContent, "utf8"),
    });

    return csvContent;
  }

  /**
   * Generate JE header row
   */
  private generateJEHeader(): string {
    const headers = [
      "Entry",
      "Date",
      "Sub Name",
      "Subsidiary",
      "acctnumber",
      "internal id",
      "location",
      "account name",
      "Debit",
      "Credit",
      "Comment",
      "Payment Type",
    ];
    return headers.map((h) => `"${h}"`).join(",");
  }

  /**
   * Check if record is statistical (should go in StatJE file)
   */
  private isStatisticalRecord(record: TransformedJERecord): boolean {
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
   * Transform record to JE format
   */
  private transformToJERecord(
    record: TransformedJERecord,
    entryId: string,
    formattedDate: string,
    propertyConfig: PropertyConfig,
  ): JournalEntryRecord {
    // Get account code from mapping (targetCode) or fallback to sourceCode
    const fullAccountCode = record.targetCode || record.sourceCode || "";
    const { prefix, suffix } = this.splitAccountCode(fullAccountCode);

    // Get account name from mapping
    const accountName =
      record.targetDescription || record.sourceDescription || "";

    // Determine debit/credit based on account type and amount sign
    const { debit, credit } = this.calculateDebitCredit(
      prefix,
      record.mappedAmount ?? record.sourceAmount,
    );

    // Get comment from source description
    const comment = record.sourceDescription || "";

    // Payment type only for credit card transactions
    const paymentType = this.getPaymentType(record.paymentMethod);

    return {
      entry: entryId,
      date: formattedDate,
      subName: propertyConfig.subsidiaryFullName,
      subsidiary: propertyConfig.subsidiaryInternalId,
      acctnumber: prefix,
      internalId: suffix,
      location: propertyConfig.locationInternalId,
      accountName,
      debit: debit ? debit.toFixed(2) : "",
      credit: credit ? credit.toFixed(2) : "",
      comment,
      paymentType,
    };
  }

  /**
   * Split account code into prefix and suffix
   * Example: "10006-654" -> { prefix: "10006", suffix: "654" }
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
   * Calculate debit and credit amounts based on account type and sign
   *
   * Account type rules:
   * - Assets (10xxx): Natural debit, positive = debit, negative = credit
   * - Liabilities (20xxx): Natural credit, positive = credit, negative = debit
   * - Revenue (40xxx): Natural credit, positive = credit, negative = debit
   * - Expenses (50xxx-80xxx): Natural debit, positive = debit, negative = credit
   */
  private calculateDebitCredit(
    accountPrefix: string,
    amount: number,
  ): { debit: number; credit: number } {
    const absAmount = Math.abs(amount);
    const accountType = this.getAccountType(accountPrefix);

    // Determine if this should be a debit or credit based on account type and sign
    let isDebit = false;

    switch (accountType) {
      case "asset":
        // Assets: positive = debit (increase), negative = credit (decrease)
        isDebit = amount >= 0;
        break;
      case "liability":
        // Liabilities: positive = credit (increase), negative = debit (decrease)
        isDebit = amount < 0;
        break;
      case "revenue":
        // Revenue: positive = credit (increase revenue), negative = debit (decrease revenue)
        isDebit = amount < 0;
        break;
      case "expense":
        // Expenses: positive = debit (increase expense), negative = credit (decrease expense)
        isDebit = amount >= 0;
        break;
      default:
        // Default: treat negative as credit, positive as debit
        isDebit = amount >= 0;
    }

    return {
      debit: isDebit ? absAmount : 0,
      credit: isDebit ? 0 : absAmount,
    };
  }

  /**
   * Get account type based on account prefix
   */
  private getAccountType(accountPrefix: string): string {
    const firstDigit = accountPrefix.charAt(0);

    if (firstDigit === "1") return "asset";
    if (firstDigit === "2") return "liability";
    if (firstDigit === "4") return "revenue";
    if (["5", "6", "7", "8"].includes(firstDigit)) return "expense";

    return "unknown";
  }

  /**
   * Get payment type for display
   * Only return value for actual credit card transactions
   */
  private getPaymentType(paymentMethod?: string): string {
    if (!paymentMethod) return "";

    const creditCardTypes = ["VISA/MASTER", "AMEX", "DISCOVER"];
    const normalizedMethod = paymentMethod.toUpperCase().trim();

    if (creditCardTypes.some((type) => normalizedMethod.includes(type))) {
      return paymentMethod;
    }

    return "";
  }

  /**
   * Format JE record into CSV line
   */
  private formatJERecord(record: JournalEntryRecord): string {
    return [
      record.entry,
      record.date,
      record.subName,
      record.subsidiary,
      record.acctnumber,
      record.internalId,
      record.location,
      record.accountName,
      record.debit,
      record.credit,
      record.comment,
      record.paymentType,
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
   * Generate entry ID: WR{locationId}{YYYYMMDD}
   */
  private generateEntryId(locationId: string, reportDate: string): string {
    // reportDate is in YYYY-MM-DD format, convert to YYYYMMDD
    const dateStr = reportDate.replace(/-/g, "");
    return `WR${locationId}${dateStr}`;
  }

  /**
   * Format date from YYYY-MM-DD to MM/DD/YYYY
   */
  private formatDate(reportDate: string): string {
    const [year, month, day] = reportDate.split("-");
    return `${month}/${day}/${year}`;
  }
}
