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
        'node_modules/',
        'dist/',
        'coverage/',
        '**/*.d.ts',
        'infrastructure/',
        '**/*.config.*',
        '**/*.eslintrc.*',
        '.husky/',
        'tests/**',  // Exclude all test files and helpers
        'src/types/**',  // Exclude type definitions
        'src/lambda/file-processor.ts',  // Exclude placeholder file
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