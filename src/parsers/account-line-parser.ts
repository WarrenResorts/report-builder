/**
 * @fileoverview Account Line Parser
 *
 * Parses PDF text content to extract structured account line items.
 * Handles various PDF formats and payment method detection.
 */

/**
 * Represents a parsed account line from PDF content
 */
export interface AccountLine {
  /** Source account code from PDF */
  sourceCode: string;
  /** Account description/name */
  description: string;
  /** Transaction amount */
  amount: number;
  /** Payment method if detected (VISA, MASTER, DISCOVER, etc.) */
  paymentMethod?: string;
  /** Original line text for debugging */
  originalLine: string;
  /** Line number in the PDF */
  lineNumber: number;
}

/**
 * Payment method detection and combination logic
 */
export interface PaymentMethodGroup {
  /** Combined group name */
  groupName: string;
  /** Individual payment methods in this group */
  paymentMethods: string[];
  /** Total amount for this group */
  totalAmount: number;
  /** Original account lines */
  accountLines: AccountLine[];
}

/**
 * Configuration for account line parsing
 */
export interface AccountLineParserConfig {
  /** Whether to combine VISA/MASTER and DISCOVER */
  combinePaymentMethods: boolean;
  /** Custom payment method groupings */
  paymentMethodGroups?: {
    [groupName: string]: string[];
  };
  /** Minimum amount threshold to consider valid */
  minimumAmount?: number;
  /** Whether to include zero amounts */
  includeZeroAmounts?: boolean;
}

/**
 * Account Line Parser
 *
 * Parses raw PDF text to extract structured account line data
 */
export class AccountLineParser {
  private config: AccountLineParserConfig;

  // Common patterns for detecting account lines
  private readonly patterns = {
    // Account code patterns - must have account code, description, and something that looks like an amount
    accountCode: /^([A-Z0-9]{1,4})\s+(.+?)\s+(\S+)$/,
    // Amount patterns - more strict, must be complete numbers
    amount: /([-$]?[\d,]+\.?\d*|\([\d,]+\.?\d*\))/g,
    // Payment method patterns
    visa: /\b(VISA|VISA\s*CARD)\b/i,
    mastercard: /\b(MASTER|MASTERCARD|MASTER\s*CARD|MC)\b/i,
    discover: /\b(DISCOVER|DISC)\b/i,
    amex: /\b(AMEX|AMERICAN\s*EXPRESS)\b/i,
    // Line that likely contains account information
    accountLine: /^[A-Z0-9]{1,4}\s+.+/,
  };

  constructor(config: Partial<AccountLineParserConfig> = {}) {
    this.config = {
      combinePaymentMethods: true,
      paymentMethodGroups: {
        "Credit Cards": ["VISA", "MASTER", "MASTERCARD", "DISCOVER", "AMEX"],
      },
      minimumAmount: 0.01,
      includeZeroAmounts: false,
      ...config,
    };
  }

  /**
   * Parse PDF text content into structured account lines
   */
  parseAccountLines(pdfText: string): AccountLine[] {
    const lines = pdfText.split("\n");
    const accountLines: AccountLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line || line.length < 3) {
        continue; // Skip empty or very short lines
      }

