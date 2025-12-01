/**
 * @fileoverview Credit Card Deposit Processor
 *
 * Processes credit card payment summaries from first-page totals and generates
 * deposit records for NetSuite import. Combines VISA/MASTER + DISCOVER into one
 * deposit, keeps AMEX separate.
 */

import { createCorrelatedLogger } from "../utils/logger";
import type { PropertyConfig } from "../config/property-config";

/**
 * Credit card payment method totals extracted from first page
 */
export interface CreditCardTotals {
  visaMaster: number;
  amex: number;
  discover: number;
}

/**
 * Credit card deposit record for JE file
 */
export interface CreditCardDepositRecord {
  sourceCode: string;
  sourceDescription: string;
  sourceAmount: number;
  targetCode: string;
  targetDescription: string;
  mappedAmount: number;
  paymentMethod: string;
  isCreditCardDeposit: true;
}

/**
 * Credit Card Processor
 *
 * Handles credit card deposit record generation from first-page summary totals
 */
export class CreditCardProcessor {
  private logger = createCorrelatedLogger("CreditCardProcessor");

  /**
   * Extract credit card totals from parsed account lines
   *
   * @param records - Parsed account line records
   * @returns Credit card totals by type
   */
  extractCreditCardTotals(records: any[]): CreditCardTotals {
    const totals: CreditCardTotals = {
      visaMaster: 0,
      amex: 0,
      discover: 0,
    };

    for (const record of records) {
      const sourceCode = (record.sourceCode || "").toUpperCase().trim();
      const amount = Math.abs(record.sourceAmount || 0);

      // Match payment method summary lines from first page
      if (sourceCode === "VISA/MASTER" || sourceCode === "VISA") {
        totals.visaMaster = amount;
      } else if (sourceCode === "AMEX") {
        totals.amex = amount;
      } else if (sourceCode === "DISCOVER") {
        totals.discover = amount;
      }
    }

    this.logger.info("Extracted credit card totals", {
      visaMaster: totals.visaMaster,
      amex: totals.amex,
      discover: totals.discover,
      totalCards: totals.visaMaster + totals.amex + totals.discover,
    });

    return totals;
  }

  /**
   * Generate credit card deposit records
   *
   * Creates two deposit records:
   * 1. VISA/MASTER + DISCOVER combined (they deposit together)
   * 2. AMEX separate
   *
   * @param totals - Credit card totals from first page
   * @param propertyConfig - Property configuration for deposit account
   * @returns Array of deposit records
   */
  generateDepositRecords(
    totals: CreditCardTotals,
    propertyConfig: PropertyConfig,
  ): CreditCardDepositRecord[] {
    const deposits: CreditCardDepositRecord[] = [];

    // Combined VISA/MASTER + DISCOVER deposit
    const combinedAmount = totals.visaMaster + totals.discover;
    if (combinedAmount > 0) {
      deposits.push({
        sourceCode: "VISA/MASTER",
        sourceDescription: "VISA/MASTER Credit Card Deposit",
        sourceAmount: combinedAmount,
        targetCode: propertyConfig.creditCardDepositAccount,
        targetDescription: "Cash in Bank : Credit Card Deposits",
        mappedAmount: combinedAmount,
        paymentMethod: "VISA/MASTER",
        isCreditCardDeposit: true,
      });

      this.logger.info("Created combined VISA/MASTER + DISCOVER deposit", {
        visaMaster: totals.visaMaster,
        discover: totals.discover,
        combined: combinedAmount,
        account: propertyConfig.creditCardDepositAccount,
      });
    }

    // Separate AMEX deposit
    if (totals.amex > 0) {
      deposits.push({
        sourceCode: "AMEX",
        sourceDescription: "AMEX Credit Card Deposit",
        sourceAmount: totals.amex,
        targetCode: propertyConfig.creditCardDepositAccount,
        targetDescription: "Cash in Bank : Credit Card Deposits",
        mappedAmount: totals.amex,
        paymentMethod: "AMEX",
        isCreditCardDeposit: true,
      });

      this.logger.info("Created AMEX deposit", {
        amex: totals.amex,
        account: propertyConfig.creditCardDepositAccount,
      });
    }

    return deposits;
  }

  /**
   * Remove individual credit card transaction lines from records
   * Since we're using first-page totals, we should remove individual transaction lines
   * to avoid duplication
   *
   * @param records - All parsed records
   * @returns Filtered records without individual credit card transactions
   */
  removeIndividualCreditCardTransactions(records: any[]): any[] {
    return records.filter((record) => {
      const sourceCode = (record.sourceCode || "").toUpperCase().trim();

      // Remove any transaction codes that indicate credit card processing
      const creditCardCodes = [
        "VISA/MASTER",
        "VISA",
        "MASTER",
        "MASTERCARD",
        "AMEX",
        "DISCOVER",
        "VS", // Visa transaction code
        "AV", // Amex transaction code
        "AX", // Amex transaction code
        "7V", // Visa/MC transaction code
        "DI", // Discover transaction code
      ];

      // Check if sourceCode matches any credit card code
      const isCreditCardTransaction = creditCardCodes.some(
        (code) => sourceCode === code || sourceCode.startsWith(code),
      );

      if (isCreditCardTransaction) {
        this.logger.debug("Removing individual credit card transaction", {
          sourceCode,
          description: record.sourceDescription,
          amount: record.sourceAmount,
        });
        return false;
      }

      return true;
    });
  }

  /**
   * Process credit card records for a property
   *
   * Main entry point that:
   * 1. Extracts credit card totals from first page
   * 2. Removes individual credit card transaction lines
   * 3. Generates deposit records
   * 4. Returns updated records with deposits
   *
   * @param records - All parsed records for the property
   * @param propertyConfig - Property configuration
   * @returns Updated records with credit card deposits
   */
  processCreditCards(records: any[], propertyConfig: PropertyConfig): any[] {
    this.logger.info("Processing credit cards for property", {
      propertyName: propertyConfig.propertyName,
      totalRecords: records.length,
    });

    // Extract first-page totals
    const totals = this.extractCreditCardTotals(records);

    // Remove individual credit card transactions
    const filteredRecords =
      this.removeIndividualCreditCardTransactions(records);

    this.logger.info("Removed individual credit card transactions", {
      originalCount: records.length,
      filteredCount: filteredRecords.length,
      removed: records.length - filteredRecords.length,
    });

    // Generate deposit records
    const depositRecords = this.generateDepositRecords(totals, propertyConfig);

    this.logger.info("Generated credit card deposit records", {
      depositCount: depositRecords.length,
      totalDeposit: depositRecords.reduce((sum, d) => sum + d.mappedAmount, 0),
    });

    // Return filtered records + deposits
    return [...filteredRecords, ...depositRecords];
  }
}
