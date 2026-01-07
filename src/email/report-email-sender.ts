/**
 * @fileoverview Report Email Sender
 *
 * Sends consolidated JE and StatJE reports via email using Amazon SES.
 * Handles email composition, attachment preparation, and delivery confirmation.
 */

import {
  SESClient,
  SendRawEmailCommand,
  SendRawEmailCommandOutput,
} from "@aws-sdk/client-ses";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createCorrelatedLogger, Logger } from "../utils/logger";
import { retryOperation } from "../utils/retry";
import { ParameterStoreConfig } from "../config/parameter-store";
import { environmentConfig } from "../config/environment";
import { RetryConfig } from "../types/errors";

/**
 * Report summary data for email body
 */
export interface ReportSummary {
  /** Date of the processed reports (YYYY-MM-DD) */
  reportDate: string;
  /** Total number of properties included */
  totalProperties: number;
  /** List of property names processed */
  propertyNames: string[];
  /** Total number of files processed */
  totalFiles: number;
  /** Total number of records in JE file */
  totalJERecords: number;
  /** Total number of records in StatJE file */
  totalStatJERecords: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Any errors encountered during processing */
  errors: string[];
}

/**
 * Result of sending the report email
 */
export interface EmailSendResult {
  /** Whether the email was sent successfully */
  success: boolean;
  /** SES message ID if successful */
  messageId?: string;
  /** Error message if failed */
  error?: string;
  /** Recipients the email was sent to */
  recipients: string[];
}

/**
 * Configuration for the email sender
 */
interface EmailSenderConfig {
  /** S3 bucket containing processed reports */
  processedBucket: string;
  /** AWS region for SES */
  region: string;
}

/**
 * Report Email Sender
 *
 * Composes and sends daily consolidated reports via Amazon SES with
 * JE and StatJE CSV files as attachments.
 */
export class ReportEmailSender {
  private sesClient: SESClient;
  private s3Client: S3Client;
  private parameterStore: ParameterStoreConfig;
  private logger: Logger;
  private config: EmailSenderConfig;

  constructor(config?: Partial<EmailSenderConfig>) {
    const region = config?.region || environmentConfig.awsRegion || "us-east-1";

    this.sesClient = new SESClient({ region });
    this.s3Client = new S3Client({ region });
    this.parameterStore = new ParameterStoreConfig();
    this.logger = createCorrelatedLogger("ReportEmailSender");

    this.config = {
      processedBucket:
        config?.processedBucket || process.env.PROCESSED_FILES_BUCKET || "",
      region,
    };
  }

