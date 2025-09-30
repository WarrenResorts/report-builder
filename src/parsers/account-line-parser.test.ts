import { describe, it, expect } from 'vitest';
import { AccountLineParser } from './account-line-parser';

describe('AccountLineParser', () => {
  describe('Basic Account Line Parsing', () => {
    it('should parse simple account lines with amounts', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    RM CHG   tax%    150.00
2    FOOD SALES      200.50
3    BEVERAGE        75.25
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        sourceCode: '1',
        description: 'RM CHG   tax%',
        amount: 150.00,
        paymentMethod: undefined,
        originalLine: '1    RM CHG   tax%    150.00',
        lineNumber: 2,
      });
      expect(result[1]).toEqual({
        sourceCode: '2',
        description: 'FOOD SALES',
        amount: 200.50,
        paymentMethod: undefined,
        originalLine: '2    FOOD SALES      200.50',
        lineNumber: 3,
      });
    });

    it('should handle negative amounts in parentheses', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    REFUND    (50.00)
2    DISCOUNT  (25.75)
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(-50.00);
      expect(result[1].amount).toBe(-25.75);
    });

    it('should handle amounts with currency symbols and commas', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    SALES    $1,250.75
2    TAX      $125.50
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(1250.75);
      expect(result[1].amount).toBe(125.50);
    });

    it('should skip lines below minimum amount threshold', () => {
      const parser = new AccountLineParser({ minimumAmount: 10.00 });
      const pdfText = `
1    SMALL CHARGE    5.00
2    LARGE CHARGE    50.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(50.00);
    });

    it('should include zero amounts when configured', () => {
      const parser = new AccountLineParser({ 
        includeZeroAmounts: true,
        minimumAmount: 0 
      });
      const pdfText = `
1    ZERO CHARGE    0.00
2    NORMAL CHARGE  50.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(0.00);
      expect(result[1].amount).toBe(50.00);
    });
  });

  describe('Payment Method Detection', () => {
    it('should detect VISA payments', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    VISA PAYMENT    100.00
2    VISA CARD       200.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].paymentMethod).toBe('VISA');
      expect(result[1].paymentMethod).toBe('VISA');
    });

    it('should detect MASTERCARD payments', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    MASTER PAYMENT    100.00
2    MASTERCARD        200.00
3    MASTER CARD       300.00
4    MC PAYMENT        400.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(4);
      expect(result[0].paymentMethod).toBe('MASTER');
      expect(result[1].paymentMethod).toBe('MASTER');
      expect(result[2].paymentMethod).toBe('MASTER');
      expect(result[3].paymentMethod).toBe('MASTER');
    });

    it('should detect DISCOVER and AMEX payments', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    DISCOVER PAYMENT    100.00
2    DISC CARD           200.00
3    AMEX PAYMENT        300.00
4    AMERICAN EXPRESS    400.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(4);
      expect(result[0].paymentMethod).toBe('DISCOVER');
      expect(result[1].paymentMethod).toBe('DISCOVER');
      expect(result[2].paymentMethod).toBe('AMEX');
      expect(result[3].paymentMethod).toBe('AMEX');
    });
  });

  describe('Payment Method Grouping', () => {
    it('should group payment methods when enabled', () => {
      const parser = new AccountLineParser({ combinePaymentMethods: true });
      const pdfText = `
1    VISA PAYMENT      100.00
2    MASTER PAYMENT    200.00
3    DISCOVER PAYMENT  300.00
4    AMEX PAYMENT      400.00
5    CASH PAYMENT      500.00
      `;

      const accountLines = parser.parseAccountLines(pdfText);
      const groups = parser.groupPaymentMethods(accountLines);

      expect(groups).toHaveLength(1); // All should be grouped into "Credit Cards"
      expect(groups[0].groupName).toBe('Credit Cards');
      expect(groups[0].totalAmount).toBe(1000.00); // VISA + MASTER + DISCOVER + AMEX
      expect(groups[0].paymentMethods).toEqual(['VISA', 'MASTER', 'DISCOVER', 'AMEX']);
    });

    it('should return consolidated account lines with combined payments', () => {
      const parser = new AccountLineParser({ combinePaymentMethods: true });
      const pdfText = `
1    ROOM CHARGE       150.00
2    VISA PAYMENT      100.00
3    MASTER PAYMENT    200.00
4    CASH PAYMENT      50.00
      `;

      const result = parser.getConsolidatedAccountLines(pdfText);

      // Should have: Room charge + Cash payment + Combined credit cards
      expect(result).toHaveLength(3);
      
      const roomCharge = result.find(r => r.sourceCode === '1');
      const cashPayment = result.find(r => r.sourceCode === '4');
      const creditCards = result.find(r => r.sourceCode === 'CC');

      expect(roomCharge).toBeDefined();
      expect(roomCharge?.amount).toBe(150.00);

      expect(cashPayment).toBeDefined();
      expect(cashPayment?.amount).toBe(50.00);

      expect(creditCards).toBeDefined();
      expect(creditCards?.amount).toBe(300.00); // VISA + MASTER
      expect(creditCards?.description).toBe('Credit Cards');
    });

    it('should not combine payments when disabled', () => {
      const parser = new AccountLineParser({ combinePaymentMethods: false });
      const pdfText = `
1    VISA PAYMENT      100.00
2    MASTER PAYMENT    200.00
      `;

      const result = parser.getConsolidatedAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].paymentMethod).toBe('VISA');
      expect(result[1].paymentMethod).toBe('MASTER');
    });
  });

  describe('Custom Payment Method Groups', () => {
    it('should use custom payment method groupings', () => {
      const parser = new AccountLineParser({
        combinePaymentMethods: true,
        paymentMethodGroups: {
          'Major Cards': ['VISA', 'MASTER'],
          'Other Cards': ['DISCOVER', 'AMEX'],
        },
      });

      const pdfText = `
1    VISA PAYMENT      100.00
2    MASTER PAYMENT    200.00
3    DISCOVER PAYMENT  300.00
4    AMEX PAYMENT      400.00
      `;

      const accountLines = parser.parseAccountLines(pdfText);
      const groups = parser.groupPaymentMethods(accountLines);

      expect(groups).toHaveLength(2);
      
      const majorCards = groups.find(g => g.groupName === 'Major Cards');
      const otherCards = groups.find(g => g.groupName === 'Other Cards');

      expect(majorCards?.totalAmount).toBe(300.00);
      expect(otherCards?.totalAmount).toBe(700.00);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty input', () => {
      const parser = new AccountLineParser();
      const result = parser.parseAccountLines('');

      expect(result).toHaveLength(0);
    });

    it('should handle input with no valid account lines', () => {
      const parser = new AccountLineParser();
      const pdfText = `
This is just random text
No account codes here
Just some narrative content
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(0);
    });

    it('should handle lines without amounts', () => {
      const parser = new AccountLineParser();
      const pdfText = `
1    DESCRIPTION ONLY
2    ANOTHER LINE
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(0); // Should be filtered out due to no amounts
    });

    it('should handle malformed amounts gracefully', () => {
      const parser = new AccountLineParser({ includeZeroAmounts: true });
      const pdfText = `
1    BAD AMOUNT    abc.def
2    GOOD AMOUNT   100.00
      `;

      const result = parser.parseAccountLines(pdfText);

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(0); // Malformed amount becomes 0
      expect(result[1].amount).toBe(100.00);
    });
  });

  describe('Parsing Statistics', () => {
    it('should provide accurate parsing statistics', () => {
      const parser = new AccountLineParser();
      const pdfText = `Header line
1    ROOM CHARGE       150.00
2    VISA PAYMENT      100.00
3    FOOD SALES        200.00
Footer line

Another line`;

      const stats = parser.getParsingStats(pdfText);

      expect(stats.totalLines).toBeGreaterThan(0); // Should count all lines
      expect(stats.parsedLines).toBe(3); // Only valid account lines
      expect(stats.paymentMethodLines).toBe(1); // Only VISA
      expect(stats.totalAmount).toBe(450.00);
      expect(stats.paymentMethodAmount).toBe(100.00);
    });

    it('should handle statistics for empty input', () => {
      const parser = new AccountLineParser();
      const stats = parser.getParsingStats('');

      expect(stats.totalLines).toBeGreaterThanOrEqual(0); // Should handle empty gracefully
      expect(stats.parsedLines).toBe(0);
      expect(stats.paymentMethodLines).toBe(0);
      expect(stats.totalAmount).toBe(0);
      expect(stats.paymentMethodAmount).toBe(0);
    });
  });

  describe('Configuration Options', () => {
    it('should use default configuration when none provided', () => {
      const parser = new AccountLineParser();
      
      // Test that defaults are applied by checking behavior
      const pdfText = `
1    SMALL CHARGE    0.005
2    VISA PAYMENT    100.00
      `;

      const result = parser.parseAccountLines(pdfText);
      
      // Should filter out small charge due to default minimum amount
      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(100.00);
    });

    it('should override default configuration', () => {
      const parser = new AccountLineParser({
        combinePaymentMethods: false,
        minimumAmount: 0,
        includeZeroAmounts: true,
      });

      const pdfText = `
1    ZERO CHARGE     0.00
2    VISA PAYMENT    100.00
3    MASTER PAYMENT  200.00
      `;

      const result = parser.getConsolidatedAccountLines(pdfText);

      // Should include zero amount and not combine payments
      expect(result).toHaveLength(3);
      expect(result[0].amount).toBe(0.00);
      expect(result.find(r => r.paymentMethod === 'VISA')).toBeDefined();
      expect(result.find(r => r.paymentMethod === 'MASTER')).toBeDefined();
    });
  });
});
