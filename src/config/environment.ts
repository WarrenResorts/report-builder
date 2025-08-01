import { EnvironmentConfig } from '../types/environment';

/**
 * Default values for environment configuration
 */
const DEFAULTS = {
  NODE_ENV: 'development' as const,
  AWS_REGION: 'us-east-1',
  AWS_ACCOUNT: '', // Optional, can be empty
} as const;

/**
 * Required environment variables that must be present
 */
const REQUIRED_ENV_VARS = [
  'NODE_ENV',
] as const;

/**
 * Validates that required environment variables are present
 * @throws {Error} When required environment variables are missing
 */
const validateEnvironment = (): void => {
  const missing = REQUIRED_ENV_VARS.filter(key => 
    !process.env[key] && !DEFAULTS[key]
  );
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please check your environment configuration.'
    );
  }
};

/**
 * Gets the current environment configuration with validation and defaults
 * @returns {EnvironmentConfig} Validated environment configuration
 * @throws {Error} When required environment variables are missing or invalid
 */
const getEnvironmentConfig = (): EnvironmentConfig => {
  // Validate required environment variables
  validateEnvironment();
  
  const nodeEnv = process.env.NODE_ENV || DEFAULTS.NODE_ENV;
  
  // Validate NODE_ENV is one of the allowed values
  const allowedEnvironments = ['development', 'production', 'test'] as const;
  if (!allowedEnvironments.includes(nodeEnv as typeof allowedEnvironments[number])) {
    throw new Error(
      `Invalid NODE_ENV: "${nodeEnv}". Must be one of: ${allowedEnvironments.join(', ')}`
    );
  }
  
  return {
    environment: nodeEnv as 'development' | 'production' | 'test',
    awsRegion: process.env.AWS_REGION || DEFAULTS.AWS_REGION,
    awsAccount: process.env.AWS_ACCOUNT || DEFAULTS.AWS_ACCOUNT,
  };
};

/**
 * Environment configuration instance with validation and defaults applied
 * @throws {Error} When environment validation fails
 */
export const environmentConfig = getEnvironmentConfig(); 