/**
 * @fileoverview JE/StatJE CSV Generator
 *
 * Generates combined Journal Entry and Statistical Journal Entry CSV files
 * in the format required for NetSuite import.
 */

import { Logger } from "../utils/logger";
// Using any types for flexibility with actual data structure
type AnyTransformedData = {
  propertyId: string;
  records: any[];
  processingDate: string;
  totalRecords: number;
};

type AnyTransformedRecord = any;

/**
 * Journal Entry record for financial transactions
 */
interface JournalEntryRecord {
  entry: string;
  date: string;
  subName: string;
  subsidiary: string;
  acctnumber: string;
  internalId: string;
  location: string;
  accountName: string;
  debit: string;
  credit: string;
  comment: string;
  paymentType: string;
}

/**
 * Statistical Journal Entry record for statistical data
 */
interface StatisticalJournalEntryRecord {
  transactionId: string;
  date: string;
  subsidiary: string;
  unitOfMeasureType: string;
  unitOfMeasure: string;
  acctNumber: string;
  internalId: string;
  accountName: string;
  departmentId: string;
  location: string;
  amount: string;
  lineUnits: string;
}

export class JEStatCSVGenerator {
  private logger: Logger;

  constructor() {
    this.logger = new Logger("JEStatCSVGenerator");
  }

  /**
   * Generate combined JE/StatJE CSV content
   */
  async generateCombinedCSV(
    allTransformedData: AnyTransformedData[],
    correlationId: string,
  ): Promise<string> {
    const csvLines: string[] = [];

    this.logger.info("Starting combined JE/StatJE CSV generation", {
      correlationId,
      propertiesCount: allTransformedData.length,
    });

    // Process each property
    for (const transformedData of allTransformedData) {
      if (!transformedData.records || transformedData.records.length === 0) {
        continue;
      }

      // Separate financial and statistical records
      const { financialRecords, statisticalRecords } = this.separateRecordTypes(
        transformedData.records,
      );

      // Generate Journal Entry section for this property
      if (financialRecords.length > 0) {
        const jeLines = this.generateJournalEntrySection(
          financialRecords,
          transformedData,
          correlationId,
        );
        csvLines.push(...jeLines);
      }

      // Generate Statistical Journal Entry section for this property
      if (statisticalRecords.length > 0) {
        const statLines = this.generateStatisticalSection(
          statisticalRecords,
          transformedData,
          correlationId,
        );
        csvLines.push(...statLines);
      }
    }

    const csvContent = csvLines.join("\n");

    this.logger.info("Combined JE/StatJE CSV generation completed", {
      correlationId,
      totalLines: csvLines.length,
      outputSize: csvContent.length,
    });

    return csvContent;
  }

  /**
   * Separate records into financial and statistical types
   */
  private separateRecordTypes(records: AnyTransformedRecord[]): {
    financialRecords: AnyTransformedRecord[];
    statisticalRecords: AnyTransformedRecord[];
  } {
    const financialRecords: AnyTransformedRecord[] = [];
    const statisticalRecords: AnyTransformedRecord[] = [];

    for (const record of records) {
      // Statistical records are those with statistical account codes (90xxx)
      if (this.isStatisticalRecord(record)) {
        statisticalRecords.push(record);
      } else {
        financialRecords.push(record);
      }
    }

    return { financialRecords, statisticalRecords };
  }

  /**
   * Check if a record is statistical based on account code
   */
  private isStatisticalRecord(record: AnyTransformedRecord): boolean {
    const accountCode = record.targetCode || record.sourceCode || "";

    // Statistical accounts start with 90xxx
    if (accountCode.startsWith("90")) {
      return true;
    }

    // Also check source description for statistical indicators
    const description = (record.sourceDescription || "").toLowerCase();
    return (
      description.includes("adr") ||
      description.includes("revpar") ||
      description.includes("occupied") ||
      description.includes("rooms sold") ||
      description.includes("comps") ||
      description.includes("oos") ||
      description.includes("out of service") ||
      description.includes("statistical")
    );
  }

  /**
   * Generate Journal Entry section
   */
  private generateJournalEntrySection(
    records: AnyTransformedRecord[],
    transformedData: AnyTransformedData,
    _correlationId: string,
  ): string[] {
    const lines: string[] = [];

    // Add JE header if this is the first section
    lines.push(this.generateJEHeader());

    const entryId = this.generateEntryId(transformedData.propertyId);
    const date = this.formatDate(new Date());
    const location = this.getLocationId(transformedData.propertyId);

    for (const record of records) {
      const jeRecord = this.transformToJERecord(
        record,
        entryId,
        date,
        location,
        transformedData.propertyId,
      );
      lines.push(this.formatJERecord(jeRecord));
    }

    return lines;
  }

  /**
   * Generate Statistical Journal Entry section
   */
  private generateStatisticalSection(
    records: AnyTransformedRecord[],
    transformedData: AnyTransformedData,
    _correlationId: string,
  ): string[] {
    const lines: string[] = [];

    // Add StatJE header
    lines.push(this.generateStatJEHeader());

    const transactionId = this.generateTransactionId(
      transformedData.propertyId,
    );
    const date = this.formatDate(new Date());
    const location = this.getLocationId(transformedData.propertyId);

    for (const record of records) {
      const statRecord = this.transformToStatJERecord(
        record,
        transactionId,
        date,
        location,
        transformedData.propertyId,
      );
      lines.push(this.formatStatJERecord(statRecord));
    }

    return lines;
  }

