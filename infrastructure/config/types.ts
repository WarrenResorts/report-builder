/**
 * Environment-specific configuration types for the Report Builder infrastructure
 */

/**
 * Domain and email configuration
 */
export interface DomainConfig {
  /** Primary domain name for SES (e.g., 'aws.warrenresorthotels.com') */
  domainName: string;
  /** Email address for receiving reports (e.g., 'reports@aws.warrenresorthotels.com') */
  emailAddress: string;
}

/**
 * Resource naming configuration
 */
export interface NamingConfig {
  /** Project prefix for all resources (e.g., 'report-builder') */
  projectPrefix: string;
  /** Separator for resource names (e.g., '-') */
  separator: string;
}

/**
 * Lambda function configuration
 */
export interface LambdaConfig {
  /** Email processor Lambda settings */
  emailProcessor: {
    /** Function timeout in minutes */
    timeoutMinutes: number;
    /** Memory allocation in MB */
    memoryMB: number;
  };
  /** File processor Lambda settings */
  fileProcessor: {
    /** Function timeout in minutes */
    timeoutMinutes: number;
    /** Memory allocation in MB */
    memoryMB: number;
  };
}

/**
 * S3 storage lifecycle configuration
 */
export interface StorageConfig {
  /** Incoming files bucket lifecycle rules */
  incomingFiles: {
    /** Days before transitioning to Infrequent Access */
    transitionToIADays: number;
    /** Days before transitioning to Glacier */
    transitionToGlacierDays: number;
  };
  /** Processed files bucket lifecycle rules */
  processedFiles: {
    /** Days before transitioning to Infrequent Access */
    transitionToIADays: number;
    /** Days before transitioning to Glacier */
    transitionToGlacierDays: number;
  };
  /** Mapping files bucket lifecycle rules */
  mappingFiles: {
    /** Days before transitioning to Infrequent Access */
    transitionToIADays: number;
  };
}

/**
 * EventBridge scheduling configuration
 */
export interface SchedulingConfig {
  /** Daily batch processing schedule */
  dailyProcessing: {
    /** Cron expression for daily processing */
    cronExpression: string;
    /** Human-readable description */
    description: string;
  };
  /** Weekly report generation schedule */
  weeklyReporting: {
    /** Cron expression for weekly reporting */
    cronExpression: string;
    /** Human-readable description */
    description: string;
  };
  /** Event retention and retry configuration */
  eventRetention: {
    /** Maximum event age in hours */
    maxEventAgeHours: number;
    /** Number of retry attempts */
    retryAttempts: number;
  };
}

/**
 * Tagging configuration for cost tracking and organization
 */
export interface TaggingConfig {
  /** Required tags for all resources */
  required: {
    /** Project name */
    Project: string;
    /** Environment (development/production) */
    Environment: string;
    /** Management system */
    ManagedBy: string;
    /** Cost center for billing */
    CostCenter: string;
  };
  /** Environment-specific optional tags */
  environmentSpecific: Record<string, string>;
}

/**
 * Monitoring and alerting configuration
 */
export interface MonitoringConfig {
  /** Whether to enable enhanced monitoring */
  enhancedMonitoring: boolean;
  /** Whether Lambda insights should be enabled */
  lambdaInsights: boolean;
  /** CloudWatch log retention in days */
  logRetentionDays: number;
}

/**
 * Application-level configuration for runtime behavior
 */
export interface ApplicationConfig {
  /** Parameter Store configuration */
  parameterStore: {
    /** Cache TTL in seconds for Parameter Store values */
    cacheTTLSeconds: number;
  };
}

/**
 * Complete environment configuration
 */
export interface EnvironmentConfig {
  /** Environment name */
  environment: 'development' | 'production';
  /** Domain and email settings */
  domain: DomainConfig;
  /** Resource naming conventions */
  naming: NamingConfig;
  /** Lambda function settings */
  lambda: LambdaConfig;
  /** S3 storage settings */
  storage: StorageConfig;
  /** EventBridge scheduling settings */
  scheduling: SchedulingConfig;
  /** Resource tagging strategy */
  tagging: TaggingConfig;
  /** Monitoring and observability settings */
  monitoring: MonitoringConfig;
  /** Application runtime configuration */
  application: ApplicationConfig;
}

/**
 * Type for environment names
 */
export type Environment = 'development' | 'production';

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  isValid: boolean;
  /** Validation errors if any */
  errors: string[];
  /** Validation warnings if any */
  warnings: string[];
} 