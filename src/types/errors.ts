/**
 * Error types for structured error handling in the email processing system
 */

/**
 * Base error class for all email processing errors
 * Provides common properties for error tracking and debugging
 */
export abstract class EmailProcessingError extends Error {
  public readonly correlationId: string;
  public readonly timestamp: Date;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    correlationId: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.correlationId = correlationId;
    this.timestamp = new Date();
    this.context = context;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Returns a structured representation of the error for logging
   */
  toLogFormat(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      correlationId: this.correlationId,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when email retrieval from S3 fails
 */
export class EmailRetrievalError extends EmailProcessingError {
  public readonly bucketName: string;
  public readonly objectKey: string;

  constructor(
    message: string,
    correlationId: string,
    bucketName: string,
    objectKey: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, { ...context, bucketName, objectKey });
    this.bucketName = bucketName;
    this.objectKey = objectKey;
  }
}

/**
 * Error thrown when email parsing fails
 */
export class EmailParsingError extends EmailProcessingError {
  public readonly messageId: string;

  constructor(
    message: string,
    correlationId: string,
    messageId: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, { ...context, messageId });
    this.messageId = messageId;
  }
}

/**
 * Error thrown when attachment processing fails
 */
export class AttachmentProcessingError extends EmailProcessingError {
  public readonly attachmentName: string;
  public readonly attachmentSize?: number;

  constructor(
    message: string,
    correlationId: string,
    attachmentName: string,
    attachmentSize?: number,
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, {
      ...context,
      attachmentName,
      attachmentSize,
    });
    this.attachmentName = attachmentName;
    this.attachmentSize = attachmentSize;
  }
}

/**
 * Error thrown when S3 storage operations fail
 */
export class S3StorageError extends EmailProcessingError {
  public readonly bucketName: string;
  public readonly objectKey: string;
  public readonly operation: "put" | "get" | "delete";

  constructor(
    message: string,
    correlationId: string,
    bucketName: string,
    objectKey: string,
    operation: "put" | "get" | "delete",
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, {
      ...context,
      bucketName,
      objectKey,
      operation,
    });
    this.bucketName = bucketName;
    this.objectKey = objectKey;
    this.operation = operation;
  }
}

/**
 * Error thrown when Parameter Store operations fail
 */
export class ParameterStoreError extends EmailProcessingError {
  public readonly parameterName: string;
  public readonly operation: "get" | "put";

  constructor(
    message: string,
    correlationId: string,
    parameterName: string,
    operation: "get" | "put",
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, { ...context, parameterName, operation });
    this.parameterName = parameterName;
    this.operation = operation;
  }
}

/**
 * Error thrown when configuration is invalid or missing
 */
export class ConfigurationError extends EmailProcessingError {
  public readonly configKey: string;

  constructor(
    message: string,
    correlationId: string,
    configKey: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, correlationId, { ...context, configKey });
    this.configKey = configKey;
  }
}

/**
 * Utility function to generate correlation IDs for request tracking
 */
export function generateCorrelationId(): string {
  return `eproc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Type guard to check if an error is a retryable error
 */
export function isRetryableError(error: Error): boolean {
  // Network errors, timeouts, and temporary service errors are typically retryable
  const retryablePatterns = [
    /network/i,
    /timeout/i,
    /throttl/i,
    /rate limit/i,
    /service unavailable/i,
    /internal server error/i,
    /502/,
    /503/,
    /504/,
  ];

  return retryablePatterns.some(
    (pattern) =>
      pattern.test(error.message) || (error.name && pattern.test(error.name)),
  );
}

/**
 * Retry configuration for transient failures
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
}

/**
 * Default retry configuration for email processing operations
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
};
