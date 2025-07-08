module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    // Allow any for CDK constructs
    '@typescript-eslint/no-explicit-any': 'off',
    // Allow unused vars with underscore prefix
    '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    // Allow console.log in infrastructure code
    'no-console': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    'cdk.out/',
    '*.js',
    '*.d.ts',
  ],
}; 