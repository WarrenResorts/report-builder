/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [
      'tests/integration/**/*.test.ts',  // Exclude integration tests from unit test runs
      'node_modules/**',
      'dist/**',
      'coverage/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',  // Exclude all node_modules
        '**/node_modules/**',  // Exclude nested node_modules
        'dist/**',
        'coverage/**',
        'cdk.out/**',  // Exclude CDK build output
        '**/cdk.out/**',  // Exclude nested CDK outputs
        '**/*.d.ts',
        'infrastructure/**/*.ts',  // Exclude infrastructure TypeScript files
        'infrastructure/**/*.js',  // Exclude infrastructure JavaScript files
        '**/*.config.*',
        '**/*.eslintrc.*',
        '.husky/',
        'tests/**',  // Exclude all test files and helpers
        'src/types/**',  // Exclude type definitions
        '*.js',  // Exclude temporary debug files in root
        '*.cjs',  // Exclude CommonJS debug files in root
        '*.mjs',  // Exclude ES module debug files in root
        'test-*.js',  // Exclude test scripts
        'test-*.cjs',  // Exclude test scripts (CommonJS)
        'test-*.mjs',  // Exclude test scripts (ES modules)
        'debug-*.js',  // Exclude debug scripts
        'debug-*.cjs',  // Exclude debug scripts (CommonJS)
        'debug-*.mjs',  // Exclude debug scripts (ES modules)
        'analyze-*.js',  // Exclude analysis scripts
        'examine-*.js',  // Exclude examination scripts
        'trace-*.js',  // Exclude trace scripts
        'extract-*.js',  // Exclude extraction scripts
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
}); 