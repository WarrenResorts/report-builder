import { SESEvent, SESMail, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { ParameterStoreConfig } from '../config/parameter-store';
import { environment } from '../config/environment';
import { EmailProcessorResult } from '../types/lambda';

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
    this.s3Client = new S3Client({ region: process.env.AWS_REGION || environment.awsRegion || 'us-east-1' });
    this.parameterStore = new ParameterStoreConfig();
    this.incomingBucket = process.env.INCOMING_FILES_BUCKET || '';
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
    const processedAttachments: string[] = [];

    try {
      for (const record of sesEvent.Records) {
        const sesMessage = record.ses.mail;
        
        // Retrieve the raw email from S3
        const rawEmail = await this.getRawEmailFromS3(sesMessage);
        
        // Parse the email
        const parsedEmail = await simpleParser(rawEmail);
        
        // Extract and store attachments
        const attachmentPaths = await this.processAttachments(parsedEmail, sesMessage);
        processedAttachments.push(...attachmentPaths);
        
        // Store email metadata
        await this.storeEmailMetadata(parsedEmail, sesMessage, attachmentPaths);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Email processed successfully',
          attachmentsProcessed: processedAttachments.length,
          attachmentPaths: processedAttachments
        }),
        processedAttachments
      };

    } catch (error) {
      console.error('Error processing email:', error);
      throw error;
    }
  }

  /**
   * Retrieves the raw email content from S3 where SES stored it.
   * 
   * @param sesMessage - SES message metadata containing S3 location info
   * @returns Promise resolving to the raw email content as a Buffer
   * 
   * @throws {Error} When S3 object cannot be retrieved or email body is missing
   * 
   * @private
   */
  private async getRawEmailFromS3(sesMessage: SESMail): Promise<Buffer> {
    const s3Key = `raw-emails/${sesMessage.messageId}`;
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.incomingBucket,
      Key: s3Key
    });

    const response = await this.s3Client.send(getObjectCommand);
    
    if (!response.Body) {
      throw new Error(`No email body found for message ${sesMessage.messageId}`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();
    
    let readerDone = false;
    while (!readerDone) {
      const { done, value } = await reader.read();
      if (done) {
        readerDone = true;
      } else {
        chunks.push(value);
      }
    }

    return Buffer.concat(chunks);
  }

  /**
   * Processes all attachments from a parsed email, filtering valid types and storing them in S3.
   * 
   * Valid attachment types: PDF, CSV, TXT, XLSX, XLS
   * Files are organized by property ID and date in the format:
   * daily-files/{propertyId}/{YYYY-MM-DD}/{filename}
   * 
   * @param parsedEmail - Parsed email object containing attachments
   * @param sesMessage - SES message metadata for property identification
   * @returns Promise resolving to array of S3 paths where attachments were stored
   * 
   * @private
   */
  private async processAttachments(
    parsedEmail: ParsedMail, 
    sesMessage: SESMail
  ): Promise<string[]> {
    const attachmentPaths: string[] = [];
    
    if (!parsedEmail.attachments || parsedEmail.attachments.length === 0) {
      console.log(`No attachments found in email ${sesMessage.messageId}`);
      return attachmentPaths;
    }

    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    for (const attachment of parsedEmail.attachments) {
      // Only process specific file types
      if (this.isValidAttachment(attachment)) {
        const attachmentPath = await this.storeAttachment(
          attachment, 
          sesMessage, 
          timestamp,
          parsedEmail.from?.text || 'unknown-sender'
        );
        attachmentPaths.push(attachmentPath);
      } else {
        console.log(`Skipping attachment ${attachment.filename} - invalid file type`);
      }
    }

    return attachmentPaths;
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
    
    const validExtensions = ['.pdf', '.csv', '.txt', '.xlsx', '.xls'];
    const filename = attachment.filename.toLowerCase();
    
    return validExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Stores a single attachment in S3 with organized structure and metadata.
   * 
   * Files are stored with the path: daily-files/{propertyId}/{YYYY-MM-DD}/{filename}
   * Property ID is determined from sender email using Parameter Store mapping.
   * 
   * @param attachment - The email attachment to store
   * @param sesMessage - SES message metadata for context
   * @param timestamp - Date timestamp in YYYY-MM-DD format
   * @param senderEmail - Email address of the sender for property mapping
   * @returns Promise resolving to the S3 key where the file was stored
   * 
   * @throws {Error} When S3 upload fails
   * 
   * @private
   */
  private async storeAttachment(
    attachment: Attachment,
    sesMessage: SESMail,
    timestamp: string,
    senderEmail: string
  ): Promise<string> {
    // Determine property ID from sender email (will use mapping later)
    const propertyId = await this.getPropertyIdFromSender(senderEmail);
    
    // Generate S3 key with organized structure
    const sanitizedFilename = this.sanitizeFilename(attachment.filename || 'unknown');
    const s3Key = `daily-files/${propertyId}/${timestamp}/${sanitizedFilename}`;
    
    const putObjectCommand = new PutObjectCommand({
      Bucket: this.incomingBucket,
      Key: s3Key,
      Body: attachment.content,
      ContentType: attachment.contentType || 'application/octet-stream',
      Metadata: {
        originalFilename: attachment.filename || 'unknown',
        senderEmail: senderEmail,
        messageId: sesMessage.messageId,
        receivedDate: new Date().toISOString(),
        propertyId: propertyId
      }
    });

    await this.s3Client.send(putObjectCommand);
    
    console.log(`Stored attachment: ${s3Key}`);
    return s3Key;
  }

  /**
   * Determines the property ID from the sender's email address using Parameter Store mapping.
   * 
   * @param senderEmail - Email address of the sender
   * @returns Promise resolving to property ID or 'unknown-property' if not found
   * 
   * @private
   */
  private async getPropertyIdFromSender(senderEmail: string): Promise<string> {
    try {
      // Get property mapping from Parameter Store
      const mapping = await this.parameterStore.getPropertyMapping();
      
      // Look up property ID based on sender email
      const propertyId = mapping[senderEmail];
      
      if (!propertyId) {
        console.warn(`No property mapping found for sender: ${senderEmail}`);
        return 'unknown-property';
      }
      
      return propertyId;
    } catch (error) {
      console.error('Error getting property mapping:', error);
      return 'unknown-property';
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
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/_{2,}/g, '_')
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
   * 
   * @private
   */
  private async storeEmailMetadata(
    parsedEmail: ParsedMail,
    sesMessage: SESMail,
    attachmentPaths: string[]
  ): Promise<void> {
    const metadata = {
      messageId: sesMessage.messageId,
      from: parsedEmail.from?.text,
      to: Array.isArray(parsedEmail.to) ? parsedEmail.to.map(addr => addr.text).join(', ') : parsedEmail.to?.text,
      subject: parsedEmail.subject,
      date: parsedEmail.date?.toISOString(),
      attachmentCount: attachmentPaths.length,
      attachmentPaths: attachmentPaths,
      processedAt: new Date().toISOString()
    };

    const s3Key = `email-metadata/${new Date().toISOString().split('T')[0]}/${sesMessage.messageId}.json`;
    
    const putObjectCommand = new PutObjectCommand({
      Bucket: this.incomingBucket,
      Key: s3Key,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    });

    await this.s3Client.send(putObjectCommand);
  }
}

/**
 * AWS Lambda handler function for processing SES email events.
 * 
 * This is the main entry point when AWS Lambda is invoked by SES.
 * It creates an EmailProcessor instance and delegates processing to it.
 * 
 * @param event - SES event containing one or more email records
 * @param _context - Lambda context (unused)
 * @returns Promise resolving to processing result with status and attachment info
 * 
 * @example
 * ```typescript
 * // AWS automatically calls this when emails are received:
 * const result = await handler(sesEvent, context);
 * ```
 */
export const handler = async (event: SESEvent, _context: Context): Promise<EmailProcessorResult> => {
  console.log('Processing SES event:', JSON.stringify(event, null, 2));
  
  const processor = new EmailProcessor();
  return await processor.processEmail(event);
}; 