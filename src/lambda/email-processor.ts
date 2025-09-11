import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { SESEvent, SESMail, Context } from "aws-lambda";
import { simpleParser, ParsedMail, Attachment } from "mailparser";
import { ParameterStoreConfig } from "../config/parameter-store";
import { environmentConfig } from "../config/environment";
import { EmailProcessorResult } from "../types/lambda";
import {
  generateCorrelationId,
  EmailRetrievalError,
  EmailParsingError,
  AttachmentProcessingError,
  S3StorageError,
  ConfigurationError,
} from "../types/errors";
import { createCorrelatedLogger } from "../utils/logger";
import { retryS3Operation, retryParameterStoreOperation } from "../utils/retry";

/**
 * EmailProcessor handles incoming emails from Amazon SES, extracts attachments,
 * and stores them in S3 with proper organization by property and date.
 *
 * This class is the core of the report processing system, responsible for:
 * - Retrieving raw emails from S3 (stored by SES)
 * - Parsing email content and extractments
 * - Filtering valid attachment types (PDF, CSV, TXT, XLSX, XLS)
 * - Organizing files by property ID and date
 * - Storing email metadata for tracking and debugging
 *
 * @example
 * ```typescript
 * const processor = new EmailProcessor();
 * const result = await processor.processEmail(sesEvent);
 * console.log(`Processed ${result.processedAttachments.length} attachments`);
 * ```
 */
export class EmailProcessor {
  private s3Client: S3Client;
  private parameterStore: ParameterStoreConfig;
  private incomingBucket: string;

  /**
   * Initializes the EmailProcessor with AWS clients and configuration.
   * Sets up S3 client with appropriate region and retrieves bucket configuration.
   */
  constructor() {
    this.s3Client = new S3Client({
      region:
        process.env.AWS_REGION || environmentConfig.awsRegion || "us-east-1",
    });
    this.parameterStore = new ParameterStoreConfig();
    this.incomingBucket = process.env.INCOMING_FILES_BUCKET || "";

    // Validate required configuration
    if (!this.incomingBucket) {
      throw new ConfigurationError(
        "INCOMING_FILES_BUCKET environment variable is required",
        generateCorrelationId(),
        "INCOMING_FILES_BUCKET",
      );
    }
  }

