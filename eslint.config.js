import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // Apply to TypeScript files
  {
    files: ['**/*.ts'],
    ignores: ['dist/', 'node_modules/', 'cdk.out/', '*.js', 'infrastructure/'],
  },
  
  // Base ESLint recommended rules
  js.configs.recommended,
  
  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,
  
  // Custom rules
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
