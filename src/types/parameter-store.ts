/**
 * Parameter Store configuration types
 */

/**
 * Property mapping configuration interface
 * Maps sender email addresses to property IDs
 */
export interface PropertyMappingConfig {
  [senderEmail: string]: string; // Maps sender email to property ID
}

/**
 * Complete email configuration interface
 * Contains all email-related settings from Parameter Store
 */
export interface EmailConfiguration {
  recipients: string[];
  alertEmail: string;
  fromEmail: string;
  sesConfigurationSet: string;
} 