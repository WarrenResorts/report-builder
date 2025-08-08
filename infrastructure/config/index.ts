/**
 * Environment-specific configuration module for Report Builder infrastructure
 * 
 * This module provides a centralized configuration system that allows
 * different settings for development and production environments.
 */

export * from './types';
export * from './loader';

// Re-export main classes for convenience
export { ConfigLoader } from './loader';
export type { 
  EnvironmentConfig, 
  Environment, 
  ConfigValidationResult,
  DomainConfig,
  NamingConfig,
  LambdaConfig,
  StorageConfig,
  SchedulingConfig,
  TaggingConfig,
  MonitoringConfig
} from './types'; 