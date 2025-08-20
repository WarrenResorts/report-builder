/**
 * @fileoverview Vitest Configuration for Integration Tests
 * 
 * This configuration file is specifically for integration tests that require:
 * - Longer timeouts for AWS service interactions
 * - Real AWS credentials and network connectivity
 * - Separate test patterns to avoid conflicts with unit tests
 * - Extended setup and teardown for AWS resources
 */

/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    // Test file patterns - only run integration tests
    include: [
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.js'
    ],
    
    // Exclude unit test patterns to avoid conflicts
    exclude: [
      'src/**/*.test.ts',
      'src/**/*.test.js',
      'node_modules/**',
      'dist/**',
      'infrastructure/**'
    ],

    // Extended timeouts for AWS service interactions
    testTimeout: 60000,  // 60 seconds per test
    hookTimeout: 30000,  // 30 seconds for setup/teardown hooks

    // Global setup and teardown
    globalSetup: [],     // Could add global AWS setup if needed
    
    // Environment configuration
    environment: 'node',
    
    // Pool options for concurrent execution
    pool: 'threads',
    poolOptions: {
      threads: {
        // Limit concurrency to avoid AWS rate limits
        maxThreads: 3,
        minThreads: 1,
      }
    },

    // Reporter configuration
    reporter: ['verbose', 'json'],
    
    // Coverage configuration (separate from unit tests)
    coverage: {
      enabled: false, // Integration tests don't need coverage
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage/integration'
    },

    // Retry configuration for flaky AWS operations
    retry: 2,
    
    // Bail after first failure in CI environments
    bail: process.env.CI ? 1 : 0,

    // Output configuration
    outputFile: {
      json: './test-results/integration-results.json'
    },

    // Watch mode configuration
    watch: false, // Disable watch mode by default for integration tests
    
    // Setup files for integration test environment
    setupFiles: ['./tests/integration/setup.ts'],
    
    // Global test configuration
    globals: false, // Explicit imports for better IDE support
    
    // Silent mode for less verbose output
    silent: false
  },

  // TypeScript configuration
  esbuild: {
    target: 'node20'
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': './src',
      '@tests': './tests'
    }
  },

  // Define configuration for environment variables
  define: {
    // Ensure integration tests know they're running in test mode
    'process.env.VITEST_INTEGRATION': 'true'
  }
}); 