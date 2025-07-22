import { SESEvent, SESMail, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { ParameterStoreConfig } from '../config/parameter-store';
import { environment } from '../config/environment';

interface EmailProcessorResult {
  statusCode: number;
  body: string;
  processedAttachments: string[];
}

export class EmailProcessor {
  private s3Client: S3Client;
  private parameterStore: ParameterStoreConfig;
  private incomingBucket: string;

  constructor() {
    this.s3Client = new S3Client({ region: process.env.AWS_REGION || environment.awsRegion || 'us-east-1' });
    this.parameterStore = new ParameterStoreConfig();
    this.incomingBucket = process.env.INCOMING_FILES_BUCKET || '';
  }

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

  private isValidAttachment(attachment: Attachment): boolean {
    if (!attachment.filename) return false;
    
    const validExtensions = ['.pdf', '.csv', '.txt', '.xlsx', '.xls'];
    const filename = attachment.filename.toLowerCase();
    
    return validExtensions.some(ext => filename.endsWith(ext));
  }

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

  private sanitizeFilename(filename: string): string {
    // Remove or replace invalid characters for S3 keys
    return filename
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 250); // Limit length
  }

  private async storeEmailMetadata(
    parsedEmail: ParsedMail,
    sesMessage: SESMail,
    attachmentPaths: string[]
  ): Promise<void> {
    const metadata = {
      messageId: sesMessage.messageId,
      from: parsedEmail.from?.text,
      to: parsedEmail.to?.text,
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

// Lambda handler function
export const handler = async (event: SESEvent, _context: Context): Promise<EmailProcessorResult> => {
  console.log('Processing SES event:', JSON.stringify(event, null, 2));
  
  const processor = new EmailProcessor();
  return await processor.processEmail(event);
}; 