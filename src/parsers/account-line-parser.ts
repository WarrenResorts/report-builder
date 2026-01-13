/**
 * @fileoverview Account Line Parser
 *
 * Parses PDF text content to extract structured account line items.
 * Handles various PDF formats and payment method detection.
 */

import { createCorrelatedLogger } from "../utils/logger";

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
  /** Set of valid source codes from mapping file for whitelist validation */
  validSourceCodes?: Set<string>;
}

/**
 * Account Line Parser
 *
 * Parses raw PDF text to extract structured account line data
 */
export class AccountLineParser {
  private config: AccountLineParserConfig;
  private logger = createCorrelatedLogger("AccountLineParser");

  // Common patterns for detecting account lines
  private readonly patterns = {
    // Hotel PDF format: "GL ROOM REV60$9,949.23..." or "GL CASH & CHECKS REVCHPAYMENT CASH0$0.00..."
    // GL/CL account codes with pipe delimiters: "GL ROOM TAX REV|9|CITY LODGING TAX|49|$980.63|..."
    // Format: GL/CL [space] [Category]|[Source Code]|[Description]|[Count]|[Amount]|...
    glClAccountCode:
      /^(GL|CL)\s+([^|]+)\|([A-Z0-9]+)\|([^|]+)\|(\d+)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/,
    // GL/CL summary lines with pipes: "CL DB CONTROL|6|$393.02|..." or "GL ROOM REV|50|$10,107.15|..."
    // Format: GL/CL [space] [Category]|[Count]|[Amount]|... (no embedded transaction code)
    glClSummaryLine: /^(GL|CL)\s+([^|]+)\|(\d+)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/,
    // Payment method lines with pipes: "AMEX|($2,486.57)|..." or "VISA/MASTER|($13,616.46)|..."
    paymentMethodLine:
      /^(VISA\/MASTER|VISA|MASTER|MASTERCARD|AMEX|DISCOVER|CASH|CHECKS)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/,
    // Summary lines with pipes: "Total Rm Rev|$9,949.23|..." or "ADR|$216.29|..."
    summaryLine:
      /^(Total\s+[A-Z\s]+|ADR|RevPar|Occupancy\s*%?|DEPOSIT\s+TOTAL)\|(\$[\d,.-]+|\([\d,.-]+\))/i,
    // Ledger lines with pipes: "ADVANCE DEPOSITS|($7,095.60)|..." or "GUEST LEDGER|$21,084.73|..."
    ledgerLine:
      /^((?:GUEST\s+LEDGER|CITY\s+LEDGER|ADVANCE\s+DEPOSITS)(?:\s+TOTAL)?)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/i,
    // Statistical lines with pipes: "Occupied|46|1,026" or "Occupancy %|51.11|81.75"
    statisticalLine:
      /^(Occupied|No\s+Show|Late\s+C\/I|Early\s+C\/O|Total\s+Rooms|Out\s+of\s+Service|Comps|Occupancy\s*%)\|(\d+(?:\.\d+)?)/i,
    // Embedded transaction codes with pipes: "RC|ROOM CHRG REVENUE|50|$10,107.15|..." or "AX|PAYMENT AMEX|6|($2,486.57)|..."
    // Also handles mixed case like "Pet|PET CHARGE|4|$112.00|..."
    embeddedTransactionCode:
      /^([A-Za-z0-9]+)\|([^|]+)\|(\d+)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/,
    // Category-prefixed detail lines: "Guest 021|X3|PET CHARGE|3|$60.00|..." or "Guest 022|RC|ROOM CHRG|50|$10,107.15|..."
    // Format: [Category]|[TransactionCode]|[Description]|[Count]|[Amount]|...
    categoryPrefixedLine:
      /^([^|]+)\|([A-Z0-9]+)\|([^|]+)\|(\d+)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/,
    // Category summary lines without GL/CL prefix: "ADV DEPOSIT|62|$2,207.49|..." or "DIRECT BILLS|3|$385.36|..."
    // Format: [Category with spaces]|[Count]|[Amount]|... (category contains spaces, distinguishing from embeddedTransactionCode)
    categorySummaryLine:
      /^([A-Za-z]+(?:\s+[A-Za-z]+)+)\|(\d+)\|(\$[\d,.-]+|\([$]?[\d,.-]+\))/,
    // Amount patterns - more strict, must be complete numbers
    amount: /([-$]?[\d,]+\.?\d*|\([\d,]+\.?\d*\))/g,
    // Payment method patterns
    visa: /(?:^|\s)(VISA|VISA\s*CARD|VISA\/MC)(?:\s|\d|$)/i,
    mastercard: /(?:^|\s)(MASTER|MASTERCARD|MASTER\s*CARD|MC)(?:\s|\d|$)/i,
    discover: /(?:^|\s)(DISCOVER)(?:\s|\d|$)/i,
    amex: /(?:^|\s)(AMEX|AMERICAN\s*EXPRESS)(?:\s|\d|$)/i,
    // Line that likely contains account information - must have a pipe delimiter after the first field
    accountLine:
      /^(GL|CL|VISA|MASTER|AMEX|DISCOVER|CASH|CHECKS|Total|ADR|RevPar|GUEST|CITY|ADVANCE|Occupied|No\s+Show|Late\s+C\/I|Early\s+C\/O|Total\s+Rooms|Out\s+of\s+Service|Comps|Occupancy\s*%)[|\s]/i,
  };

