/**
 * Retry utility with exponential backoff for handling transient failures
 */

import { RetryConfig, DEFAULT_RETRY_CONFIG, isRetryableError } from '../types/errors';
import { createCorrelatedLogger } from './logger';

/**
 * Executes a function with retry logic and exponential backoff
 * 
 * @param operation - The async function to execute with retry logic
 * @param correlationId - Correlation ID for logging and tracing
 * @param config - Retry configuration (optional, uses defaults if not provided)
 * @returns Promise resolving to the result of the operation
 * 
 * @throws {Error} The last error if all retries are exhausted
 * 
 * @example
 * ```typescript
 * const result = await retryOperation(
 *   () => s3Client.getObject({ Bucket: 'my-bucket', Key: 'my-key' }),
 *   'corr-123',
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 * ```
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  correlationId: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const logger = createCorrelatedLogger(correlationId);
  
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= retryConfig.maxRetries) {
    try {
      if (attempt > 0) {
        logger.info('Retrying operation', {
          attempt,
          maxRetries: retryConfig.maxRetries,
          operation: 'retry_attempt',
        });
      }

      const result = await operation();
      
      if (attempt > 0) {
        logger.info('Operation succeeded after retry', {
          attempt,
          totalAttempts: attempt + 1,
          operation: 'retry_success',
        });
      }

      return result;
    } catch (error) {
      lastError = error as Error;
      attempt++;

      // If this is the last attempt, don't log retry info
      if (attempt > retryConfig.maxRetries) {
        logger.error('Operation failed after all retries exhausted', lastError, {
          totalAttempts: attempt,
          maxRetries: retryConfig.maxRetries,
          operation: 'retry_failure',
          isRetryable: isRetryableError(lastError),
        });
        break;
      }

      // Check if the error is retryable
      if (!isRetryableError(lastError)) {
        logger.error('Operation failed with non-retryable error', lastError, {
          attempt,
          operation: 'non_retryable_error',
        });
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        retryConfig.baseDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
        retryConfig.maxDelay
      );

      logger.warn('Operation failed, will retry', {
        attempt,
        maxRetries: retryConfig.maxRetries,
        delayMs: delay,
        operation: 'retry_scheduled',
        error: {
          name: lastError.name,
          message: lastError.message,
        },
      });

      // Wait before retrying
      await sleep(delay);
    }
  }

  // All retries exhausted or non-retryable error occurred
  throw lastError || new Error('Operation failed with unknown error');
}

/**
 * Sleep utility function
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper for S3 operations with built-in retry logic
 */
export async function retryS3Operation<T>(
  operation: () => Promise<T>,
  correlationId: string,
  operationName: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const logger = createCorrelatedLogger(correlationId);
  
  logger.debug('Starting S3 operation', {
    operation: operationName,
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...config },
  });

  try {
    const result = await retryOperation(operation, correlationId, config);
    
    logger.debug('S3 operation completed successfully', {
      operation: operationName,
    });
    
    return result;
  } catch (error) {
    logger.error('S3 operation failed after all retries', error as Error, {
      operation: operationName,
    });
    throw error;
  }
}

/**
 * Wrapper for Parameter Store operations with built-in retry logic
 */
export async function retryParameterStoreOperation<T>(
  operation: () => Promise<T>,
  correlationId: string,
  operationName: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const logger = createCorrelatedLogger(correlationId);
  
  logger.debug('Starting Parameter Store operation', {
    operation: operationName,
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...config },
  });

  try {
    const result = await retryOperation(operation, correlationId, config);
    
    logger.debug('Parameter Store operation completed successfully', {
      operation: operationName,
    });
    
    return result;
  } catch (error) {
    logger.error('Parameter Store operation failed after all retries', error as Error, {
      operation: operationName,
    });
    throw error;
  }
} 