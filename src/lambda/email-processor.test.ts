import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { EmailProcessor, handler } from "./email-processor";
import { SESEvent, SESMail, Context } from "aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { simpleParser } from "mailparser";
import { ParameterStoreConfig } from "../config/parameter-store";

// Mock dependencies
vi.mock("@aws-sdk/client-s3");
vi.mock("mailparser");
vi.mock("../config/parameter-store");
vi.mock("../config/environment", () => ({
  environmentConfig: {
    environment: "test",
    awsRegion: "us-east-1",
    awsAccount: "",
  },
}));

const mockS3Client = {
  send: vi.fn(),
};

const mockParameterStore = {
  getPropertyMapping: vi.fn(),
};

// Mock constructors
(S3Client as Mock).mockImplementation(() => mockS3Client);
(ParameterStoreConfig as Mock).mockImplementation(() => mockParameterStore);

// Common SES receipt verdicts for test fixtures
const defaultReceiptVerdicts = {
  spamVerdict: { status: "PASS" },
  virusVerdict: { status: "PASS" },
  spfVerdict: { status: "PASS" },
  dkimVerdict: { status: "PASS" },
  dmarcVerdict: { status: "PASS" },
} as const;

// Helper function to create mock Lambda context
const createMockLambdaContext = () => ({
  requestId: "test-request-id",
  functionName: "test-function",
  functionVersion: "1",
  getRemainingTimeInMillis: vi.fn().mockReturnValue(30000),
});

/**
 * Test Suite: EmailProcessor
 *
 * This comprehensive test suite validates the EmailProcessor class functionality,
 * which is the core component responsible for processing incoming emails from
 * Amazon SES. The EmailProcessor handles:
 *
 * - Retrieving raw emails from S3 storage
 * - Parsing email content and extracting attachments
 * - Identifying property IDs from sender email mapping
 * - Storing attachments in organized S3 structure
 * - Creating email metadata for tracking and debugging
 * - Error handling and graceful degradation
 * - Structured logging with correlation IDs
 * - Retry logic for transient failures
 *
 * Test Coverage Areas:
 * - Successful email processing workflows
 * - Edge cases and error conditions
 * - Property identification logic
 * - Attachment filtering and validation
 * - S3 integration and error handling
 * - Parameter Store integration and fallbacks
 * - Lambda handler integration testing
 */
