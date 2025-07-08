module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/test/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  passWithNoTests: true,
  collectCoverageFrom: [
    'lib/**/*.ts',
    'bin/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/cdk.out/**'
  ]
};
