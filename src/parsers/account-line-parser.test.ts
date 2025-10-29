import { describe, it, expect } from "vitest";
import { AccountLineParser } from "./account-line-parser";

describe("AccountLineParser", () => {
  describe("Embedded Transaction Code Parsing", () => {
    it("should extract embedded transaction codes from hotel PDF lines", () => {
      const parser = new AccountLineParser();
      const pdfText = `
RCROOM CHRG REVENUE50$10,107.15$231,259.82$202,397.53
RDRATE DISCOUNT REV10($157.92)($2,920.70)($3,218.80)
AXPAYMENT AMEX6($2,486.57)($19,441.87)($22,920.91)
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        sourceCode: "RC",
        description: "ROOM CHRG REVENUE",
        amount: 10107.15,
        paymentMethod: undefined,
        originalLine: "RCROOM CHRG REVENUE50$10,107.15$231,259.82$202,397.53",
        lineNumber: 2,
      });
      expect(result[1]).toEqual({
        sourceCode: "RD",
        description: "RATE DISCOUNT REV",
        amount: -157.92,
        paymentMethod: undefined,
        originalLine: "RDRATE DISCOUNT REV10($157.92)($2,920.70)($3,218.80)",
        lineNumber: 3,
      });
      expect(result[2]).toEqual({
        sourceCode: "AX",
        description: "PAYMENT AMEX",
        amount: -2486.57,
        paymentMethod: "AMEX",
        originalLine: "AXPAYMENT AMEX6($2,486.57)($19,441.87)($22,920.91)",
        lineNumber: 4,
      });
    });

    it("should handle various embedded code formats", () => {
      const parser = new AccountLineParser({ includeZeroAmounts: true });
      const pdfText = `
6DBAL FWD TRANS DEBIT0$0.00$0.00$0.00
7AADV DEP AMEX0$0.00($775.20)($728.32)
72ADV DEP CONTROL1$1,056.00$30,534.99
MSMISC. CHARGE0$0.00$27.25$28.75
91STATE LODGING TAX49$147.20$3,002.56
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(5);
      expect(result[0].sourceCode).toBe("6D");
      expect(result[1].sourceCode).toBe("7A");
      expect(result[2].sourceCode).toBe("72");
      expect(result[3].sourceCode).toBe("MS");
      expect(result[4].sourceCode).toBe("91");
    });

    it("should handle GL/CL account lines", () => {
      const parser = new AccountLineParser({
        validSourceCodes: new Set(["60", "71"]),
      });
      const pdfText = `
GL ROOM REV60$9,949.23$228,339.12$199,178.73
CL ADV DEP CTRL71ADV DEP BAL FWD1($7,095.60)$0.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      // Should extract just the short posting code from whitelist
      expect(result[0].sourceCode).toBe("60");
      expect(result[0].description).toContain("GL ROOM REV");
      expect(result[1].sourceCode).toBe("71");
      expect(result[1].description).toContain("CL ADV DEP CTRL");
    });
  });

  describe("Payment Method Line Parsing", () => {
    it("should parse payment method lines with parentheses amounts", () => {
      const parser = new AccountLineParser({ includeZeroAmounts: true });
      const pdfText = `
VISA/MASTER($13,616.46)($216,739.79)
AMEX($2,486.57)($20,217.07)
CASH$0.00($1,291.75)
DISCOVER$0.00($1,321.26)
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        sourceCode: "VISA/MASTER",
        description: "Payment Method Total",
        amount: -13616.46,
        paymentMethod: undefined, // Summary lines don't have paymentMethod to avoid double-counting
        originalLine: "VISA/MASTER($13,616.46)($216,739.79)",
        lineNumber: 2,
      });
      expect(result[1].sourceCode).toBe("AMEX");
      expect(result[2].sourceCode).toBe("CASH");
      expect(result[3].sourceCode).toBe("DISCOVER");
    });
  });

  describe("Summary Line Parsing", () => {
    it("should parse summary lines", () => {
      const parser = new AccountLineParser();
      const pdfText = `
Total Rm Rev$9,949.23$228,339.12
ADR$216.29$221.90$222.55
RevPar$110.55$181.22$158.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        sourceCode: "Total Rm Rev",
        description: "Summary Total",
        amount: 9949.23,
        paymentMethod: undefined,
        originalLine: "Total Rm Rev$9,949.23$228,339.12",
        lineNumber: 2,
      });
      expect(result[1].sourceCode).toBe("ADR");
      expect(result[2].sourceCode).toBe("RevPar");
    });
  });

  describe("Statistical Line Parsing", () => {
    it("should parse statistical lines", () => {
      const parser = new AccountLineParser();
      const pdfText = `
Occupied461,02689714.38
No Show0200.00218
Comps013-66.67235
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        sourceCode: "Occupied",
        description: "Statistical Data",
        amount: 461,
        paymentMethod: undefined,
        originalLine: "Occupied461,02689714.38",
        lineNumber: 2,
      });
      expect(result[1].sourceCode).toBe("No Show");
      expect(result[2].sourceCode).toBe("Comps");
    });
  });

  describe("Configuration Options", () => {
    it("should skip lines below minimum amount threshold", () => {
      const parser = new AccountLineParser({ minimumAmount: 100.0 });
      const pdfText = `
RCROOM CHRG REVENUE1$50.00$100.00
RDRATE DISCOUNT REV2($200.00)($300.00)
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(1);
      expect(result[0].sourceCode).toBe("RD");
      expect(result[0].amount).toBe(-200.0);
    });

    it("should include zero amounts when configured", () => {
      const parser = new AccountLineParser({
        includeZeroAmounts: true,
        minimumAmount: 0,
      });
      const pdfText = `
6DBAL FWD TRANS DEBIT0$0.00$0.00
RCROOM CHRG REVENUE1$50.00$100.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(0.0);
      expect(result[1].amount).toBe(50.0);
    });
  });

  describe("Payment Method Detection", () => {
    it("should detect payment methods in embedded codes", () => {
      const parser = new AccountLineParser({ includeZeroAmounts: true });
      const pdfText = `
AXPAYMENT AMEX6($2,486.57)
VSPAYMENT VISA/MC27($11,818.16)
DCPAYMENT DISCOVER0$0.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(3);
      expect(result[0].paymentMethod).toBe("AMEX");
      expect(result[1].paymentMethod).toBe("VISA");
      expect(result[2].paymentMethod).toBe("DISCOVER");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty input", () => {
      const parser = new AccountLineParser();
      const result = parser.parseAccountLines("");

      expect(result).toHaveLength(0);
    });

    it("should handle input with no valid account lines", () => {
      const parser = new AccountLineParser();
      const pdfText = `
This is just random text
No account codes here
Just some narrative content
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(0);
    });

    it("should handle malformed amounts gracefully", () => {
      const parser = new AccountLineParser({ includeZeroAmounts: true });
      const pdfText = `
RCROOM CHRG REVENUE1$abc.def$100.00
RDRATE DISCOUNT REV2$100.00$200.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(0); // Malformed amount becomes 0
      expect(result[1].amount).toBe(100.0);
    });
  });

  describe("Whitelist Validation", () => {
    it("should extract codes from actual mapping file whitelist", () => {
      // Real codes from the mapping file
      const parser = new AccountLineParser({
        validSourceCodes: new Set([
          "9",
          "91",
          "92",
          "P",
          "RC",
          "RD",
          "DBA",
          "71",
        ]),
      });
      const pdfText = `
GL ROOM TAX REV9CITY LODGING TAX49$980.63
GL ROOM TAX REV91STATE TAX4$147.20
GL ROOM TAX REV92STATE TAX4$1.20
RCROOM CHRG REVENUE50$10,107.15
RDRATE DISCOUNT REV10($157.92)
CL ADV DEP CTRL71ADV DEP BAL FWD1($7,095.60)
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(6);
      // Should extract "9" from "9CITY" (tries "9CITY", "9CIT", "9CI", "9C", "9" - only "9" is valid)
      expect(result[0].sourceCode).toBe("9");
      // Should extract "91" from "91STATE" (tries "91STATE", "91STAT", etc. - "91" is valid)
      expect(result[1].sourceCode).toBe("91");
      // Should extract "92" from "92STATE"
      expect(result[2].sourceCode).toBe("92");
      // Should extract "RC" from "RCROOM"
      expect(result[3].sourceCode).toBe("RC");
      // Should extract "RD" from "RDRATE"
      expect(result[4].sourceCode).toBe("RD");
      // Should extract "71" from "71ADV"
      expect(result[5].sourceCode).toBe("71");
    });

    it("should fallback to 1-2 char extraction when no whitelist provided", () => {
      const parser = new AccountLineParser();
      const pdfText = `
GL ROOM TAX REV9CITY TAX29$786.57
      `;

      const result = parser.parseAccountLines(pdfText);

      // Without whitelist, should extract first 1-2 chars
      expect(result).toHaveLength(1);
      expect(result[0].sourceCode).toBe("9C");
    });

    it("should return null when no valid code found in whitelist", () => {
      const parser = new AccountLineParser({
        validSourceCodes: new Set(["RC", "RD", "P"]),
      });
      const pdfText = `
GL ROOM TAX REV9CITY TAX29$786.57
      `;

      const result = parser.parseAccountLines(pdfText);

      // Should skip line because "9", "9C", "9CI", etc. are not in whitelist
      expect(result).toHaveLength(0);
    });

    it("should handle section-aware parsing with whitelist", () => {
      const parser = new AccountLineParser({
        validSourceCodes: new Set(["9", "71", "GL ROOM TAX REV"]),
      });
      const pdfText = `
Detail Listing
GL ROOM TAX REV9CITY TAX29$786.57
Detail Listing Summary
GL ROOM TAX REV29$786.57
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      // Detail Listing: extract posting code
      expect(result[0].sourceCode).toBe("9");
      // Detail Listing Summary: use full category
      expect(result[1].sourceCode).toBe("GL ROOM TAX REV");
    });
  });

  describe("Comprehensive Integration Test", () => {
    it("should handle mixed line types from real PDF content", () => {
      const parser = new AccountLineParser({
        includeZeroAmounts: true,
        validSourceCodes: new Set(["RC", "RD", "60", "71"]),
      });
      const pdfText = `
RCROOM CHRG REVENUE50$10,107.15$231,259.82
RDRATE DISCOUNT REV10($157.92)($2,920.70)
VISA/MASTER($13,616.46)($216,739.79)
AMEX($2,486.57)($20,217.07)
Total Rm Rev$9,949.23$228,339.12
ADR$216.29$221.90$222.55
Occupied461,02689714.38
GL ROOM REV60$9,949.23$228,339.12
CL ADV DEP CTRL71ADV DEP BAL FWD1($7,095.60)
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result.length).toBeGreaterThanOrEqual(8);

      // Check we have embedded codes
      const embeddedCodes = result.filter((r) =>
        /^[A-Z0-9]{1,2}$/.test(r.sourceCode),
      );
      expect(embeddedCodes.length).toBeGreaterThan(0);

      // Check we have payment methods
      const paymentMethods = result.filter(
        (r) => r.description === "Payment Method Total",
      );
      expect(paymentMethods.length).toBeGreaterThan(0);

      // Check we have summaries
      const summaries = result.filter((r) => r.description === "Summary Total");
      expect(summaries.length).toBeGreaterThan(0);

      // Check we have GL/CL lines (now returns just the code, with category in description)
      const glClLines = result.filter(
        (r) => r.description.includes("GL ") || r.description.includes("CL "),
      );
      expect(glClLines.length).toBeGreaterThan(0);
    });
  });

  describe("Utility Functions", () => {
    it("should provide parsing statistics", () => {
      const parser = new AccountLineParser({ includeZeroAmounts: true });
      const pdfText = `
RCROOM CHRG REVENUE50$10,107.15$231,259.82
VISA/MASTER($13,616.46)($216,739.79)
AMEX($2,486.57)($20,217.07)
Total Rm Rev$9,949.23$228,339.12
Some random text that won't parse
Another unparseable line
      `;

      const stats = parser.getParsingStats(pdfText);

      expect(stats.totalLines).toBe(8); // Including empty lines
      expect(stats.parsedLines).toBe(4); // Only valid account lines
      expect(stats.paymentMethodLines).toBe(0); // Summary lines no longer have paymentMethod set
      expect(stats.totalAmount).toBeCloseTo(3953.35); // Sum of all amounts: 10107.15 + (-13616.46) + (-2486.57) + 9949.23
      expect(stats.paymentMethodAmount).toBeCloseTo(0); // No payment method lines since summaries don't have paymentMethod
    });

    it("should group payment methods correctly", () => {
      const parser = new AccountLineParser({
        combinePaymentMethods: true,
        paymentMethodGroups: {
          "Credit Cards": ["VISA/MASTER", "AMEX"],
          Other: ["DISCOVER"],
        },
      });

      const accountLines = [
        {
          sourceCode: "VISA/MASTER",
          description: "Payment Method Total",
          amount: -1000,
          paymentMethod: "VISA/MASTER",
          originalLine: "VISA/MASTER($1000)",
          lineNumber: 1,
        },
        {
          sourceCode: "AMEX",
          description: "Payment Method Total",
          amount: -500,
          paymentMethod: "AMEX",
          originalLine: "AMEX($500)",
          lineNumber: 2,
        },
        {
          sourceCode: "DISCOVER",
          description: "Payment Method Total",
          amount: -200,
          paymentMethod: "DISCOVER",
          originalLine: "DISCOVER($200)",
          lineNumber: 3,
        },
        {
          sourceCode: "CASH",
          description: "Payment Method Total",
          amount: -100,
          paymentMethod: "CASH",
          originalLine: "CASH($100)",
          lineNumber: 4,
        },
      ];

      const groups = parser.groupPaymentMethods(accountLines);

      expect(groups).toHaveLength(3); // Credit Cards, Other, CASH

      const creditCardGroup = groups.find(
        (g) => g.groupName === "Credit Cards",
      );
      expect(creditCardGroup).toBeDefined();
      expect(creditCardGroup!.totalAmount).toBe(-1500);
      expect(creditCardGroup!.accountLines).toHaveLength(2);

      const otherGroup = groups.find((g) => g.groupName === "Other");
      expect(otherGroup).toBeDefined();
      expect(otherGroup!.totalAmount).toBe(-200);

      const cashGroup = groups.find((g) => g.groupName === "CASH");
      expect(cashGroup).toBeDefined();
      expect(cashGroup!.totalAmount).toBe(-100);
    });

    it("should handle consolidation with no payment method grouping", () => {
      const parser = new AccountLineParser({ combinePaymentMethods: false });
      const pdfText = `
RCROOM CHRG REVENUE50$10,107.15
VISA/MASTER($13,616.46)
AMEX($2,486.57)
      `;

      const consolidated = parser.getConsolidatedAccountLines(pdfText);
      const individual = parser.parseAccountLines(pdfText);

      // Should be the same when consolidation is disabled
      expect(consolidated).toEqual(individual);
    });

    it("should handle empty payment method groups configuration", () => {
      const parser = new AccountLineParser({
        combinePaymentMethods: true,
        paymentMethodGroups: {},
      });

      const pdfText = `
VISA/MASTER($13,616.46)
AMEX($2,486.57)
      `;

      const consolidated = parser.getConsolidatedAccountLines(pdfText);
      const individual = parser.parseAccountLines(pdfText);

      // Should keep individual lines when no groups are configured
      expect(consolidated).toEqual(individual);
    });

    it("should handle lines with multiple consecutive spaces", () => {
      const parser = new AccountLineParser();
      const pdfText = `GL  ROOM  REV60ROOM  REVENUE10$1,000.50`;

      const result = parser.parseAccountLines(pdfText);

      // Should still parse correctly despite extra spaces
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle empty input", () => {
      const parser = new AccountLineParser();
      const result = parser.parseAccountLines("");

      expect(result).toHaveLength(0);
    });

    it("should handle input with only whitespace", () => {
      const parser = new AccountLineParser();
      const result = parser.parseAccountLines("   \n  \t  \n   ");

      expect(result).toHaveLength(0);
    });
  });
});