  /**
   * Processes one or more SES email events, extracting and storing attachments.
   *
   * This is the main entry point for email processing. It handles multiple email
   * records in a single SES event, processes each email's attachments, and stores
   * them in the appropriate S3 location based on property mapping and date.
   *
   * @param sesEvent - The SES event containing one or more email records
   * @returns Promise resolving to processing result with status and attachment info
   *
   * @throws {Error} When email retrieval, parsing, or S3 operations fail
   *
   * @example
   * ```typescript
   * const result = await processor.processEmail(sesEvent);
   * if (result.statusCode === 200) {
   *   console.log(`Successfully processed ${result.processedAttachments.length} files`);
   * }
   * ```
   */
  async processEmail(sesEvent: SESEvent): Promise<EmailProcessorResult> {
    const correlationId = generateCorrelationId();
    const logger = createCorrelatedLogger(correlationId);
    const processedAttachments: string[] = [];

    logger.info("Starting email processing", {
      eventSource: "SES",
      recordCount: sesEvent.Records.length,
      operation: "email_processing_start",
    });

    try {
      for (const [index, record] of sesEvent.Records.entries()) {
        const sesMessage = record.ses.mail;
        const recordLogger = logger.child({
          messageId: sesMessage.messageId,
          recordIndex: index,
        });

        recordLogger.info("Processing email record", {
          source: sesMessage.source,
          timestamp: sesMessage.timestamp,
          destination: sesMessage.destination,
          operation: "record_processing_start",
        });

        try {
          // Retrieve the raw email from S3
          const rawEmail = await this.getRawEmailFromS3(
            sesMessage,
            correlationId,
          );

          // Parse the email
          const parsedEmail = await this.parseEmail(
            rawEmail,
            sesMessage.messageId,
            correlationId,
          );

          // Extract and store attachments
          const attachmentPaths = await this.processAttachments(
            parsedEmail,
            sesMessage,
            correlationId,
          );
          processedAttachments.push(...attachmentPaths);

          // Store email metadata
          await this.storeEmailMetadata(
            parsedEmail,
            sesMessage,
            attachmentPaths,
            correlationId,
          );

          recordLogger.info("Email record processed successfully", {
            attachmentCount: attachmentPaths.length,
            operation: "record_processing_complete",
          });
        } catch (error) {
          recordLogger.error("Failed to process email record", error as Error, {
            operation: "record_processing_error",
          });

          // Re-throw with additional context
          if (
            error instanceof EmailRetrievalError ||
            error instanceof EmailParsingError ||
            error instanceof AttachmentProcessingError
          ) {
            throw error;
          }

          // Wrap unknown errors
          throw new AttachmentProcessingError(
            `Failed to process email record: ${(error as Error).message}`,
            correlationId,
            "email-record",
            undefined,
            {
              messageId: sesMessage.messageId,
              originalError: (error as Error).message,
            },
          );
        }
      }

      logger.info("Email processing completed successfully", {
        totalAttachments: processedAttachments.length,
        processedRecords: sesEvent.Records.length,
        operation: "email_processing_complete",
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Email processed successfully",
          attachmentsProcessed: processedAttachments.length,
          attachmentPaths: processedAttachments,
        }),
        processedAttachments,
      };
    } catch (error) {
      logger.error("Email processing failed", error as Error, {
        totalRecords: sesEvent.Records.length,
        processedAttachments: processedAttachments.length,
        operation: "email_processing_error",
      });
      throw error;
    }
  }

  /**
   * Retrieves the raw email content from S3 where SES stored it.
   *
   * @param sesMessage - SES message metadata containing S3 location info
   * @param correlationId - Correlation ID for tracking and logging
   * @returns Promise resolving to the raw email content as a Buffer
   *
   * @throws {EmailRetrievalError} When S3 object cannot be retrieved or email body is missing
   *
   * @private
   */
  private async getRawEmailFromS3(
    sesMessage: SESMail,
    correlationId: string,
  ): Promise<Buffer> {
    const s3Key = `raw-emails/${sesMessage.messageId}`;
    const logger = createCorrelatedLogger(correlationId, {
      messageId: sesMessage.messageId,
      operation: "email_retrieval",
    });

    logger.debug("Retrieving email from S3", {
      bucket: this.incomingBucket,
      key: s3Key,
    });

    try {
      const command = new GetObjectCommand({
        Bucket: this.incomingBucket,
        Key: s3Key,
      });

      const response = await retryS3Operation(
        () => this.s3Client.send(command),
        correlationId,
        "get_raw_email",
      );

      if (!response.Body) {
        throw new EmailRetrievalError(
          `No email body found for message ${sesMessage.messageId}`,
          correlationId,
          this.incomingBucket,
          s3Key,
          { contentLength: response.ContentLength },
        );
      }

      const emailBuffer = await response.Body.transformToByteArray();
      logger.debug("Email retrieved successfully", {
        contentLength: emailBuffer.length,
        bucket: this.incomingBucket,
        key: s3Key,
      });

      return Buffer.from(emailBuffer);
    } catch (error) {
      if (error instanceof EmailRetrievalError) {
        throw error;
      }

      throw new EmailRetrievalError(
        `Failed to retrieve email from S3: ${(error as Error).message}`,
        correlationId,
        this.incomingBucket,
        s3Key,
        { originalError: (error as Error).message },
      );
    }
  }

  /**
   * Parses raw email content using mailparser.
   *
   * @param rawEmail - Raw email content as Buffer
   * @param messageId - Email message ID for error context
   * @param correlationId - Correlation ID for tracking
   * @returns Promise resolving to parsed email
   *
   * @throws {EmailParsingError} When email parsing fails
   *
   * @private
   */
  private async parseEmail(
    rawEmail: Buffer,
    messageId: string,
    correlationId: string,
  ): Promise<ParsedMail> {
    const logger = createCorrelatedLogger(correlationId, {
      messageId,
      operation: "email_parsing",
    });

    logger.debug("Parsing email content", {
      emailSize: rawEmail.length,
    });

    try {
      const parsedEmail = await simpleParser(rawEmail);

      logger.debug("Email parsed successfully", {
        subject: parsedEmail.subject,
        from: parsedEmail.from?.value?.[0]?.address || parsedEmail.from?.text,
        to: Array.isArray(parsedEmail.to)
          ? parsedEmail.to.map((addr) => addr.text)
          : parsedEmail.to?.text,
        attachmentCount: parsedEmail.attachments?.length || 0,
      });

      return parsedEmail;
    } catch (error) {
      throw new EmailParsingError(
        `Failed to parse email: ${(error as Error).message}`,
        correlationId,
        messageId,
        { emailSize: rawEmail.length, originalError: (error as Error).message },
      );
    }
  }

  /**
   * Processes email attachments by filtering valid types and storing them in S3.
   *
   * @param parsedEmail - Parsed email containing attachments
   * @param sesMessage - SES message metadata for context
   * @param correlationId - Correlation ID for tracking
   * @returns Promise resolving to array of stored attachment S3 keys
   *
   * @throws {AttachmentProcessingError} When attachment processing fails
   *
   * @private
   */
  private async processAttachments(
    parsedEmail: ParsedMail,
    sesMessage: SESMail,
    correlationId: string,
  ): Promise<string[]> {
    const logger = createCorrelatedLogger(correlationId, {
      messageId: sesMessage.messageId,
      operation: "attachment_processing",
    });

    if (!parsedEmail.attachments || parsedEmail.attachments.length === 0) {
      logger.info("No attachments found in email", {
        subject: parsedEmail.subject,
      });
      return [];
    }

    logger.info("Processing attachments", {
      attachmentCount: parsedEmail.attachments.length,
      subject: parsedEmail.subject,
    });

    const storedAttachments: string[] = [];

    for (const [index, attachment] of parsedEmail.attachments.entries()) {
      const attachmentLogger = logger.child({
        attachmentIndex: index,
        attachmentName: attachment.filename || "unknown",
      });

      try {
        if (!this.isValidAttachment(attachment)) {
          attachmentLogger.warn("Skipping invalid attachment", {
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
          });
          continue;
        }

        const storedPath = await this.storeAttachment(
          attachment,
          parsedEmail,
          sesMessage,
          correlationId,
        );
        storedAttachments.push(storedPath);

        attachmentLogger.info("Attachment processed successfully", {
          storedPath,
          size: attachment.size,
        });
      } catch (error) {
        attachmentLogger.error("Failed to process attachment", error as Error, {
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        });

        // For attachment processing, we log the error but continue with other attachments
        // This prevents one bad attachment from failing the entire email processing
        continue;
      }
    }

    logger.info("Attachment processing completed", {
      totalAttachments: parsedEmail.attachments.length,
      successfullyStored: storedAttachments.length,
      skipped: parsedEmail.attachments.length - storedAttachments.length,
    });

    return storedAttachments;
  }

  /**
   * Validates if an attachment is a supported file type for processing.
   *
   * @param attachment - The attachment object to validate
   * @returns True if the attachment has a valid filename and supported extension
   *
   * @private
   */
  private isValidAttachment(attachment: Attachment): boolean {
    if (!attachment.filename) return false;

    const validExtensions = [".pdf", ".csv", ".txt", ".xlsx", ".xls"];
    const filename = attachment.filename.toLowerCase();

    return validExtensions.some((ext) => filename.endsWith(ext));
  }

  /**
   * Stores a single attachment in S3 with organized structure and metadata.
   *
   * Files are stored with the path: daily-files/{propertyId}/{YYYY-MM-DD}/{filename}
   * Property ID is determined from sender email using Parameter Store mapping.
   *
   * @param attachment - The email attachment to store
   * @param parsedEmail - Parsed email object containing email headers and content
   * @param sesMessage - SES message metadata for context
   * @param correlationId - Correlation ID for tracking
   * @returns Promise resolving to the S3 key where the file was stored
   *
   * @throws {S3StorageError} When S3 upload fails
   *
   * @private
   */
  private async storeAttachment(
    attachment: Attachment,
    parsedEmail: ParsedMail,
    sesMessage: SESMail,
    correlationId: string,
  ): Promise<string> {
    const logger = createCorrelatedLogger(correlationId, {
      messageId: sesMessage.messageId,
      operation: "store_attachment",
    });

    // Determine property ID from sender email (will use mapping later)
    // Extract just the email address without display name
    const senderEmail =
      parsedEmail.from?.value?.[0]?.address ||
      parsedEmail.from?.text ||
      "unknown-sender";
    const propertyId = await this.getPropertyIdFromSender(
      senderEmail,
      correlationId,
    );

    // Generate S3 key with organized structure
    const sanitizedFilename = this.sanitizeFilename(
      attachment.filename || "unknown",
    );
    const s3Key = `daily-files/${propertyId}/${new Date().toISOString().split("T")[0]}/${sanitizedFilename}`;

    logger.debug("Storing attachment in S3", {
      bucket: this.incomingBucket,
      key: s3Key,
      size: attachment.size,
    });

    try {
      const putObjectCommand = new PutObjectCommand({
        Bucket: this.incomingBucket,
        Key: s3Key,
        Body: attachment.content,
        ContentType: attachment.contentType || "application/octet-stream",
        Metadata: {
          originalFilename: attachment.filename || "unknown",
          senderEmail: senderEmail,
          messageId: sesMessage.messageId,
          receivedDate: new Date().toISOString(),
          propertyId: propertyId,
        },
      });

      await retryS3Operation(
        () => this.s3Client.send(putObjectCommand),
        correlationId,
        "put_attachment_to_s3",
      );

      logger.debug("Attachment stored successfully", {
        bucket: this.incomingBucket,
        key: s3Key,
      });
      return s3Key;
    } catch (error) {
      if (error instanceof S3StorageError) {
        throw error;
      }

      throw new S3StorageError(
        `Failed to store attachment in S3: ${(error as Error).message}`,
        correlationId,
        this.incomingBucket,
        s3Key,
        "put",
        { originalError: (error as Error).message },
      );
    }
  }

  /**
   * Determines the property ID from the sender's email address using Parameter Store mapping.
   *
   * @param senderEmail - Email address of the sender
   * @param correlationId - Correlation ID for tracking
   * @returns Promise resolving to property ID or 'unknown-property' if not found or on error
   *
   * @private
   */
  private async getPropertyIdFromSender(
    senderEmail: string,
    correlationId: string,
  ): Promise<string> {
    const logger = createCorrelatedLogger(correlationId, {
      senderEmail,
      operation: "get_property_id",
    });

    logger.debug("Getting property ID from Parameter Store", {
      senderEmail,
    });

    try {
      // Get property mapping from Parameter Store
      const mapping = await retryParameterStoreOperation(
        () => this.parameterStore.getPropertyMapping(),
        correlationId,
        "get_property_mapping",
      );

      // Look up property ID based on sender email
      const propertyId = mapping[senderEmail];

      if (!propertyId) {
        logger.warn("No property mapping found for sender", {
          senderEmail,
        });
        return "unknown-property";
      }

      logger.debug("Property ID found", {
        senderEmail,
        propertyId,
      });
      return propertyId;
    } catch (error) {
      logger.error(
        "Failed to get property mapping from Parameter Store, using fallback",
        error as Error,
        {
          senderEmail,
          fallback: "unknown-property",
        },
      );
      return "unknown-property";
    }
  }

  /**
   * Sanitizes a filename for safe storage in S3 by removing invalid characters.
   *
   * @param filename - Original filename to sanitize
   * @returns Sanitized filename safe for S3 key usage
   *
   * @private
   */
  private sanitizeFilename(filename: string): string {
    // Remove or replace invalid characters for S3 keys
    return filename
      .replace(/[^a-zA-Z0-9.\-_]/g, "_")
      .replace(/_{2,}/g, "_")
      .substring(0, 250); // Limit length
  }

  /**
   * Stores comprehensive email metadata in S3 for tracking and debugging purposes.
   *
   * Metadata includes sender, recipient, subject, attachment info, and processing timestamps.
   * Files are stored as JSON in: email-metadata/{YYYY-MM-DD}/{messageId}.json
   *
   * @param parsedEmail - Parsed email object containing email headers and content
   * @param sesMessage - SES message metadata
   * @param attachmentPaths - Array of S3 paths where attachments were stored
   * @param correlationId - Correlation ID for tracking
   *
   * @private
   */
  private async storeEmailMetadata(
    parsedEmail: ParsedMail,
    sesMessage: SESMail,
    attachmentPaths: string[],
    correlationId: string,
  ): Promise<void> {
    const logger = createCorrelatedLogger(correlationId, {
      messageId: sesMessage.messageId,
      operation: "store_email_metadata",
    });

    const metadata = {
      messageId: sesMessage.messageId,
      from: parsedEmail.from?.value?.[0]?.address || parsedEmail.from?.text,
      to: Array.isArray(parsedEmail.to)
        ? parsedEmail.to.map((addr) => addr.text).join(", ")
        : parsedEmail.to?.text,
      subject: parsedEmail.subject,
      date: parsedEmail.date?.toISOString(),
      attachmentCount: attachmentPaths.length,
      attachmentPaths: attachmentPaths,
      processedAt: new Date().toISOString(),
    };

    const s3Key = `email-metadata/${new Date().toISOString().split("T")[0]}/${sesMessage.messageId}.json`;

    logger.debug("Storing email metadata in S3", {
      bucket: this.incomingBucket,
      key: s3Key,
    });

    try {
      const putObjectCommand = new PutObjectCommand({
        Bucket: this.incomingBucket,
        Key: s3Key,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: "application/json",
      });

      await retryS3Operation(
        () => this.s3Client.send(putObjectCommand),
        correlationId,
        "put_email_metadata_to_s3",
      );

      logger.debug("Email metadata stored successfully", {
        bucket: this.incomingBucket,
        key: s3Key,
      });
    } catch (error) {
      if (error instanceof S3StorageError) {
        throw error;
      }

      logger.error("Failed to store email metadata in S3", error as Error, {
        bucket: this.incomingBucket,
        key: s3Key,
      });
      throw new S3StorageError(
        `Failed to store email metadata in S3: ${(error as Error).message}`,
        correlationId,
        this.incomingBucket,
        s3Key,
        "put",
        { originalError: (error as Error).message },
      );
    }
  }
}