  /**
   * Send the daily report email with JE and StatJE attachments
   *
   * @param jeReportKey - S3 key for the JE CSV file
   * @param statJEReportKey - S3 key for the StatJE CSV file
   * @param summary - Report summary data for email body
   * @param correlationId - Correlation ID for logging
   * @returns Result of the email send operation
   */
  async sendReportEmail(
    jeReportKey: string,
    statJEReportKey: string,
    summary: ReportSummary,
    correlationId: string,
  ): Promise<EmailSendResult> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "send_report_email",
    });

    logger.info("Starting report email send", {
      jeReportKey,
      statJEReportKey,
      reportDate: summary.reportDate,
      totalProperties: summary.totalProperties,
    });

    try {
      // Get email configuration from Parameter Store
      const emailConfig = await this.parameterStore.getEmailConfiguration();

      if (!emailConfig.recipients || emailConfig.recipients.length === 0) {
        logger.warn("No email recipients configured - skipping email send", {
          parameterPath: `/report-builder/${environmentConfig.environment}/email/recipients`,
        });
        return {
          success: false,
          error: "No email recipients configured",
          recipients: [],
        };
      }

      logger.info("Email configuration retrieved", {
        recipientCount: emailConfig.recipients.length,
        fromEmail: emailConfig.fromEmail,
        configurationSet: emailConfig.sesConfigurationSet,
      });

      // Download report files from S3
      const [jeContent, statJEContent] = await Promise.all([
        this.downloadReportFromS3(jeReportKey, correlationId),
        this.downloadReportFromS3(statJEReportKey, correlationId),
      ]);

      logger.info("Report files downloaded from S3", {
        jeSize: jeContent.length,
        statJESize: statJEContent.length,
      });

      // Compose the email
      const rawEmail = this.composeRawEmail({
        from: emailConfig.fromEmail,
        to: emailConfig.recipients,
        subject: this.generateSubject(summary),
        htmlBody: this.generateHtmlBody(summary),
        textBody: this.generateTextBody(summary),
        attachments: [
          {
            filename: this.extractFilename(jeReportKey),
            content: jeContent,
            contentType: "text/csv",
          },
          {
            filename: this.extractFilename(statJEReportKey),
            content: statJEContent,
            contentType: "text/csv",
          },
        ],
        configurationSet: emailConfig.sesConfigurationSet,
      });

      // Send the email via SES
      const result = await this.sendRawEmail(rawEmail, correlationId);

      logger.info("Report email sent successfully", {
        messageId: result.MessageId,
        recipients: emailConfig.recipients,
        reportDate: summary.reportDate,
      });

      return {
        success: true,
        messageId: result.MessageId,
        recipients: emailConfig.recipients,
      };
    } catch (error) {
      logger.error("Failed to send report email", error as Error, {
        jeReportKey,
        statJEReportKey,
        reportDate: summary.reportDate,
      });

      return {
        success: false,
        error: (error as Error).message,
        recipients: [],
      };
    }
  }

  /**
   * Download a report file from S3
   */
  private async downloadReportFromS3(
    reportKey: string,
    correlationId: string,
  ): Promise<string> {
    const logger = createCorrelatedLogger(correlationId, {
      operation: "download_report",
    });

    const retryConfig: Partial<RetryConfig> = {
      maxRetries: 3,
      baseDelay: 1000,
    };

    const response = await retryOperation(
      async () => {
        const command = new GetObjectCommand({
          Bucket: this.config.processedBucket,
          Key: reportKey,
        });
        return this.s3Client.send(command);
      },
      correlationId,
      retryConfig,
    );

    if (!response.Body) {
      throw new Error(`No content found for report: ${reportKey}`);
    }

    // Convert stream to string
    const bodyContents = await response.Body.transformToString();

    logger.debug("Report downloaded", {
      reportKey,
      contentLength: bodyContents.length,
    });

    return bodyContents;
  }

  /**
   * Send raw email via SES with retry logic
   */
  private async sendRawEmail(
    rawEmail: string,
    correlationId: string,
  ): Promise<SendRawEmailCommandOutput> {
    const retryConfig: Partial<RetryConfig> = {
      maxRetries: 3,
      baseDelay: 1000,
    };

    return retryOperation(
      async () => {
        const command = new SendRawEmailCommand({
          RawMessage: {
            Data: Buffer.from(rawEmail),
          },
        });
        return this.sesClient.send(command);
      },
      correlationId,
      retryConfig,
    );
  }

  /**
   * Compose a raw MIME email with attachments
   */
  private composeRawEmail(options: {
    from: string;
    to: string[];
    subject: string;
    htmlBody: string;
    textBody: string;
    attachments: Array<{
      filename: string;
      content: string;
      contentType: string;
    }>;
    configurationSet?: string;
  }): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const attachmentBoundary = `----=_Attach_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    const headers = [
      `From: ${options.from}`,
      `To: ${options.to.join(", ")}`,
      `Subject: ${options.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ];

    if (options.configurationSet) {
      headers.push(`X-SES-CONFIGURATION-SET: ${options.configurationSet}`);
    }

    const emailParts: string[] = [
      headers.join("\r\n"),
      "",
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${attachmentBoundary}"`,
      "",
      `--${attachmentBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      options.textBody,
      "",
      `--${attachmentBoundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      options.htmlBody,
      "",
      `--${attachmentBoundary}--`,
    ];

    // Add attachments
    for (const attachment of options.attachments) {
      const base64Content = Buffer.from(attachment.content).toString("base64");
      emailParts.push(
        "",
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        "",
        base64Content,
      );
    }

    emailParts.push("", `--${boundary}--`);

    return emailParts.join("\r\n");
  }

  /**
   * Generate email subject line
   */
  private generateSubject(summary: ReportSummary): string {
    const dateFormatted = this.formatDateForDisplay(summary.reportDate);
    return `Daily Hotel Reports - ${dateFormatted} (${summary.totalProperties} Properties)`;
  }

  /**
   * Generate HTML email body
   */
  private generateHtmlBody(summary: ReportSummary): string {
    const dateFormatted = this.formatDateForDisplay(summary.reportDate);
    const hasErrors = summary.errors && summary.errors.length > 0;

    const propertyList = summary.propertyNames
      .map((name) => `<li>${this.escapeHtml(name)}</li>`)
      .join("\n");

    const errorSection = hasErrors
      ? `
        <h3 style="color: #dc3545;">Processing Warnings</h3>
        <ul style="color: #856404; background-color: #fff3cd; padding: 15px; border-radius: 4px;">
          ${summary.errors.map((e) => `<li>${this.escapeHtml(e)}</li>`).join("\n")}
        </ul>
      `
      : "";

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #2c3e50; color: white; padding: 20px; text-align: center; border-radius: 4px 4px 0 0; }
    .content { background-color: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; }
    .summary-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .summary-table td { padding: 8px; border-bottom: 1px solid #dee2e6; }
    .summary-table td:first-child { font-weight: bold; width: 40%; }
    .properties-list { background-color: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
    .footer { text-align: center; padding: 15px; color: #6c757d; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Daily Hotel Reports</h1>
      <p>${dateFormatted}</p>
    </div>
    <div class="content">
      <h2>Processing Summary</h2>
      <table class="summary-table">
        <tr>
          <td>Report Date:</td>
          <td>${dateFormatted}</td>
        </tr>
        <tr>
          <td>Properties Processed:</td>
          <td>${summary.totalProperties}</td>
        </tr>
        <tr>
          <td>Files Processed:</td>
          <td>${summary.totalFiles}</td>
        </tr>
        <tr>
          <td>JE Records:</td>
          <td>${summary.totalJERecords.toLocaleString()}</td>
        </tr>
        <tr>
          <td>StatJE Records:</td>
          <td>${summary.totalStatJERecords.toLocaleString()}</td>
        </tr>
        <tr>
          <td>Processing Time:</td>
          <td>${(summary.processingTimeMs / 1000).toFixed(2)} seconds</td>
        </tr>
      </table>

      <h3>Properties Included</h3>
      <div class="properties-list">
        <ul>
          ${propertyList}
        </ul>
      </div>

      ${errorSection}

      <h3>Attachments</h3>
      <p>The following reports are attached to this email:</p>
      <ul>
        <li><strong>${summary.reportDate}_JE.csv</strong> - Journal Entry file for NetSuite import</li>
        <li><strong>${summary.reportDate}_StatJE.csv</strong> - Statistical Journal Entry file</li>
      </ul>
    </div>
    <div class="footer">
      <p>This is an automated message from the Report Builder system.</p>
      <p>Environment: ${environmentConfig.environment}</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate plain text email body
   */
  private generateTextBody(summary: ReportSummary): string {
    const dateFormatted = this.formatDateForDisplay(summary.reportDate);
    const hasErrors = summary.errors && summary.errors.length > 0;

    const propertyList = summary.propertyNames
      .map((name) => `  - ${name}`)
      .join("\n");

    const errorSection = hasErrors
      ? `\nPROCESSING WARNINGS:\n${summary.errors.map((e) => `  ! ${e}`).join("\n")}\n`
      : "";

    return `
DAILY HOTEL REPORTS - ${dateFormatted}
${"=".repeat(50)}

PROCESSING SUMMARY
------------------
Report Date:         ${dateFormatted}
Properties Processed: ${summary.totalProperties}
Files Processed:     ${summary.totalFiles}
JE Records:          ${summary.totalJERecords.toLocaleString()}
StatJE Records:      ${summary.totalStatJERecords.toLocaleString()}
Processing Time:     ${(summary.processingTimeMs / 1000).toFixed(2)} seconds

PROPERTIES INCLUDED
-------------------
${propertyList}
${errorSection}
ATTACHMENTS
-----------
- ${summary.reportDate}_JE.csv - Journal Entry file for NetSuite import
- ${summary.reportDate}_StatJE.csv - Statistical Journal Entry file

--
This is an automated message from the Report Builder system.
Environment: ${environmentConfig.environment}
    `.trim();
  }

  /**
   * Format date for display (YYYY-MM-DD to MM/DD/YYYY)
   */
  private formatDateForDisplay(dateStr: string): string {
    const [year, month, day] = dateStr.split("-");
    return `${month}/${day}/${year}`;
  }

  /**
   * Extract filename from S3 key
   */
  private extractFilename(s3Key: string): string {
    const parts = s3Key.split("/");
    return parts[parts.length - 1];
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
  }
}