  constructor(config: Partial<AccountLineParserConfig> = {}) {
    this.config = {
      combinePaymentMethods: true,
      paymentMethodGroups: {
        "Credit Cards": ["VISA/MASTER", "AMEX"],
      },
      minimumAmount: 0.01,
      includeZeroAmounts: false,
      ...config,
    };
  }

  /**
   * Check if a source code is a statistical metric (ADR, RevPar, etc.)
   */
  private isStatisticalCode(sourceCode: string): boolean {
    const statisticalCodes = [
      "ADR",
      "REVPAR",
      "OCCUPANCY",
      "OCCUPIED",
      "OUT OF SERVICE",
      "COMPS",
      "ROOMS SOLD",
      "ROOMS AVAILABLE",
      "NO SHOW",
      "LATE C/I",
      "EARLY C/O",
      "TOTAL ROOMS",
    ];
    return statisticalCodes.includes(sourceCode.toUpperCase());
  }

  /**
   * Parse PDF text content into structured account lines
   */
  parseAccountLines(pdfText: string): AccountLine[] {
    const lines = pdfText.split("\n");
    const accountLines: AccountLine[] = [];
    let currentSection:
      | "detail-listing"
      | "detail-listing-summary"
      | "unknown" = "unknown";

    // Track seen statistical codes to avoid duplicates (e.g., ADR vs ADR w/comps)
    const seenStatisticalCodes = new Set<string>();

    this.logger.debug("Starting account line parsing", {
      totalLines: lines.length,
    });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line || line.length < 3) {
        continue; // Skip empty or very short lines
      }

      // Detect section headers to determine parsing mode
      // Check for "Detail Listing Summary" first (more specific)
      if (line.match(/Detail\s+Listing\s+Summary/i)) {
        currentSection = "detail-listing-summary";
        continue;
      } else if (line.match(/^Detail\s+Listing\s*$/i)) {
        // Match "Detail Listing" ONLY when it's alone on a line (not followed by "Summary")
        currentSection = "detail-listing";
        continue;
      }

