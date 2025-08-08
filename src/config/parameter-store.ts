import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand,
} from "@aws-sdk/client-ssm";
import { environmentConfig } from "./environment";
import {
  PropertyMappingConfig,
  EmailConfiguration,
} from "../types/parameter-store";

/**
 * Configuration service for retrieving settings from AWS Parameter Store
 * Provides centralized, secure access to sensitive configuration data
 */
export class ParameterStoreConfig {
  private ssmClient: SSMClient;
  private cache = new Map<string, { value: string | null; expiry: number }>();
  private readonly cacheTTL: number;

  constructor() {
    this.ssmClient = new SSMClient({ region: environmentConfig.awsRegion });

    // Get cache TTL from environment variable or use default
    const cacheTTLSeconds = parseInt(
      process.env.PARAMETER_STORE_CACHE_TTL_SECONDS || "300",
      10,
    );
    this.cacheTTL = cacheTTLSeconds * 1000; // Convert to milliseconds
  }

  /**
   * Get email recipients for consolidated reports
   * @returns Array of email addresses to receive daily reports
   */
  async getReportRecipients(): Promise<string[]> {
    const paramName = `/report-builder/${environmentConfig.environment}/email/recipients`;
    const value = await this.getParameter(paramName);

    // Parameter Store StringList returns comma-separated values
    return value ? value.split(",").map((email: string) => email.trim()) : [];
  }

  /**
   * Get alert notification email address
   * @returns Email address for system alerts and error notifications
   */
  async getAlertNotificationEmail(): Promise<string> {
    const paramName = `/report-builder/${environmentConfig.environment}/email/alert-notifications`;
    const value = await this.getParameter(paramName);
    return value || "alerts@warrenresorthotels.com"; // fallback
  }

  /**
   * Get sender email address for outgoing reports
   * @returns Email address to use as sender for consolidated reports
   */
  async getFromEmailAddress(): Promise<string> {
    const paramName = `/report-builder/${environmentConfig.environment}/email/from-address`;
    const value = await this.getParameter(paramName);
    return value || "reports@warrenresorthotels.com"; // fallback
  }

  /**
   * Get property mapping configuration
   * @returns Mapping of sender email addresses to property information
   */
  async getPropertyMapping(): Promise<PropertyMappingConfig> {
    const paramName = `/report-builder/${environmentConfig.environment}/properties/email-mapping`;
    const value = await this.getParameter(paramName);

    try {
      return value ? JSON.parse(value) : {};
    } catch (error) {
      console.error("Failed to parse property mapping JSON:", error);
      return {};
    }
  }

  /**
   * Get SES configuration set name
   * @returns SES configuration set name for the current environment
   */
  async getSESConfigurationSet(): Promise<string> {
    const paramName = `/report-builder/${environmentConfig.environment}/ses/configuration-set`;
    const value = await this.getParameter(paramName);
    return value || `report-builder-${environmentConfig.environment}`;
  }

  /**
   * Get all email-related configuration at once for efficiency
   * @returns Complete email configuration object
   */
  async getEmailConfiguration(): Promise<EmailConfiguration> {
    const paramNames = [
      `/report-builder/${environmentConfig.environment}/email/recipients`,
      `/report-builder/${environmentConfig.environment}/email/alert-notifications`,
      `/report-builder/${environmentConfig.environment}/email/from-address`,
      `/report-builder/${environmentConfig.environment}/ses/configuration-set`,
    ];

    const parameters = await this.getParameters(paramNames);

    return {
      recipients: parameters[paramNames[0]]
        ? parameters[paramNames[0]]
            .split(",")
            .map((email: string) => email.trim())
        : [],
      alertEmail: parameters[paramNames[1]] || "alerts@warrenresorthotels.com",
      fromEmail: parameters[paramNames[2]] || "reports@warrenresorthotels.com",
      sesConfigurationSet:
        parameters[paramNames[3]] ||
        `report-builder-${environmentConfig.environment}`,
    };
  }

  /**
   * Retrieve a single parameter from Parameter Store with caching
   * @param parameterName - Full parameter name including path
   * @returns Parameter value or null if not found
   */
  private async getParameter(parameterName: string): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(parameterName);
    if (cached && Date.now() < cached.expiry) {
      return cached.value;
    }

    try {
      const command = new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true, // Support encrypted parameters
      });

      const response = await this.ssmClient.send(command);
      const value = response.Parameter?.Value || null;

      // Cache the result
      this.cache.set(parameterName, {
        value,
        expiry: Date.now() + this.cacheTTL,
      });

      return value;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "ParameterNotFound") {
        console.warn(`Parameter not found: ${parameterName}`);
        return null;
      }

      console.error(`Error retrieving parameter ${parameterName}:`, error);
      throw new Error(`Failed to retrieve parameter: ${parameterName}`);
    }
  }

  /**
   * Retrieve multiple parameters at once for efficiency
   * @param parameterNames - Array of parameter names
   * @returns Object mapping parameter names to values
   */
  private async getParameters(
    parameterNames: string[],
  ): Promise<Record<string, string>> {
    try {
      const command = new GetParametersCommand({
        Names: parameterNames,
        WithDecryption: true,
      });

      const response = await this.ssmClient.send(command);
      const result: Record<string, string> = {};

      response.Parameters?.forEach((param) => {
        if (param.Name && param.Value) {
          result[param.Name] = param.Value;
        }
      });

      // Log any parameters that weren't found
      response.InvalidParameters?.forEach((paramName) => {
        console.warn(`Parameter not found: ${paramName}`);
      });

      return result;
    } catch (error) {
      console.error("Error retrieving multiple parameters:", error);
      throw new Error("Failed to retrieve parameters from Parameter Store");
    }
  }

  /**
   * Clear the parameter cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Singleton instance for application-wide use
 */
export const parameterStoreConfig = new ParameterStoreConfig();
