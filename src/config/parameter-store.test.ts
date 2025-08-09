import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParameterStoreConfig } from "./parameter-store";

// Mock the environment first
vi.mock("./environment", () => ({
  environmentConfig: {
    environment: "test",
    awsRegion: "us-east-1",
    awsAccount: "",
  },
}));

// Mock the AWS SDK
vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetParameterCommand: vi.fn(),
  GetParametersCommand: vi.fn(),
}));

/**
 * Test Suite: ParameterStoreConfig
 *
 * This test suite validates the ParameterStoreConfig class, which is responsible
 * for managing application configuration stored in AWS Systems Manager Parameter Store.
 *
 * The ParameterStoreConfig provides a centralized, cached approach to:
 * - Retrieving property mapping configurations (sender email → property ID)
 * - Loading email configuration (recipients, alert addresses, from addresses)
 * - Managing environment-specific parameter paths
 * - Implementing caching to reduce AWS API calls and improve performance
 * - Handling parameter store errors gracefully with fallbacks
 *
 * Test Coverage Areas:
 * - Property mapping retrieval and caching
 * - Email configuration loading with fallback values
 * - Cache invalidation and refresh mechanisms
 * - Error handling for missing parameters
 * - AWS SDK integration and mocking
 * - Environment-specific parameter path resolution
 * - Graceful degradation when Parameter Store is unavailable
 */
