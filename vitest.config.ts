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
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 50,
        statements: 100,
      },
    },
  },
}); 