import { describe, it, expect } from "vitest";
import { CreditCardProcessor } from "./credit-card-processor";
import type { PropertyConfig } from "../config/property-config";

describe("CreditCardProcessor", () => {
  const mockPropertyConfig: PropertyConfig = {
    propertyName: "TEST PROPERTY",
    locationInternalId: "24",
    subsidiaryInternalId: "26",
    subsidiaryFullName: "TEST PROPERTY INC",
    locationName: "Test Property",
    creditCardDepositAccount: "10070-696",
  };

  describe("extractCreditCardTotals", () => {
    it("should extract VISA/MASTER totals", () => {
      const processor = new CreditCardProcessor();
      const lines = [
        { sourceCode: "VISA/MASTER", sourceAmount: -1000 },
        { sourceCode: "RC", sourceAmount: 500 },
      ];

      const totals = processor.extractCreditCardTotals(lines);

      expect(totals.visaMaster).toBe(1000);
      expect(totals.amex).toBe(0);
      expect(totals.discover).toBe(0);
    });

    it("should extract AMEX totals", () => {
      const processor = new CreditCardProcessor();
      const lines = [
        { sourceCode: "AMEX", sourceAmount: -500 },
        { sourceCode: "RC", sourceAmount: 500 },
      ];

      const totals = processor.extractCreditCardTotals(lines);

      expect(totals.visaMaster).toBe(0);
      expect(totals.amex).toBe(500);
      expect(totals.discover).toBe(0);
    });

    it("should extract DISCOVER totals", () => {
      const processor = new CreditCardProcessor();
      const lines = [
        { sourceCode: "DISCOVER", sourceAmount: -250 },
        { sourceCode: "RC", sourceAmount: 500 },
      ];

      const totals = processor.extractCreditCardTotals(lines);

      expect(totals.visaMaster).toBe(0);
      expect(totals.amex).toBe(0);
      expect(totals.discover).toBe(250);
    });

    it("should extract all credit card types", () => {
      const processor = new CreditCardProcessor();
      const lines = [
        { sourceCode: "VISA/MASTER", sourceAmount: -1000 },
        { sourceCode: "AMEX", sourceAmount: -500 },
        { sourceCode: "DISCOVER", sourceAmount: -250 },
        { sourceCode: "RC", sourceAmount: 1750 },
      ];

      const totals = processor.extractCreditCardTotals(lines);

      expect(totals.visaMaster).toBe(1000);
      expect(totals.amex).toBe(500);
      expect(totals.discover).toBe(250);
    });

    it("should handle empty lines", () => {
      const processor = new CreditCardProcessor();
      const lines: Array<{ sourceCode: string; sourceAmount: number }> = [];

      const totals = processor.extractCreditCardTotals(lines);

      expect(totals.visaMaster).toBe(0);
      expect(totals.amex).toBe(0);
      expect(totals.discover).toBe(0);
    });

    it("should use absolute values for negative amounts", () => {
      const processor = new CreditCardProcessor();
      const lines = [{ sourceCode: "VISA/MASTER", sourceAmount: -1234.56 }];

      const totals = processor.extractCreditCardTotals(lines);

      expect(totals.visaMaster).toBe(1234.56);
    });
  });

  describe("generateDepositRecords", () => {
    it("should combine VISA/MASTER and DISCOVER into one deposit", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 1000,
        amex: 0,
        discover: 250,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records).toHaveLength(1);
      expect(records[0].sourceCode).toBe("VISA/MASTER");
      expect(records[0].sourceAmount).toBe(1250);
      expect(records[0].targetCode).toBe("10070-696");
      expect(records[0].sourceDescription).toBe(
        "VISA/MASTER Credit Card Deposit",
      );
    });

    it("should generate separate AMEX deposit", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 0,
        amex: 500,
        discover: 0,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records).toHaveLength(1);
      expect(records[0].sourceCode).toBe("AMEX");
      expect(records[0].sourceAmount).toBe(500);
      expect(records[0].targetCode).toBe("10070-696");
      expect(records[0].sourceDescription).toBe("AMEX Credit Card Deposit");
    });

    it("should generate both deposits when all cards are present", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 1000,
        amex: 500,
        discover: 250,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records).toHaveLength(2);

      // Check combined VISA/MASTER + DISCOVER
      const visaDiscoverDeposit = records.find(
        (r) => r.sourceCode === "VISA/MASTER",
      );
      expect(visaDiscoverDeposit).toBeDefined();
      expect(visaDiscoverDeposit?.sourceAmount).toBe(1250);

      // Check AMEX
      const amexDeposit = records.find((r) => r.sourceCode === "AMEX");
      expect(amexDeposit).toBeDefined();
      expect(amexDeposit?.sourceAmount).toBe(500);
    });

    it("should not generate deposits for zero totals", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 0,
        amex: 0,
        discover: 0,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records).toHaveLength(0);
    });

    it("should handle VISA/MASTER only", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 1500,
        amex: 0,
        discover: 0,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records).toHaveLength(1);
      expect(records[0].sourceCode).toBe("VISA/MASTER");
      expect(records[0].sourceAmount).toBe(1500);
    });

    it("should handle DISCOVER only", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 0,
        amex: 0,
        discover: 300,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records).toHaveLength(1);
      expect(records[0].sourceCode).toBe("VISA/MASTER");
      expect(records[0].sourceAmount).toBe(300);
    });

    it("should use correct account code from property config", () => {
      const processor = new CreditCardProcessor();
      const customConfig: PropertyConfig = {
        ...mockPropertyConfig,
        creditCardDepositAccount: "99999-999",
      };
      const totals = {
        visaMaster: 1000,
        amex: 500,
        discover: 0,
      };

      const records = processor.generateDepositRecords(totals, customConfig);

      expect(records).toHaveLength(2);
      expect(records[0].targetCode).toBe("99999-999");
      expect(records[1].targetCode).toBe("99999-999");
    });

    it("should mark deposits with isCreditCardDeposit flag", () => {
      const processor = new CreditCardProcessor();
      const totals = {
        visaMaster: 1000,
        amex: 500,
        discover: 250,
      };

      const records = processor.generateDepositRecords(
        totals,
        mockPropertyConfig,
      );

      expect(records.every((r) => r.isCreditCardDeposit === true)).toBe(true);
    });
  });

  describe("removeIndividualCreditCardTransactions", () => {
    it("should remove VISA/MASTER transactions", () => {
      const processor = new CreditCardProcessor();
      const records = [
        {
          sourceCode: "VISA/MASTER",
          sourceAmount: -1000,
          targetCode: "40110-634",
        },
        { sourceCode: "RC", sourceAmount: 1000, targetCode: "40110-634" },
      ];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].sourceCode).toBe("RC");
    });

    it("should remove AMEX transactions", () => {
      const processor = new CreditCardProcessor();
      const records = [
        { sourceCode: "AMEX", sourceAmount: -500, targetCode: "40110-634" },
        { sourceCode: "RC", sourceAmount: 500, targetCode: "40110-634" },
      ];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].sourceCode).toBe("RC");
    });

    it("should remove DISCOVER transactions", () => {
      const processor = new CreditCardProcessor();
      const records = [
        { sourceCode: "DISCOVER", sourceAmount: -250, targetCode: "40110-634" },
        { sourceCode: "RC", sourceAmount: 250, targetCode: "40110-634" },
      ];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].sourceCode).toBe("RC");
    });

    it("should remove all credit card transaction types", () => {
      const processor = new CreditCardProcessor();
      const records = [
        {
          sourceCode: "VISA/MASTER",
          sourceAmount: -1000,
          targetCode: "40110-634",
        },
        { sourceCode: "AMEX", sourceAmount: -500, targetCode: "40110-634" },
        { sourceCode: "DISCOVER", sourceAmount: -250, targetCode: "40110-634" },
        { sourceCode: "RC", sourceAmount: 1750, targetCode: "40110-634" },
      ];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].sourceCode).toBe("RC");
    });

    it("should preserve non-credit-card records", () => {
      const processor = new CreditCardProcessor();
      const records = [
        { sourceCode: "RC", sourceAmount: 1000, targetCode: "40110-634" },
        { sourceCode: "RD", sourceAmount: -50, targetCode: "40110-634" },
        { sourceCode: "9", sourceAmount: 100, targetCode: "20103-662" },
      ];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(3);
      expect(filtered.map((r) => r.sourceCode)).toEqual(["RC", "RD", "9"]);
    });

    it("should handle empty records array", () => {
      const processor = new CreditCardProcessor();
      const records: Array<{
        sourceCode: string;
        sourceAmount: number;
        targetCode: string;
      }> = [];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(0);
    });

    it('should remove records with "Payment Method Total" description', () => {
      const processor = new CreditCardProcessor();
      const records: Array<{
        sourceCode: string;
        sourceAmount: number;
        sourceDescription?: string;
      }> = [
        {
          sourceCode: "VISA/MASTER",
          sourceAmount: -1000,
          sourceDescription: "Payment Method Total",
        },
        { sourceCode: "RC", sourceAmount: 150 },
      ];

      const filtered =
        processor.removeIndividualCreditCardTransactions(records);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].sourceCode).toBe("RC");
    });
  });

  describe("processCreditCards", () => {
    it("should process credit cards end-to-end", () => {
      const processor = new CreditCardProcessor();
      const records = [
        { sourceCode: "VISA/MASTER", sourceAmount: -1000, targetCode: "1001" },
        { sourceCode: "AMEX", sourceAmount: -500, targetCode: "1002" },
        { sourceCode: "RC", sourceAmount: 150, targetCode: "4010" },
        { sourceCode: "VS", sourceAmount: 50, targetCode: "1001" }, // Individual transaction
      ];

      const result = processor.processCreditCards(records, mockPropertyConfig);

      // Should have RC record + 2 deposit records (VISA/MASTER+DISCOVER, AMEX)
      expect(result.length).toBe(3);
      // Should filter out VS transaction
      expect(result.find((r: any) => r.sourceCode === "VS")).toBeUndefined();
      // Should have RC record
      expect(result.find((r: any) => r.sourceCode === "RC")).toBeDefined();
    });

    it("should handle records with no credit cards", () => {
      const processor = new CreditCardProcessor();
      const records = [
        { sourceCode: "RC", sourceAmount: 150, targetCode: "4010" },
        { sourceCode: "RD", sourceAmount: -10, targetCode: "4020" },
      ];

      const result = processor.processCreditCards(records, mockPropertyConfig);

      // Should have original 2 records + 0 deposit records (no credit cards)
      expect(result.length).toBe(2);
    });
  });
});