describe("ParameterStoreConfig", () => {
  let parameterStore: ParameterStoreConfig;
  let mockSSMClient: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    parameterStore = new ParameterStoreConfig();
    mockSSMClient = (
      parameterStore as unknown as { ssmClient: { send: ReturnType<typeof vi.fn> } }
    ).ssmClient;
  });

  describe("getReportRecipients", () => {
    it("should return array of email addresses", async () => {
      // Mock successful response
      mockSSMClient.send.mockResolvedValue({
        Parameter: {
          Value: "user1@example.com, user2@example.com, user3@example.com",
        },
      });

      const result = await parameterStore.getReportRecipients();

      expect(result).toEqual([
        "user1@example.com",
        "user2@example.com",
        "user3@example.com",
      ]);
    });

    it("should return empty array when parameter not found", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: null },
      });

      const result = await parameterStore.getReportRecipients();
      expect(result).toEqual([]);
    });

    it("should handle whitespace in email list", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: {
          Value:
            " user1@example.com ,  user2@example.com  , user3@example.com ",
        },
      });

      const result = await parameterStore.getReportRecipients();

      expect(result).toEqual([
        "user1@example.com",
        "user2@example.com",
        "user3@example.com",
      ]);
    });
  });

  describe("getAlertNotificationEmail", () => {
    it("should return alert email from parameter store", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: "alerts@example.com" },
      });

      const result = await parameterStore.getAlertNotificationEmail();
      expect(result).toBe("alerts@example.com");
    });

    it("should return fallback email when parameter not found", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: null },
      });

      const result = await parameterStore.getAlertNotificationEmail();
      expect(result).toBe("alerts@example.com");
    });
  });

  describe("getFromEmailAddress", () => {
    it("should return from email from parameter store", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: "custom@example.com" },
      });

      const result = await parameterStore.getFromEmailAddress();
      expect(result).toBe("custom@example.com");
    });

    it("should return fallback email when parameter not found", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: null },
      });

      const result = await parameterStore.getFromEmailAddress();
      expect(result).toBe("dev@example.com"); // test environment gets dev email
    });
  });

  describe("getSESConfigurationSet", () => {
    it("should return SES config set from parameter store", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: "custom-config-set" },
      });

      const result = await parameterStore.getSESConfigurationSet();
      expect(result).toBe("custom-config-set");
    });

    it("should return fallback config set when parameter not found", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: null },
      });

      const result = await parameterStore.getSESConfigurationSet();
      expect(result).toBe("report-builder-test");
    });
  });

  describe("getPropertyMapping", () => {
    it("should return parsed JSON mapping", async () => {
      const mockMapping = {
        "property1@example.com": "property-1",
        "property2@example.com": "property-2",
      };

      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: JSON.stringify(mockMapping) },
      });

      const result = await parameterStore.getPropertyMapping();
      expect(result).toEqual(mockMapping);
    });

    it("should return empty object when parameter not found", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: null },
      });

      const result = await parameterStore.getPropertyMapping();
      expect(result).toEqual({});
    });

    it("should handle invalid JSON gracefully", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: "invalid-json" },
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const result = await parameterStore.getPropertyMapping();
      expect(result).toEqual({});
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to parse property mapping JSON:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getEmailConfiguration", () => {
    it("should return complete email configuration", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameters: [
          {
            Name: "/report-builder/test/email/recipients",
            Value: "user1@example.com,user2@example.com",
          },
          {
            Name: "/report-builder/test/email/alert-notifications",
            Value: "alerts@example.com",
          },
          {
            Name: "/report-builder/test/email/from-address",
            Value: "test@example.com",
          },
          {
            Name: "/report-builder/test/ses/configuration-set",
            Value: "test-config-set",
          },
        ],
      });

      const result = await parameterStore.getEmailConfiguration();

      expect(result).toEqual({
        recipients: ["user1@example.com", "user2@example.com"],
        alertEmail: "alerts@example.com",
        fromEmail: "test@example.com",
        sesConfigurationSet: "test-config-set",
      });
    });

    it("should use fallback values when parameters not found", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameters: [],
        InvalidParameters: [
          "/report-builder/test/email/recipients",
          "/report-builder/test/email/alert-notifications",
          "/report-builder/test/email/from-address",
          "/report-builder/test/ses/configuration-set",
        ],
      });

      const result = await parameterStore.getEmailConfiguration();

      expect(result).toEqual({
        recipients: [],
        alertEmail: "alerts@example.com",
        fromEmail: "dev@example.com",
        sesConfigurationSet: "report-builder-test",
      });
    });
  });

  describe("caching", () => {
    it("should cache parameter values", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: "cached-value" },
      });

      // First call
      const result1 = await parameterStore.getAlertNotificationEmail();
      // Second call should use cache
      const result2 = await parameterStore.getAlertNotificationEmail();

      expect(result1).toBe("cached-value");
      expect(result2).toBe("cached-value");
      expect(mockSSMClient.send).toHaveBeenCalledTimes(1);
    });

    it("should clear cache when requested", async () => {
      mockSSMClient.send.mockResolvedValue({
        Parameter: { Value: "initial-value" },
      });

      // First call
      await parameterStore.getAlertNotificationEmail();

      // Clear cache
      parameterStore.clearCache();

      // Second call should make new request
      await parameterStore.getAlertNotificationEmail();

      expect(mockSSMClient.send).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("should handle ParameterNotFound errors gracefully", async () => {
      const error = new Error("Parameter not found");
      error.name = "ParameterNotFound";
      mockSSMClient.send.mockRejectedValue(error);

      const consoleSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const result = await parameterStore.getAlertNotificationEmail();
      expect(result).toBe("alerts@example.com");
      expect(consoleSpy).toHaveBeenCalledWith(
        "Parameter not found: /report-builder/test/email/alert-notifications",
      );

      consoleSpy.mockRestore();
    });

    it("should throw error for other AWS errors", async () => {
      const error = new Error("Access denied");
      error.name = "AccessDenied";
      mockSSMClient.send.mockRejectedValue(error);

      await expect(parameterStore.getAlertNotificationEmail()).rejects.toThrow(
        "Failed to retrieve parameter: /report-builder/test/email/alert-notifications",
      );
    });

    it("should handle getParameters error gracefully", async () => {
      const error = new Error("Network error");
      mockSSMClient.send.mockRejectedValue(error);

      await expect(parameterStore.getEmailConfiguration()).rejects.toThrow(
        "Failed to retrieve parameters from Parameter Store",
      );
    });
  });
});
