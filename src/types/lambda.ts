/**
 * Lambda function types and interfaces
 */

/**
 * Result interface for email processing Lambda function
 */
export interface EmailProcessorResult {
  statusCode: number;
  body: string;
  processedAttachments: string[];
} 