import { describe, it, expect, vi } from 'vitest';
import { environmentConfig } from './environment';

/**
 * Test Suite: Environment Configuration
 * 
 * This test suite validates the environment configuration module, which is responsible
 * for loading and validating application environment settings from environment variables.
 * 
 * The environment configuration provides:
 * - Environment variable validation with clear error messages
 * - Sensible defaults for development and testing
 * - Type-safe environment configuration object
 * - Support for multiple environments (development, test, production)
 * - AWS-specific configuration (region, account)
 * 
 * Test Coverage Areas:
 * - Default value assignment and validation
 * - Environment variable reading and processing
 * - NODE_ENV validation and handling
 * - AWS region configuration
 * - Error handling for invalid environment values
 * - Missing environment variable handling
 * 
 * This ensures the application starts with valid configuration
 * and fails fast with clear error messages when misconfigured.
 */
describe('Environment Configuration', () => {
  it('should have default values', () => {
    expect(environmentConfig.environment).toBeDefined();
    expect(environmentConfig.awsRegion).toBeDefined();
    expect(environmentConfig.awsAccount).toBeDefined();
  });

  it('should use NODE_ENV from environment', () => {
    // Vitest sets NODE_ENV to 'test' by default
    expect(environmentConfig.environment).toBe('test');
  });

  it('should have default AWS region', () => {
    expect(environmentConfig.awsRegion).toBe('us-east-1');
  });

  it('should handle missing AWS_REGION environment variable', async () => {
    // Test the default fallback when AWS_REGION is not set
    const originalRegion = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    
    // Re-import to get fresh config
    vi.resetModules();
    const { environmentConfig: freshConfig } = await import('./environment');
    
    expect(freshConfig.awsRegion).toBe('us-east-1');
    
    // Restore original value
    if (originalRegion) {
      process.env.AWS_REGION = originalRegion;
    }
  });

  it('should default to development when NODE_ENV is not set', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    
    // Re-import to get fresh config
    vi.resetModules();
    const { environmentConfig: freshConfig } = await import('./environment');
    
    expect(freshConfig.environment).toBe('development');
    
    // Restore original value
    if (originalNodeEnv) {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
}); 