/**
 * AWS Lambda handler function for processing SES email events.
 *
 * This is the main entry point when AWS Lambda is invoked by SES.
 * It creates an EmailProcessor instance and delegates processing to it.
 *
 * @param event - SES event containing one or more email records
 * @param context - Lambda context for tracking and timeout information
 * @returns Promise resolving to processing result with status and attachment info
 *
 * @throws {EmailProcessingError} When email processing fails
 *
 * @example
 * ```typescript
 * // AWS automatically calls this when emails are received:
 * const result = await handler(sesEvent, context);
 * ```
 */
export const handler = async (
  event: SESEvent,
  context: Context,
): Promise<EmailProcessorResult> => {
  const correlationId = generateCorrelationId();
  const logger = createCorrelatedLogger(correlationId, {
    requestId: context.awsRequestId,
    functionName: context.functionName,
    functionVersion: context.functionVersion,
  });

  logger.info("Lambda handler invoked", {
    eventSource: "aws:ses",
    recordCount: event.Records.length,
    remainingTime: context.getRemainingTimeInMillis(),
    operation: "lambda_handler_start",
  });

  try {
    const processor = new EmailProcessor();
    const result = await processor.processEmail(event);

    logger.info("Lambda handler completed successfully", {
      statusCode: result.statusCode,
      attachmentsProcessed: result.processedAttachments.length,
      operation: "lambda_handler_success",
    });

    return result;
  } catch (error) {
    logger.error("Lambda handler failed", error as Error, {
      operation: "lambda_handler_error",
      remainingTime: context.getRemainingTimeInMillis(),
    });

    // Re-throw the error to let Lambda handle it
    // This will trigger DLQ if configured (which we'll implement next)
    throw error;
  }
};