describe("EmailProcessor", () => {
  let emailProcessor: EmailProcessor;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set environment variables
    process.env.INCOMING_FILES_BUCKET = "test-bucket";
    process.env.AWS_REGION = "us-east-1";

    emailProcessor = new EmailProcessor();
  });

  /**
   * Test Group: processEmail Method
   *
   * Tests the main email processing workflow including:
   * - End-to-end email processing with attachments
   * - Handling emails without attachments
   * - Attachment type filtering (PDF, CSV, TXT, XLSX, XLS only)
   * - Property identification from sender email
   * - Graceful handling of unknown senders
   * - S3 storage operations and error recovery
   * - Parameter Store integration and fallback behavior
   * - Edge cases like undefined senders and filenames
   * - Multi-recipient email handling
   * - Enhanced error handling with structured logging
   */
  describe("processEmail", () => {
    it("should process email with attachments successfully", async () => {
      // Mock SES event
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
                commonHeaders: {
                  from: ["sender@example.com"],
                  to: ["test@example.com"],
                  subject: "Daily Report",
                },
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id",
                },
              },
            },
          },
        ],
      };

      // Mock S3 raw email retrieval
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      // Mock parsed email with attachment
      const mockParsedEmail = {
        from: { text: "sender@example.com" },
        to: { text: "test@example.com" },
        subject: "Daily Report",
        date: new Date("2024-01-01T12:00:00.000Z"),
        attachments: [
          {
            filename: "report.pdf",
            contentType: "application/pdf",
            content: Buffer.from("PDF content"),
          },
        ],
      };

      (simpleParser as Mock).mockResolvedValue(mockParsedEmail);

      // Mock property mapping
      mockParameterStore.getPropertyMapping.mockResolvedValue({
        "sender@example.com": "property-1",
      });

      // Mock S3 put operations
      mockS3Client.send.mockResolvedValue({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toHaveLength(1);
      expect(result.processedAttachments[0]).toMatch(
        /daily-files\/property-1\/\d{4}-\d{2}-\d{2}\/report\.pdf/,
      );

      // Verify S3 calls
      expect(mockS3Client.send).toHaveBeenCalledTimes(3); // getRawEmail + storeAttachment + storeMetadata
    });

    it("should handle email with no attachments", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-2",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-2",
                },
              },
            },
          },
        ],
      };

      // Mock S3 and parser for email with no attachments
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      (simpleParser as Mock).mockResolvedValue({
        from: { text: "sender@example.com" },
        subject: "No attachments",
        attachments: [],
      });

      // Mock metadata storage
      mockS3Client.send.mockResolvedValueOnce({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toHaveLength(0);
      expect(mockS3Client.send).toHaveBeenCalledTimes(2); // getRawEmail + storeMetadata
    });

    it("should filter out invalid attachment types", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-3",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-3",
                },
              },
            },
          },
        ],
      };

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      const mockParsedEmail = {
        from: { text: "sender@example.com" },
        attachments: [
          { filename: "report.pdf", content: Buffer.from("PDF content") }, // Valid
          { filename: "image.jpg", content: Buffer.from("Image content") }, // Invalid
          { filename: "data.csv", content: Buffer.from("CSV content") }, // Valid
          { filename: "virus.exe", content: Buffer.from("Exe content") }, // Invalid
        ],
      };

      (simpleParser as Mock).mockResolvedValue(mockParsedEmail);
      mockParameterStore.getPropertyMapping.mockResolvedValue({
        "sender@example.com": "property-1",
      });
      mockS3Client.send.mockResolvedValue({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.processedAttachments).toHaveLength(2); // Only PDF and CSV
      expect(mockS3Client.send).toHaveBeenCalledTimes(4); // getRawEmail + 2 attachments + metadata
    });

    it("should handle unknown property mapping gracefully", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-4",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "unknown@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-4",
                },
              },
            },
          },
        ],
      };

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      (simpleParser as Mock).mockResolvedValue({
        from: { text: "unknown@example.com" },
        attachments: [
          {
            filename: "report.pdf",
            content: Buffer.from("PDF content"),
          },
        ],
      });

      // Return empty mapping
      mockParameterStore.getPropertyMapping.mockResolvedValue({});
      mockS3Client.send.mockResolvedValue({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments[0]).toMatch(
        /daily-files\/unknown-property\/\d{4}-\d{2}-\d{2}\/report\.pdf/,
      );
    });

    it("should handle S3 errors gracefully", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-5",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-5",
                },
              },
            },
          },
        ],
      };

      // Mock S3 error
      mockS3Client.send.mockRejectedValue(new Error("S3 access denied"));

      await expect(emailProcessor.processEmail(sesEvent)).rejects.toThrow(
        "Failed to retrieve email from S3: S3 access denied",
      );
    });

    it("should handle missing email body from S3", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-6",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-6",
                },
              },
            },
          },
        ],
      };

      // Mock S3 response with no body
      mockS3Client.send.mockResolvedValue({
        Body: null,
      });

      await expect(emailProcessor.processEmail(sesEvent)).rejects.toThrow(
        "No email body found for message test-message-id-6",
      );
    });

    it("should handle parameter store errors when getting property mapping", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-7",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-7",
                },
              },
            },
          },
        ],
      };

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      (simpleParser as Mock).mockResolvedValue({
        from: { text: "sender@example.com" },
        attachments: [
          {
            filename: "report.pdf",
            content: Buffer.from("PDF content"),
          },
        ],
      });

      // Mock parameter store error
      mockParameterStore.getPropertyMapping.mockRejectedValue(
        new Error("Parameter store error"),
      );
      mockS3Client.send.mockResolvedValue({}); // For attachment storage and metadata

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments[0]).toMatch(
        /daily-files\/unknown-property\/\d{4}-\d{2}-\d{2}\/report\.pdf/,
      );
    });

    it("should handle email with undefined sender gracefully", async () => {
      // Mock SES event
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-undefined-sender",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
                commonHeaders: {
                  from: ["sender@example.com"],
                  to: ["test@example.com"],
                  subject: "Daily Report",
                },
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                spamVerdict: { status: "PASS" },
                virusVerdict: { status: "PASS" },
                spfVerdict: { status: "PASS" },
                dkimVerdict: { status: "PASS" },
                dmarcVerdict: { status: "PASS" },
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-undefined-sender",
                },
              },
            },
          },
        ],
      };

      // Mock S3 raw email retrieval
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      // Mock parsed email with undefined from field
      const mockParsedEmail = {
        from: undefined, // This will trigger the 'unknown-sender' fallback
        to: { text: "test@example.com" },
        subject: "Daily Report",
        date: new Date("2024-01-01T12:00:00.000Z"),
        attachments: [
          {
            filename: "report.pdf",
            contentType: "application/pdf",
            content: Buffer.from("PDF content"),
          },
        ],
      };

      (simpleParser as Mock).mockResolvedValue(mockParsedEmail);
      mockParameterStore.getPropertyMapping.mockResolvedValue({});
      mockS3Client.send.mockResolvedValue({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments[0]).toMatch(
        /daily-files\/unknown-property\/\d{4}-\d{2}-\d{2}\/report\.pdf/,
      );
    });

    it("should handle attachment with undefined filename", async () => {
      // Mock SES event
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-undefined-filename",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                spamVerdict: { status: "PASS" },
                virusVerdict: { status: "PASS" },
                spfVerdict: { status: "PASS" },
                dkimVerdict: { status: "PASS" },
                dmarcVerdict: { status: "PASS" },
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-undefined-filename",
                },
              },
            },
          },
        ],
      };

      // Mock S3 raw email retrieval
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      // Mock parsed email with attachment that has filename as null but contentType suggests PDF
      const mockParsedEmail = {
        from: { text: "sender@example.com" },
        to: { text: "test@example.com" },
        subject: "Daily Report",
        date: new Date("2024-01-01T12:00:00.000Z"),
        attachments: [
          {
            filename: "document.pdf", // Valid filename first, then we'll simulate it becoming undefined
            contentType: "application/pdf",
            content: Buffer.from("PDF content"),
          },
        ],
      };

      // Modify the attachment to have undefined filename after validation but before processing
      const attachment = mockParsedEmail.attachments[0];
      Object.defineProperty(attachment, "filename", {
        get: () => undefined,
        configurable: true,
      });

      (simpleParser as Mock).mockResolvedValue(mockParsedEmail);
      mockParameterStore.getPropertyMapping.mockResolvedValue({
        "sender@example.com": "property-1",
      });
      mockS3Client.send.mockResolvedValue({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      // This attachment will be filtered out due to no filename
      expect(result.processedAttachments).toHaveLength(0);
    });

    it("should handle email with array of recipients", async () => {
      // Mock SES event
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "test-message-id-array-recipients",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com", "backup@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com", "backup@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/test-message-id-array-recipients",
                },
              },
            },
          },
        ],
      };

      // Mock S3 raw email retrieval
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("Email content")),
        },
      });

      // Mock parsed email with array of recipients
      const mockParsedEmail = {
        from: { text: "sender@example.com" },
        to: [{ text: "test@example.com" }, { text: "backup@example.com" }], // This will trigger the Array.isArray branch
        subject: "Daily Report",
        date: new Date("2024-01-01T12:00:00.000Z"),
        attachments: [
          {
            filename: "report.pdf",
            contentType: "application/pdf",
            content: Buffer.from("PDF content"),
          },
        ],
      };

      (simpleParser as Mock).mockResolvedValue(mockParsedEmail);
      mockParameterStore.getPropertyMapping.mockResolvedValue({
        "sender@example.com": "property-1",
      });
      mockS3Client.send.mockResolvedValue({});

      const result = await emailProcessor.processEmail(sesEvent);

      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toHaveLength(1);
    });

    it("should handle missing AWS_REGION environment variable", async () => {
      // Clear environment variables to test fallback
      const originalRegion = process.env.AWS_REGION;
      delete process.env.AWS_REGION;

      try {
        // Create new processor instance to test constructor fallback
        const testProcessor = new EmailProcessor();
        expect(testProcessor).toBeDefined();
      } finally {
        // Restore original environment variable
        if (originalRegion) {
          process.env.AWS_REGION = originalRegion;
        }
      }
    });
  });

  describe("sanitizeFilename", () => {
    it("should sanitize invalid characters", () => {
      const processor = new EmailProcessor();

      // Access private method via type assertion
      const sanitize = (
        processor as unknown as {
          sanitizeFilename: (filename: string) => string;
        }
      ).sanitizeFilename.bind(processor);

      expect(sanitize("file with spaces.pdf")).toBe("file_with_spaces.pdf");
      expect(sanitize("file/with\\slashes.csv")).toBe("file_with_slashes.csv");
      expect(sanitize("file@#$%^&*().txt")).toBe("file_.txt");
      expect(sanitize("multiple___underscores.pdf")).toBe(
        "multiple_underscores.pdf",
      );
    });

    it("should limit filename length", () => {
      const processor = new EmailProcessor();
      const sanitize = (
        processor as unknown as {
          sanitizeFilename: (filename: string) => string;
        }
      ).sanitizeFilename.bind(processor);

      const longFilename = "a".repeat(300) + ".pdf";
      const result = sanitize(longFilename);

      expect(result.length).toBeLessThanOrEqual(250);
      // The long filename gets truncated, so we just check it's shortened
      expect(result.length).toBeLessThan(longFilename.length);
    });
  });

  describe("isValidAttachment", () => {
    it("should validate file extensions correctly", () => {
      const processor = new EmailProcessor();
      const isValid = (
        processor as unknown as {
          isValidAttachment: (attachment: {
            filename?: string | null;
          }) => boolean;
        }
      ).isValidAttachment.bind(processor);

      expect(isValid({ filename: "report.pdf" })).toBe(true);
      expect(isValid({ filename: "data.csv" })).toBe(true);
      expect(isValid({ filename: "notes.txt" })).toBe(true);
      expect(isValid({ filename: "spreadsheet.xlsx" })).toBe(true);
      expect(isValid({ filename: "legacy.xls" })).toBe(true);

      expect(isValid({ filename: "image.jpg" })).toBe(false);
      expect(isValid({ filename: "video.mp4" })).toBe(false);
      expect(isValid({ filename: "archive.zip" })).toBe(false);
      expect(isValid({ filename: "executable.exe" })).toBe(false);
      expect(isValid({ filename: null })).toBe(false);
      expect(isValid({})).toBe(false);
    });
  });
});

