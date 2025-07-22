import { describe, it, expect, vi } from 'vitest';
import { config } from './environment';

describe('Environment Configuration', () => {
  it('should have default values', () => {
    expect(config.environment).toBeDefined();
    expect(config.awsRegion).toBeDefined();
    expect(config.awsAccount).toBeDefined();
  });

  it('should use NODE_ENV from environment', () => {
    // Vitest sets NODE_ENV to 'test' by default
    expect(config.environment).toBe('test');
  });

  it('should have default AWS region', () => {
    expect(config.awsRegion).toBe('us-east-1');
  });

  it('should handle missing AWS_REGION environment variable', async () => {
    // Test the default fallback when AWS_REGION is not set
    const originalRegion = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    
    // Re-import to get fresh config
    vi.resetModules();
    const { config: freshConfig } = await import('./environment');
    
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
    const { config: freshConfig } = await import('./environment');
    
    expect(freshConfig.environment).toBe('development');
    
    // Restore original value
    if (originalNodeEnv) {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
}); 