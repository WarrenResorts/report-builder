import * as path from 'path';
import * as fs from 'fs';
import { EnvironmentConfig, Environment, ConfigValidationResult } from './types';

/**
 * Configuration loader for environment-specific settings
 * 
 * This class handles loading, validating, and providing access to
 * environment-specific configuration for the Report Builder infrastructure.
 */
export class ConfigLoader {
  private static instance: ConfigLoader | null = null;
  private configs: Map<Environment, EnvironmentConfig> = new Map();

  private constructor() {
    this.loadConfigurations();
  }

  /**
   * Get singleton instance of ConfigLoader
   */
  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  /**
   * Get configuration for specified environment
   * 
   * @param environment - Target environment (development/production)
   * @returns Environment configuration
   * @throws {Error} If configuration is not found or invalid
   */
  public getConfig(environment: Environment): EnvironmentConfig {
    const config = this.configs.get(environment);
    if (!config) {
      throw new Error(`Configuration not found for environment: ${environment}`);
    }

    const validation = this.validateConfig(config);
    if (!validation.isValid) {
      throw new Error(`Invalid configuration for ${environment}: ${validation.errors.join(', ')}`);
    }

    return config;
  }

  /**
   * Get all available environment configurations
   * 
   * @returns Map of environment to configuration
   */
  public getAllConfigs(): Map<Environment, EnvironmentConfig> {
    return new Map(this.configs);
  }

  /**
   * Validate a configuration object
   * 
   * @param config - Configuration to validate
   * @returns Validation result with errors and warnings
   */
  public validateConfig(config: EnvironmentConfig): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (!config.environment) {
      errors.push('Environment is required');
    }

    if (!config.domain?.domainName) {
      errors.push('Domain name is required');
    }

    if (!config.domain?.emailAddress) {
      errors.push('Email address is required');
    }

    if (!config.naming?.projectPrefix) {
      errors.push('Project prefix is required');
    }

    // Validate Lambda configuration
    if (config.lambda?.emailProcessor?.timeoutMinutes <= 0) {
      errors.push('Email processor timeout must be positive');
    }

    if (config.lambda?.emailProcessor?.memoryMB < 128) {
      errors.push('Email processor memory must be at least 128 MB');
    }

    if (config.lambda?.fileProcessor?.timeoutMinutes <= 0) {
      errors.push('File processor timeout must be positive');
    }

    if (config.lambda?.fileProcessor?.memoryMB < 128) {
      errors.push('File processor memory must be at least 128 MB');
    }

    // Validate storage configuration
    if (config.storage?.incomingFiles?.transitionToIADays <= 0) {
      errors.push('Incoming files IA transition days must be positive');
    }

    if (config.storage?.incomingFiles?.transitionToGlacierDays <= config.storage?.incomingFiles?.transitionToIADays) {
      errors.push('Glacier transition must be after IA transition for incoming files');
    }

    // Validate scheduling configuration
    if (!config.scheduling?.dailyProcessing?.cronExpression) {
      errors.push('Daily processing cron expression is required');
    }

    if (!config.scheduling?.weeklyReporting?.cronExpression) {
      errors.push('Weekly reporting cron expression is required');
    }

    // Validate cron expressions format
    if (config.scheduling?.dailyProcessing?.cronExpression && 
        !this.isValidCronExpression(config.scheduling.dailyProcessing.cronExpression)) {
      errors.push('Invalid daily processing cron expression format');
    }

    if (config.scheduling?.weeklyReporting?.cronExpression && 
        !this.isValidCronExpression(config.scheduling.weeklyReporting.cronExpression)) {
      errors.push('Invalid weekly reporting cron expression format');
    }

    // Validate domain name format
    if (config.domain?.domainName && !this.isValidDomainName(config.domain.domainName)) {
      errors.push('Invalid domain name format');
    }

    // Validate email address format
    if (config.domain?.emailAddress && !this.isValidEmailAddress(config.domain.emailAddress)) {
      errors.push('Invalid email address format');
    }

    // Generate warnings for potential issues
    if (config.environment === 'production' && config.lambda.emailProcessor.timeoutMinutes < 5) {
      warnings.push('Email processor timeout may be too low for production');
    }

    if (config.environment === 'production' && config.storage.incomingFiles.transitionToIADays < 30) {
      warnings.push('Consider longer IA transition period for production');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Load configurations from environment-specific files
   */
  private loadConfigurations(): void {
    const configDir = path.join(__dirname, 'environments');
    
    if (!fs.existsSync(configDir)) {
      throw new Error(`Configuration directory not found: ${configDir}`);
    }

    const environments: Environment[] = ['development', 'production'];
    
    for (const env of environments) {
      try {
        const configFile = path.join(configDir, `${env}.json`);
        
        if (fs.existsSync(configFile)) {
          const configData = fs.readFileSync(configFile, 'utf-8');
          const config: EnvironmentConfig = JSON.parse(configData);
          
          // Ensure environment field matches filename
          config.environment = env;
          
          this.configs.set(env, config);
        } else {
          console.warn(`Configuration file not found: ${configFile}`);
        }
      } catch (error) {
        throw new Error(`Failed to load configuration for ${env}: ${error}`);
      }
    }

    if (this.configs.size === 0) {
      throw new Error('No valid configurations found');
    }
  }

  /**
   * Validate cron expression format (basic validation)
   */
  private isValidCronExpression(cron: string): boolean {
    // Basic AWS cron validation: cron(fields) format with 6 or 7 fields
    const cronRegex = /^cron\([^\)]+\)$/;
    if (!cronRegex.test(cron)) {
      return false;
    }

    // Extract the cron expression content
    const cronContent = cron.slice(5, -1); // Remove 'cron(' and ')'
    const fields = cronContent.split(/\s+/);
    
    // AWS EventBridge cron expressions have 6 fields: minute hour day-of-month month day-of-week year
    return fields.length === 6;
  }

  /**
   * Validate domain name format
   */
  private isValidDomainName(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
    return domainRegex.test(domain) && domain.length <= 253;
  }

  /**
   * Validate email address format
   */
  private isValidEmailAddress(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Get resource name using naming convention
   * 
   * @param config - Environment configuration
   * @param resourceType - Type of resource (e.g., 'lambda', 'bucket')
   * @param resourceName - Specific resource name (e.g., 'email-processor')
   * @returns Formatted resource name
   */
  public static getResourceName(config: EnvironmentConfig, resourceType: string, resourceName: string): string {
    const { projectPrefix, separator } = config.naming;
    return `${projectPrefix}${separator}${resourceType}${separator}${resourceName}${separator}${config.environment}`;
  }

  /**
   * Get S3 bucket name using naming convention
   * 
   * @param config - Environment configuration
   * @param bucketType - Type of bucket (e.g., 'incoming-files', 'processed-files')
   * @returns Formatted bucket name
   */
  public static getBucketName(config: EnvironmentConfig, bucketType: string): string {
    return ConfigLoader.getResourceName(config, bucketType, '').replace(/--/, '-').replace(/-$/, '');
  }
} 