      const accountLine = this.parseAccountLine(line, i + 1);
      if (accountLine) {
        accountLines.push(accountLine);
      }
    }

    return accountLines;
  }

  /**
   * Parse a single line to extract account information
   */
  private parseAccountLine(
    line: string,
    lineNumber: number,
  ): AccountLine | null {
    // Try to match account code pattern - must have account code, description, and amount
    const match = line.match(this.patterns.accountCode);
    if (!match) {
      return null;
    }

    const [, sourceCode, description, amountStr] = match;

    // Parse the amount (guaranteed to exist due to regex)
    const amount = this.parseAmount(amountStr);

    // Skip if amount is below threshold (unless zero amounts are explicitly included)
    if (
      Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
      !this.config.includeZeroAmounts
    ) {
      return null;
    }

    // Detect payment method
    const paymentMethod = this.detectPaymentMethod(line);

    return {
      sourceCode: sourceCode.trim(),
      description: description.trim(),
      amount,
      paymentMethod,
      originalLine: line,
      lineNumber,
    };
  }

  /**
   * Parse amount string to number
   */
  private parseAmount(amountStr: string): number {
    // Remove currency symbols and commas
    let cleanAmount = amountStr.replace(/[$,]/g, "");

    // Handle negative amounts (could be prefixed with - or in parentheses)
    if (cleanAmount.includes("(") && cleanAmount.includes(")")) {
      cleanAmount = cleanAmount.replace(/[()]/g, "");
      const parsed = parseFloat(cleanAmount);
      return isNaN(parsed) ? 0 : -parsed;
    }

    const parsed = parseFloat(cleanAmount);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Detect payment method from line content
   */
  private detectPaymentMethod(line: string): string | undefined {
    if (this.patterns.visa.test(line)) return "VISA";
    if (this.patterns.mastercard.test(line)) return "MASTER";
    if (this.patterns.discover.test(line)) return "DISCOVER";
    if (this.patterns.amex.test(line)) return "AMEX";
    return undefined;
  }

  /**
   * Group payment methods according to configuration
   */
  groupPaymentMethods(accountLines: AccountLine[]): PaymentMethodGroup[] {
    if (!this.config.combinePaymentMethods) {
      return []; // Return individual lines as-is
    }

    const groups: { [groupName: string]: PaymentMethodGroup } = {};
    const nonPaymentLines: AccountLine[] = [];

    // Separate payment method lines from regular account lines
    for (const line of accountLines) {
      if (line.paymentMethod) {
        // Find which group this payment method belongs to
        let groupName = line.paymentMethod; // Default to payment method name

        for (const [configGroupName, methods] of Object.entries(
          this.config.paymentMethodGroups || {},
        )) {
          if (
            methods.some(
              (method) =>
                method.toUpperCase() === line.paymentMethod?.toUpperCase() ||
                line.description.toUpperCase().includes(method.toUpperCase()),
            )
          ) {
            groupName = configGroupName;
            break;
          }
        }

        if (!groups[groupName]) {
          groups[groupName] = {
            groupName,
            paymentMethods: [],
            totalAmount: 0,
            accountLines: [],
          };
        }

        groups[groupName].paymentMethods.push(line.paymentMethod);
        groups[groupName].totalAmount += line.amount;
        groups[groupName].accountLines.push(line);
      } else {
        nonPaymentLines.push(line);
      }
    }

    return Object.values(groups);
  }

  /**
   * Get consolidated account lines with payment methods combined
   */
  getConsolidatedAccountLines(pdfText: string): AccountLine[] {
    const originalLines = this.parseAccountLines(pdfText);

    if (!this.config.combinePaymentMethods) {
      return originalLines;
    }

    const paymentGroups = this.groupPaymentMethods(originalLines);
    const nonPaymentLines = originalLines.filter((line) => !line.paymentMethod);
    const consolidatedLines: AccountLine[] = [...nonPaymentLines];

    // Add combined payment method lines
    for (const group of paymentGroups) {
      consolidatedLines.push({
        sourceCode: "CC", // Combined credit card code
        description: group.groupName,
        amount: group.totalAmount,
        paymentMethod: group.groupName,
        originalLine: `Combined: ${group.accountLines.map((l) => l.originalLine).join(" | ")}`,
        lineNumber: Math.min(...group.accountLines.map((l) => l.lineNumber)),
      });
    }

    return consolidatedLines;
  }

  /**
   * Debug: Get parsing statistics
   */
  getParsingStats(pdfText: string): {
    totalLines: number;
    parsedLines: number;
    paymentMethodLines: number;
    totalAmount: number;
    paymentMethodAmount: number;
  } {
    const lines = pdfText.split("\n");
    const accountLines = this.parseAccountLines(pdfText);
    const paymentLines = accountLines.filter((line) => line.paymentMethod);

    return {
      totalLines: lines.length,
      parsedLines: accountLines.length,
      paymentMethodLines: paymentLines.length,
      totalAmount: accountLines.reduce((sum, line) => sum + line.amount, 0),
      paymentMethodAmount: paymentLines.reduce(
        (sum, line) => sum + line.amount,
        0,
      ),
    };
  }
}
