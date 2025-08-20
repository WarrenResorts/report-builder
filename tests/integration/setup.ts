/**
 * @fileoverview Integration Test Setup
 * 
 * This file provides setup and configuration for integration tests.
 * It handles environment detection and provides appropriate mocking
 * when real AWS services aren't available.
 */

import { beforeAll, afterAll } from 'vitest';

/**
 * Determine if we should run against real AWS services
 */
export const shouldUseRealAWS = (): boolean => {
  // Check if we have AWS credentials
  const hasAwsCredentials = !!(
    process.env.AWS_ACCESS_KEY_ID || 
    process.env.AWS_PROFILE ||
    process.env.AWS_SESSION_TOKEN
  );
  
  // Check if we're explicitly told to use real AWS
  const forceRealAWS = process.env.USE_REAL_AWS === 'true';
  
  // Check if we're in a CI environment with proper setup
  const isProperCI = process.env.CI === 'true' && process.env.INTEGRATION_TEST_ENVIRONMENT;
  
  return forceRealAWS || (hasAwsCredentials && isProperCI);
};

/**
 * Integration test mode - determines test behavior
 */
export const getTestMode = (): 'real-aws' | 'mocked' | 'skip' => {
  if (process.env.SKIP_INTEGRATION_TESTS === 'true') {
    return 'skip';
  }
  
  if (shouldUseRealAWS()) {
    return 'real-aws';
  }
  
  return 'mocked';
};

/**
 * Global setup for integration tests
 */
beforeAll(async () => {
  const testMode = getTestMode();
  
  console.log(`🔧 Integration test mode: ${testMode}`);
  
  if (testMode === 'skip') {
    console.log('⏭️  Skipping integration tests (SKIP_INTEGRATION_TESTS=true)');
    return;
  }
  
  if (testMode === 'mocked') {
    console.log('🎭 Using mocked AWS services for integration tests');
    console.log('💡 To test against real AWS, set USE_REAL_AWS=true and provide credentials');
  } else {
    console.log('☁️  Using real AWS services for integration tests');
    console.log(`🌍 Environment: ${process.env.INTEGRATION_TEST_ENVIRONMENT || 'development'}`);
  }
});

/**
 * Global cleanup for integration tests
 */
afterAll(async () => {
  const testMode = getTestMode();
  
  if (testMode === 'mocked') {
    console.log('🧹 Cleaning up mocked AWS services');
  } else if (testMode === 'real-aws') {
    console.log('🧹 Cleaning up real AWS test resources');
  }
});