  /**
   * Generate JE header
   */
  private generateJEHeader(): string {
    return '"Entry","Date","Sub Name","Subsidiary","acctnumber","internal id","location","account name","Debit","Credit","Comment","Payment Type"';
  }

  /**
   * Generate StatJE header
   */
  private generateStatJEHeader(): string {
    return '"Transaction ID","Date","Subsidiary","Unit of Measure Type","Unit of Measure","acctNumber","internal id","account name","department id","location","Amount","Line Units"';
  }

  /**
   * Transform record to JE format
   */
  private transformToJERecord(
    record: AnyTransformedRecord,
    entryId: string,
    date: string,
    location: string,
    _propertyId: string,
  ): JournalEntryRecord {
    const amount = Math.abs(record.mappedAmount || record.sourceAmount || 0);
    const isCredit = (record.mappedAmount || record.sourceAmount || 0) < 0;

    return {
      entry: entryId,
      date: date,
      subName:
        "Parent Company : Warren Family Hotels : Warren Resort Hotels, Inc.",
      subsidiary: "5",
      acctnumber: this.extractAccountNumber(
        record.targetCode || record.sourceCode || "",
      ),
      internalId: this.extractInternalId(
        record.targetCode || record.sourceCode || "",
      ),
      location: location,
      accountName: record.targetDescription || record.sourceDescription || "",
      debit: isCredit ? "" : amount.toFixed(2),
      credit: isCredit ? amount.toFixed(2) : "",
      comment: this.generateComment(record),
      paymentType: record.paymentMethod || "",
    };
  }

  /**
   * Transform record to StatJE format
   */
  private transformToStatJERecord(
    record: AnyTransformedRecord,
    transactionId: string,
    date: string,
    location: string,
    _propertyId: string,
  ): StatisticalJournalEntryRecord {
    const amount = Math.abs(record.mappedAmount || record.sourceAmount || 0);

    return {
      transactionId: transactionId,
      date: date,
      subsidiary:
        "Parent Company : Warren Family Hotels : Warren Resort Hotels, Inc.",
      unitOfMeasureType: "statistical",
      unitOfMeasure: "Each",
      acctNumber: this.extractAccountNumber(
        record.targetCode || record.sourceCode || "",
      ),
      internalId: this.extractInternalId(
        record.targetCode || record.sourceCode || "",
      ),
      accountName: record.targetDescription || record.sourceDescription || "",
      departmentId: "1",
      location: location,
      amount: amount.toFixed(2),
      lineUnits: "EA",
    };
  }

  /**
   * Format JE record as CSV line
   */
  private formatJERecord(record: JournalEntryRecord): string {
    return [
      `"${record.entry}"`,
      `"${record.date}"`,
      `"${record.subName}"`,
      `"${record.subsidiary}"`,
      `"${record.acctnumber}"`,
      `"${record.internalId}"`,
      `"${record.location}"`,
      `"${record.accountName}"`,
      `"${record.debit}"`,
      `"${record.credit}"`,
      `"${record.comment}"`,
      `"${record.paymentType}"`,
    ].join(",");
  }

  /**
   * Format StatJE record as CSV line
   */
  private formatStatJERecord(record: StatisticalJournalEntryRecord): string {
    return [
      `"${record.transactionId}"`,
      `"${record.date}"`,
      `"${record.subsidiary}"`,
      `"${record.unitOfMeasureType}"`,
      `"${record.unitOfMeasure}"`,
      `"${record.acctNumber}"`,
      `"${record.internalId}"`,
      `"${record.accountName}"`,
      `"${record.departmentId}"`,
      `"${record.location}"`,
      `"${record.amount}"`,
      `"${record.lineUnits}"`,
    ].join(",");
  }

  /**
   * Extract account number from code (e.g., "90001-418" -> "90001")
   */
  private extractAccountNumber(code: string): string {
    const match = code.match(/^(\d+)/);
    return match ? match[1] : code;
  }

  /**
   * Extract internal ID from code (e.g., "90001-418" -> "418")
   */
  private extractInternalId(code: string): string {
    const match = code.match(/-(\d+)$/);
    return match ? match[1] : "";
  }

  /**
   * Generate entry ID based on property
   */
  private generateEntryId(_propertyId: string): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    return `WR${dateStr}`;
  }

  /**
   * Generate transaction ID for statistical entries
   */
  private generateTransactionId(_propertyId: string): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(5, 10).replace("-", "/");
    return `${dateStr}/${date.getFullYear()} WRH`;
  }

  /**
   * Get location ID based on property
   */
  private getLocationId(propertyId: string): string {
    // Map property names to location IDs
    const locationMap: Record<string, string> = {
      "THE BARD'S INN HOTEL": "4",
      "Crown City Inn": "4",
      "test-property": "4",
    };

    return locationMap[propertyId] || "4";
  }

  /**
   * Format date as MM/DD/YYYY
   */
  private formatDate(date: Date): string {
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }

  /**
   * Generate comment for the record
   */
  private generateComment(record: AnyTransformedRecord): string {
    if (record.paymentMethod) {
      return record.sourceDescription || "";
    }
    return record.sourceDescription || "";
  }
}
