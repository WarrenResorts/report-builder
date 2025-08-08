/**
 * Structured logging utility for the email processing system
 * Provides consistent logging format with correlation IDs for better tracing
 */

export interface LogContext {
  correlationId?: string;
  messageId?: string;
  propertyId?: string;
  attachmentName?: string;
  operation?: string;
  [key: string]: unknown;
}

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * Structured logger class with correlation ID support
 */
export class Logger {
  private readonly serviceName: string;
  private readonly defaultContext: LogContext;

  constructor(
    serviceName: string = "EmailProcessor",
    defaultContext: LogContext = {},
  ) {
    this.serviceName = serviceName;
    this.defaultContext = defaultContext;
  }

  /**
   * Creates a child logger with additional default context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger(this.serviceName, {
      ...this.defaultContext,
      ...additionalContext,
    });
  }

  /**
   * Logs a debug message
   */
  debug(message: string, context: LogContext = {}): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Logs an info message
   */
  info(message: string, context: LogContext = {}): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, context: LogContext = {}): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: Error, context: LogContext = {}): void {
    const errorContext = error
      ? {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        }
      : {};

    this.log(LogLevel.ERROR, message, { ...context, ...errorContext });
  }

  /**
   * Core logging method that outputs structured JSON logs
   */
  private log(
    level: LogLevel,
    message: string,
    context: LogContext = {},
  ): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...this.defaultContext,
      ...context,
    };

    const logOutput = JSON.stringify(logEntry);

    // Use appropriate console method based on log level
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logOutput);
        break;
      case LogLevel.INFO:
        console.info(logOutput);
        break;
      case LogLevel.WARN:
        console.warn(logOutput);
        break;
      case LogLevel.ERROR:
        console.error(logOutput);
        break;
      default:
        console.log(logOutput);
    }
  }
}

/**
 * Default logger instance for the email processor
 */
export const logger = new Logger("EmailProcessor");

/**
 * Creates a logger with correlation ID context
 */
export function createCorrelatedLogger(
  correlationId: string,
  additionalContext: LogContext = {},
): Logger {
  return logger.child({ correlationId, ...additionalContext });
}
