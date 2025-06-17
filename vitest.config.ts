import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
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