/**
 * Test Group: Lambda Handler Integration
 *
 * Tests the AWS Lambda handler function that serves as the entry point
 * for SES email processing events. This integration test validates:
 *
 * - Lambda handler receives and processes SES events correctly
 * - EmailProcessor class is instantiated and called properly
 * - Return values match the expected EmailProcessorResult interface
 * - Error handling and logging work through the Lambda context
 * - Integration between AWS Lambda runtime and EmailProcessor
 *
 * This test ensures the handler function correctly bridges the gap
 * between AWS Lambda infrastructure and our email processing logic.
 */
describe("Lambda Handler", () => {
  it("should process SES event through handler", async () => {
    const sesEvent: SESEvent = {
      Records: [
        {
          eventSource: "aws:ses",
          eventVersion: "1.0",
          ses: {
            mail: {
              messageId: "handler-test",
              timestamp: "2024-01-01T12:00:00.000Z",
              source: "sender@example.com",
              destination: ["test@example.com"],
            } as SESMail,
            receipt: {
              recipients: ["test@example.com"],
              timestamp: "2024-01-01T12:00:00.000Z",
              processingTimeMillis: 100,
              ...defaultReceiptVerdicts,
              action: {
                type: "S3",
                bucketName: "test-bucket",
                objectKey: "raw-emails/handler-test",
              },
            },
          },
        },
      ],
    };

    const context = createMockLambdaContext() as unknown as Context;

    // Mock the dependencies
    mockS3Client.send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: () =>
          Promise.resolve(Buffer.from("Email content")),
      },
    });

    (simpleParser as Mock).mockResolvedValue({
      from: { text: "sender@example.com" },
      attachments: [],
    });

    mockS3Client.send.mockResolvedValueOnce({}); // metadata storage

    const result = await handler(sesEvent, context);

    expect(result.statusCode).toBe(200);
    expect(result.processedAttachments).toHaveLength(0);
  });

  describe("DLQ scenarios", () => {
    it("should handle Lambda function timeout that would trigger DLQ", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "timeout-test",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/timeout-test",
                },
              },
            },
          },
        ],
      };

      const context = createMockLambdaContext() as unknown as Context;

      // Mock S3 to throw a timeout-like error that would occur in real Lambda timeout scenarios
      mockS3Client.send.mockRejectedValue(new Error("Task timed out after 3.00 seconds"));

      // This should throw a timeout error that would send to DLQ after Lambda retries
      await expect(handler(sesEvent, context))
        .rejects.toThrow("Task timed out");
    });

    it("should handle unrecoverable parsing errors that would trigger DLQ", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "parse-error-test",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/parse-error-test",
                },
              },
            },
          },
        ],
      };

      const context = createMockLambdaContext() as unknown as Context;

      // Mock S3 to return corrupted email data
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.from("corrupted-email-data-that-cannot-be-parsed")),
        },
      });

      // Mock parser to throw unrecoverable error
      (simpleParser as Mock).mockRejectedValue(
        new Error("Email parsing failed: corrupted data structure")
      );

      // This should throw an unrecoverable error that would send to DLQ after retries
      await expect(handler(sesEvent, context))
        .rejects.toThrow("Email parsing failed");
    });

    it("should handle Lambda runtime errors that would trigger DLQ", async () => {
      const sesEvent: SESEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              mail: {
                messageId: "runtime-error-test",
                timestamp: "2024-01-01T12:00:00.000Z",
                source: "sender@example.com",
                destination: ["test@example.com"],
              } as SESMail,
              receipt: {
                recipients: ["test@example.com"],
                timestamp: "2024-01-01T12:00:00.000Z",
                processingTimeMillis: 100,
                ...defaultReceiptVerdicts,
                action: {
                  type: "S3",
                  bucketName: "test-bucket",
                  objectKey: "raw-emails/runtime-error-test",
                },
              },
            },
          },
        ],
      };

      const context = createMockLambdaContext() as unknown as Context;

      // Mock S3 to return valid email first, then fail on metadata storage
      mockS3Client.send
        .mockResolvedValueOnce({
          Body: {
            transformToByteArray: () =>
              Promise.resolve(Buffer.from("Valid email content")),
          },
        })
        .mockRejectedValue(new Error("Lambda runtime out of memory"));

      // Mock parser to return valid email
      (simpleParser as Mock).mockResolvedValue({
        from: { text: "sender@example.com" },
        to: { text: "test@example.com" },
        subject: "Test Email",
        attachments: [],
      });

      // This should throw a runtime error that would send to DLQ after retries
      await expect(handler(sesEvent, context))
        .rejects.toThrow("Lambda runtime out of memory");
    });

    it("should handle malformed SES events that would trigger DLQ", async () => {
      // Malformed SES event missing required fields
      const malformedEvent = {
        Records: [
          {
            eventSource: "aws:ses",
            eventVersion: "1.0",
            ses: {
              // Missing mail object
              receipt: {
                recipients: ["test@example.com"],
              },
            },
          },
        ],
      } as unknown as SESEvent;

      const context = createMockLambdaContext() as unknown as Context;

      // This should throw an error due to malformed event structure
      await expect(handler(malformedEvent, context))
        .rejects.toThrow();
    });
  });
});