      const accountLine = this.parseAccountLine(line, i + 1, currentSection);
      if (accountLine) {
        // Skip duplicate statistical codes (keep only first occurrence)
        // Statistical codes are: ADR, RevPar, Occupied, Out of Service, Comps, etc.
        const isStatisticalCode = this.isStatisticalCode(
          accountLine.sourceCode,
        );
        if (isStatisticalCode) {
          if (seenStatisticalCodes.has(accountLine.sourceCode.toUpperCase())) {
            continue;
          }
          seenStatisticalCodes.add(accountLine.sourceCode.toUpperCase());
        }

        accountLines.push(accountLine);
      }
    }

    this.logger.debug("Account line parsing completed", {
      totalLines: lines.length,
      parsedLines: accountLines.length,
    });

    return accountLines;
  }

  /**
   * Parse a single line to extract account information
   */
  private parseAccountLine(
    line: string,
    lineNumber: number,
    _section:
      | "detail-listing"
      | "detail-listing-summary"
      | "unknown" = "unknown",
  ): AccountLine | null {
    // Try ledger lines FIRST (most specific): "GUEST LEDGER$21,084.73"
    const ledgerMatch = line.match(this.patterns.ledgerLine);
    if (ledgerMatch) {
      const [, ledgerType, amountStr] = ledgerMatch;
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode: ledgerType.trim(),
        description: "Ledger Balance",
        amount,
        paymentMethod: undefined,
        originalLine: line,
        lineNumber,
      };
    }

    // Try payment method lines: "VISA/MASTER($13,616.46)"
    // These are SUMMARY lines, not individual transactions
    // Do NOT set paymentMethod to avoid double-counting in consolidation
    const paymentMatch = line.match(this.patterns.paymentMethodLine);
    if (paymentMatch) {
      const [, paymentType, amountStr] = paymentMatch;
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode: paymentType,
        description: "Payment Method Total",
        amount,
        paymentMethod: undefined, // Don't set payment method on summary lines
        originalLine: line,
        lineNumber,
      };
    }

    // Try summary lines: "Total Rm Rev$9,949.23" or "ADR$216.29"
    const summaryMatch = line.match(this.patterns.summaryLine);
    if (summaryMatch) {
      const [, summaryType, amountStr] = summaryMatch;
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode: summaryType.trim(),
        description: "Summary Total",
        amount,
        paymentMethod: undefined,
        originalLine: line,
        lineNumber,
      };
    }

    // Try embedded transaction codes with pipes: "RC|ROOM CHRG REVENUE|50|$10,107.15|..." or "AX|PAYMENT AMEX|6|($2,486.57)|..."
    const embeddedMatch = line.match(this.patterns.embeddedTransactionCode);
    if (embeddedMatch) {
      // Destructure: [fullMatch, sourceCode, description, count, amount]
      // We skip count (_count) as it's not needed for output
      const [, sourceCodeRaw, description, _count, amountStr] = embeddedMatch;

      // The source code is cleanly extracted by the pipe delimiter
      const sourceCode = sourceCodeRaw.trim();
      const descriptionText = description.trim();

      // Skip "REFUND AD" lines - these are refunds of advance deposits (8A, 8B, 8C, 8G, 8H, 8I, 8P, 8V)
      // They should not be included in JE/StatJE reports
      if (descriptionText.startsWith("REFUND AD") || descriptionText === "REFUND PREPAID") {
        return null;
      }

      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode,
        description: descriptionText,
        amount,
        paymentMethod: this.detectPaymentMethod(line),
        originalLine: line,
        lineNumber,
      };
    }

    // Try GL/CL account lines with pipes: "GL ROOM TAX REV|9|CITY LODGING TAX|49|$980.63|..."
    const glClMatch = line.match(this.patterns.glClAccountCode);
    if (glClMatch) {
      // Destructure: [fullMatch, glClPrefix, category, sourceCode, description, count, amount]
      // We skip glClPrefix (_prefix) and count (_count) as they're not needed for output
      const [
        ,
        _prefix,
        category,
        sourceCodeRaw,
        description,
        _count,
        amountStr,
      ] = glClMatch;

      // The source code is cleanly extracted by the pipe delimiter
      const sourceCode = sourceCodeRaw.trim();
      const descriptionText = `${category.trim()} ${description.trim()}`.trim();
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode,
        description: descriptionText,
        amount,
        paymentMethod: this.detectPaymentMethod(line),
        originalLine: line,
        lineNumber,
      };
    }

    // Try GL/CL summary lines with pipes: "CL DB CONTROL|6|$393.02|..." (category totals without transaction codes)
    const glClSummaryMatch = line.match(this.patterns.glClSummaryLine);
    if (glClSummaryMatch) {
      // Destructure: [fullMatch, glClPrefix, category, count, amount]
      // We skip count (_count) as it's not needed for output
      const [, glClPrefix, category, _count, amountStr] = glClSummaryMatch;

      // For summary lines, include GL/CL prefix in the source code (e.g., "CL DB CONTROL")
      const sourceCode = `${glClPrefix} ${category.trim()}`;
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode,
        description: sourceCode,
        amount,
        paymentMethod: this.detectPaymentMethod(line),
        originalLine: line,
        lineNumber,
      };
    }

    // Try statistical lines: "Occupied|46|1,026" or "Occupancy %|51.11|81.75"
    const statMatch = line.match(this.patterns.statisticalLine);
    if (statMatch) {
      const [, statType, valueStr] = statMatch;
      const amount = parseFloat(valueStr.replace(/,/g, ""));

      // Statistical data should NOT be filtered by minimum amount - these are counts/percentages, not dollar amounts
      // Always include statistical lines regardless of value

      return {
        sourceCode: statType.trim(),
        description: "Statistical Data",
        amount,
        paymentMethod: undefined,
        originalLine: line,
        lineNumber,
      };
    }

    // Try category-prefixed detail lines: "Guest 021|X3|PET CHARGE|3|$60.00|..."
    // This must come after more specific patterns to avoid false matches
    const categoryPrefixedMatch = line.match(
      this.patterns.categoryPrefixedLine,
    );
    if (categoryPrefixedMatch) {
      // Destructure: [fullMatch, category, sourceCode, description, count, amount]
      // We skip category (_category) and count (_count) as they're not needed for output
      const [, _category, sourceCodeRaw, description, _count, amountStr] =
        categoryPrefixedMatch;

      const sourceCode = sourceCodeRaw.trim();
      const descriptionText = description.trim();
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode,
        description: descriptionText,
        amount,
        paymentMethod: this.detectPaymentMethod(line),
        originalLine: line,
        lineNumber,
      };
    }

    // Try category summary lines without GL/CL prefix: "ADV DEPOSIT|62|$2,207.49|..." or "DIRECT BILLS|3|$385.36|..."
    const categorySummaryMatch = line.match(this.patterns.categorySummaryLine);
    if (categorySummaryMatch) {
      // Destructure: [fullMatch, category, count, amount]
      // We skip count (_count) as it's not needed for output
      const [, category, _count, amountStr] = categorySummaryMatch;

      // The category name IS the source code for these summary lines
      const sourceCode = category.trim();
      const amount = this.parseAmount(amountStr);

      if (
        Math.abs(amount) < (this.config.minimumAmount || 0.01) &&
        !this.config.includeZeroAmounts
      ) {
        return null;
      }

      return {
        sourceCode,
        description: sourceCode,
        amount,
        paymentMethod: this.detectPaymentMethod(line),
        originalLine: line,
        lineNumber,
      };
    }

    // No pattern matched
    return null;
  }

  /**
   * Extract valid posting code from text using whitelist validation
   * Tries longest match first (up to 8 chars) and returns the longest valid code found
   * This ensures we match "91" instead of "9" when both are valid
   */
  private extractValidPostingCode(
    text: string,
  ): { code: string; remainingText: string } | null {
    const trimmedText = text.trim();
    const validCodes = this.config.validSourceCodes;

    // If no whitelist provided, fall back to extracting first 1-2 characters
    if (!validCodes || validCodes.size === 0) {
      const fallbackMatch = trimmedText.match(/^([A-Z0-9]{1,2})/i);
      if (fallbackMatch) {
        return {
          code: fallbackMatch[1],
          remainingText: trimmedText.substring(fallbackMatch[1].length).trim(),
        };
      }
      return null;
    }

    // Try longest match first (8 chars down to 1 char)
    // This ensures we prefer "91" over "9", "PET1" over "P", etc.
    for (let length = 8; length >= 1; length--) {
      const candidate = trimmedText.substring(0, length).toUpperCase();
      if (validCodes.has(candidate)) {
        return {
          code: candidate,
          remainingText: trimmedText.substring(length).trim(),
        };
      }
    }

    return null;
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

    // Separate configured groups from individual payment methods
    const configuredGroupNames = Object.keys(
      this.config.paymentMethodGroups || {},
    );
    const groupedPaymentMethods = new Set<string>();

    // Add combined payment method lines for configured groups only
    for (const group of paymentGroups) {
      if (configuredGroupNames.includes(group.groupName)) {
        // This is a configured group - combine it
        consolidatedLines.push({
          sourceCode: "CC", // Combined credit card code
          description: group.groupName,
          amount: group.totalAmount,
          paymentMethod: group.groupName,
          originalLine: `Combined: ${group.accountLines.map((l) => l.originalLine).join(" | ")}`,
          lineNumber: Math.min(...group.accountLines.map((l) => l.lineNumber)),
        });

        // Track which payment methods were grouped
        group.accountLines.forEach((line) =>
          groupedPaymentMethods.add(line.sourceCode),
        );
      }
    }

    // Add individual payment method lines that weren't grouped
    const ungroupedPaymentLines = originalLines.filter(
      (line) =>
        line.paymentMethod && !groupedPaymentMethods.has(line.sourceCode),
    );
    consolidatedLines.push(...ungroupedPaymentLines);

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
