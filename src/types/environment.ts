/**
 * Environment configuration types
 */

export interface EnvironmentConfig {
  environment: 'development' | 'production' | 'test';
  awsRegion: string;
  awsAccount: string;
} 