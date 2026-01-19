/**
 * @fileoverview Tests for Report Email Sender
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions at module scope
const mockSESSend = vi.fn();
const mockS3Send = vi.fn();
const mockGetEmailConfiguration = vi.fn();

// Mock AWS SDK clients before imports
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: vi.fn().mockImplementation(() => ({
    send: mockSESSend,
  })),
  SendRawEmailCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  GetObjectCommand: vi.fn().mockImplementation((input) => input),
}));

// Mock Parameter Store with factory function
vi.mock("../config/parameter-store", () => ({
  ParameterStoreConfig: vi.fn().mockImplementation(() => ({
    getEmailConfiguration: () => mockGetEmailConfiguration(),
  })),
}));

// Mock environment config
vi.mock("../config/environment", () => ({
  environmentConfig: {
    environment: "test",
    awsRegion: "us-east-1",
  },
}));

// Import after mocks
import { ReportEmailSender, ReportSummary } from "./report-email-sender";

describe("ReportEmailSender", () => {
  const mockEmailConfig = {
    recipients: ["user1@example.com", "user2@example.com"],
    fromEmail: "reports@example.com",
    alertEmail: "alerts@example.com",
    sesConfigurationSet: "report-builder-test",
  };

  const mockSummary: ReportSummary = {
    reportDate: "2025-01-06",
    totalProperties: 11,
    propertyNames: [
      "THE BARD'S INN HOTEL",
      "Crown City Inn",
      "Driftwood Inn",
      "El Bonita Motel",
      "LAKESIDE LODGE AND SUITES",
      "MARINA BEACH MOTEL",
      "BW Plus PONDERAY MOUNTAIN LODGE",
      "Best Western Sawtooth Inn & Suites",
      "Best Western University Lodge",
      "THE VINE INN",
      "Best Western Windsor Inn",
    ],
    totalFiles: 11,
    totalJERecords: 250,
    totalStatJERecords: 66,
    processingTimeMs: 5432,
    errors: [],
  };

  const mockJEContent = `"Entry","Date","Sub Name","Subsidiary","acctnumber","internal id"
"WR2420250106","01/06/2025","THE BARD'S INN HOTEL","26","40100","635"`;

  const mockStatJEContent = `"Transaction ID","Date","Subsidiary","Property Name","Unit of Measure Type"
"01/06/2025 WRH26","01/06/2025","26","THE BARD'S INN HOTEL","statistical"`;

  // Helper to set up default mocks
  const setupDefaultMocks = () => {
    mockGetEmailConfiguration.mockResolvedValue(mockEmailConfig);

    mockS3Send.mockImplementation((input) => {
      const key = input?.Key || "";
      const content =
        key.includes("JE") && !key.includes("StatJE")
          ? mockJEContent
          : mockStatJEContent;
      return Promise.resolve({
        Body: {
          transformToString: () => Promise.resolve(content),
        },
      });
    });

    mockSESSend.mockResolvedValue({
      MessageId: "test-message-id-12345",
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe("sendReportEmail", () => {
    it("should send email successfully with attachments", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("test-message-id-12345");
      expect(result.recipients).toEqual(mockEmailConfig.recipients);
      expect(result.error).toBeUndefined();

      // Verify S3 was called twice (once for each file)
      expect(mockS3Send).toHaveBeenCalledTimes(2);

      // Verify SES was called
      expect(mockSESSend).toHaveBeenCalledTimes(1);
    });

    it("should return failure when no recipients configured", async () => {
      mockGetEmailConfiguration.mockResolvedValue({
        ...mockEmailConfig,
        recipients: [],
      });

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("No email recipients configured");
      expect(result.recipients).toEqual([]);

      // SES should not have been called
      expect(mockSESSend).not.toHaveBeenCalled();
    });

    it("should handle S3 download failure", async () => {
      mockS3Send.mockRejectedValue(new Error("S3 access denied"));

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("S3 access denied");
    });

    it("should handle SES send failure", async () => {
      mockSESSend.mockRejectedValue(new Error("SES throttling"));

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("SES throttling");
    });

    it("should handle Parameter Store failure", async () => {
      mockGetEmailConfiguration.mockRejectedValue(
        new Error("Parameter Store unavailable"),
      );

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Parameter Store unavailable");
    });

    it("should include processing errors in email when present", async () => {
      const summaryWithErrors: ReportSummary = {
        ...mockSummary,
        errors: [
          "Failed to parse file from property X",
          "Missing mapping for account code ABC",
        ],
      };

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        summaryWithErrors,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);

      // Verify the raw email contains the error messages
      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();
      expect(rawEmail).toContain("Processing Warnings");
    });
  });

  describe("email content generation", () => {
    it("should generate correct subject line", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      expect(rawEmail).toContain("Subject: Daily Hotel Reports - 01/06/2025");
      expect(rawEmail).toContain("(11 Properties)");
    });

    it("should include all property names in email body", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      // Check some property names are included
      expect(rawEmail).toContain("BARD");
      expect(rawEmail).toContain("Crown City Inn");
      expect(rawEmail).toContain("MARINA BEACH");
    });

    it("should attach both CSV files", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      // Check attachment headers
      expect(rawEmail).toContain('filename="2025-01-06_JE.csv"');
      expect(rawEmail).toContain('filename="2025-01-06_StatJE.csv"');
      expect(rawEmail).toContain("Content-Type: text/csv");
      expect(rawEmail).toContain("Content-Transfer-Encoding: base64");
    });

    it("should include summary statistics in email body", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      // Check summary statistics (in both HTML and text parts)
      expect(rawEmail).toContain("11"); // Properties count
      expect(rawEmail).toContain("250"); // JE Records
      expect(rawEmail).toContain("66"); // StatJE Records
    });
  });

  describe("edge cases", () => {
    it("should handle empty report files", async () => {
      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve(""),
        },
      });

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
    });

    it("should handle special characters in property names", async () => {
      const summaryWithSpecialChars: ReportSummary = {
        ...mockSummary,
        propertyNames: [
          "O'Brien's Inn & Suites",
          'Hotel "Paradise"',
          "Café <Royal>",
        ],
        totalProperties: 3,
      };

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        summaryWithSpecialChars,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);

      // Verify HTML entities are escaped in the HTML part
      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      // HTML should have escaped characters
      expect(rawEmail).toContain("O&#39;Brien");
      expect(rawEmail).toContain("&quot;Paradise&quot;");
      expect(rawEmail).toContain("&lt;Royal&gt;");
    });

    it("should handle single recipient", async () => {
      mockGetEmailConfiguration.mockResolvedValue({
        ...mockEmailConfig,
        recipients: ["single@example.com"],
      });

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);
      expect(result.recipients).toEqual(["single@example.com"]);

      // Verify the To header
      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();
      expect(rawEmail).toContain("To: single@example.com");
    });

    it("should handle missing S3 body", async () => {
      mockS3Send.mockResolvedValue({
        Body: null,
      });

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No content found for report");
    });

    it("should set SES configuration set header", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary,
        "test-correlation-id",
      );

      expect(mockSESSend).toHaveBeenCalled();
      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      expect(rawEmail).toContain(
        "X-SES-CONFIGURATION-SET: report-builder-test",
      );
    });

    it("should display property details when provided", async () => {
      const summaryWithDetails: ReportSummary = {
        ...mockSummary,
        propertyDetails: [
          {
            propertyName: "Windsor Inn",
            businessDate: "2025-01-05",
            jeRecordCount: 20,
            statJERecordCount: 5,
          },
          {
            propertyName: "Windsor Inn",
            businessDate: "2025-01-06",
            jeRecordCount: 22,
            statJERecordCount: 6,
          },
          {
            propertyName: "Lakeside Lodge",
            businessDate: "2025-01-06",
            jeRecordCount: 25,
            statJERecordCount: 7,
          },
        ],
        dateRange: "01/05/2025 - 01/06/2025",
      };

      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        summaryWithDetails,
        "test-correlation-id",
      );

      expect(result.success).toBe(true);

      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      // Should contain date range in header
      expect(rawEmail).toContain("01/05/2025 - 01/06/2025");
      // Should contain property names
      expect(rawEmail).toContain("Windsor Inn");
      expect(rawEmail).toContain("Lakeside Lodge");
      // Should contain record counts
      expect(rawEmail).toContain("20 JE");
      expect(rawEmail).toContain("22 JE");
      expect(rawEmail).toContain("25 JE");
    });

    it("should fall back to simple list when propertyDetails not provided", async () => {
      const sender = new ReportEmailSender({
        processedBucket: "test-processed-bucket",
        region: "us-east-1",
      });

      const result = await sender.sendReportEmail(
        "reports/2025-01-07/2025-01-06_JE.csv",
        "reports/2025-01-07/2025-01-06_StatJE.csv",
        mockSummary, // No propertyDetails
        "test-correlation-id",
      );

      expect(result.success).toBe(true);

      const sendCall = mockSESSend.mock.calls[0][0];
      const rawEmail = sendCall.RawMessage.Data.toString();

      // Should contain property names in simple list format
      expect(rawEmail).toContain("THE BARD&#39;S INN HOTEL");
      expect(rawEmail).toContain("Crown City Inn");
    });
  });
});
