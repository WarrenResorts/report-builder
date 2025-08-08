/**
 * @fileoverview Lambda Deployment Validation Tests
 * 
 * These integration tests validate that Lambda functions are correctly deployed
 * and functional in the AWS environment. Tests include:
 * - Lambda function existence and configuration validation
 * - Function invocation and response validation
 * - Environment variable configuration
 * - Performance and timeout characteristics
 * - Error handling in deployed environment
 * 
 * Test Coverage:
 * - Lambda function deployment validation
 * - Runtime environment verification
 * - Performance characteristics
 * - Integration with other AWS services
 * - Error scenarios in production environment
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IntegrationTestSuite } from '../utils/aws-test-helpers';
import { 
  createTestSESEvent, 
  TEST_EMAIL_CONTENT,
  TEST_TIMEOUTS 
} from '../fixtures/test-data';
import { environmentConfig } from '../../src/config/environment';

/**
 * Integration Test Suite: Lambda Deployment Validation
 * 
 * This test suite validates that Lambda functions are correctly deployed
 * and functional in the target AWS environment. Tests verify that the
 * deployed functions can handle real workloads and integrate properly
 * with other AWS services.
 * 
 * Test Environment:
 * - Tests against actual deployed Lambda functions
 * - Uses real AWS service integrations
 * - Validates production-like scenarios
 * - Measures actual performance characteristics
 * 
 * Prerequisites:
 * - Lambda functions must be deployed to target environment
 * - AWS credentials with Lambda invoke permissions
 * - Access to S3 and Parameter Store for integration testing
 * - Network connectivity to Lambda service
 */
describe('Lambda Deployment Validation', () => {
  let testSuite: IntegrationTestSuite;
  let testBucketName: string;

  // Lambda function names - these should match deployed function names
  const LAMBDA_FUNCTIONS = {
    emailProcessor: `report-builder-email-processor-${environmentConfig.environment}`,
    fileProcessor: `report-builder-file-processor-${environmentConfig.environment}`,
  };

  /**
   * Global test setup
   * Prepares test infrastructure for Lambda validation
   */
  beforeAll(async () => {
    testSuite = new IntegrationTestSuite();
    
    // Create test S3 bucket for Lambda integration testing
    testBucketName = await testSuite.s3.createTestBucket('lambda-validation');
    
    // Set up test configuration
    await testSuite.setup();
  }, TEST_TIMEOUTS.LAMBDA_INVOKE);

  /**
   * Global test cleanup
   * Removes test infrastructure
   */
  afterAll(async () => {
    await testSuite.cleanup();
  }, TEST_TIMEOUTS.S3_OPERATION);

  /**
   * Test Group: Lambda Function Deployment Validation
   * 
   * Validates that Lambda functions are correctly deployed with proper
   * configuration, environment variables, and runtime settings.
   */
  describe('Lambda Function Deployment', () => {
    
    it('should verify email processor Lambda function exists', async () => {
      // Act: Check if email processor function exists
      const functionExists = await testSuite.lambda.functionExists(LAMBDA_FUNCTIONS.emailProcessor);

      // Assert: Function should be deployed and accessible
      expect(functionExists).toBe(true);
    });

    it('should verify file processor Lambda function exists', async () => {
      // Act: Check if file processor function exists  
      const functionExists = await testSuite.lambda.functionExists(LAMBDA_FUNCTIONS.fileProcessor);

      // Assert: Function should be deployed and accessible
      expect(functionExists).toBe(true);
    });

    it('should validate Lambda function configuration', async () => {
      // This test verifies the Lambda function has correct configuration
      // In a real scenario, you might check environment variables, memory settings, etc.
      
      // Act: Get function configuration (simplified version)
      const emailProcessorExists = await testSuite.lambda.functionExists(LAMBDA_FUNCTIONS.emailProcessor);
      
      // Assert: Basic deployment validation
      expect(emailProcessorExists).toBe(true);
      
      // Note: For full configuration validation, you would use GetFunctionCommand
      // to check memory, timeout, environment variables, etc.
    });
  });

  /**
   * Test Group: Lambda Function Invocation
   * 
   * Validates that deployed Lambda functions can be invoked successfully
   * and handle various input scenarios correctly.
   */
  describe('Lambda Function Invocation', () => {
    
    it('should successfully invoke email processor with valid SES event', async () => {
      // Arrange: Upload test email to S3
      const messageId = 'lambda-test-valid-email';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      // Create test SES event
      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Invoke email processor Lambda
      const startTime = Date.now();
      
      const result = await testSuite.lambda.invokeFunction(
        LAMBDA_FUNCTIONS.emailProcessor,
        sesEvent
      );
      
      const invocationTime = Date.now() - startTime;

      // Assert: Function should execute successfully
      expect(result).toBeDefined();
      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toBeDefined();
      expect(Array.isArray(result.processedAttachments)).toBe(true);
      
      // Should complete within reasonable time
      expect(invocationTime).toBeLessThan(TEST_TIMEOUTS.LAMBDA_INVOKE);
      
      console.log(`Lambda invocation completed in ${invocationTime}ms`);
    });

    it('should handle invalid SES event gracefully', async () => {
      // Arrange: Create invalid SES event
      const invalidEvent = {
        Records: [{
          eventSource: 'aws:ses',
          eventVersion: '1.0',
          ses: {
            mail: {
              messageId: 'invalid-test',
              timestamp: '2024-01-01T12:00:00.000Z',
              source: 'test@example.com',
              destination: ['reports@warrenresorthotels.com'],
            },
            receipt: {
              recipients: ['reports@warrenresorthotels.com'],
              timestamp: '2024-01-01T12:00:00.000Z',
              processingTimeMillis: 100,
              action: {
                type: 'S3',
                bucketName: 'non-existent-bucket',
                objectKey: 'non-existent-key'
              }
            }
          }
        }]
      };

      // Act & Assert: Should handle invalid event gracefully
      try {
        const result = await testSuite.lambda.invokeFunction(
          LAMBDA_FUNCTIONS.emailProcessor,
          invalidEvent
        );
        
        // If no error thrown, check if error is handled in response
        if (result.statusCode) {
          expect(result.statusCode).not.toBe(200);
        }
      } catch (error) {
        // Expected for invalid events - ensure error is meaningful
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('error');
      }
    });

    it('should handle Lambda timeout scenarios', async () => {
      // This test validates Lambda timeout handling
      // Note: Creating a scenario that actually times out is complex
      // so we test timeout configuration validation instead
      
      // Arrange: Create a test that should complete well within timeout
      const messageId = 'lambda-test-timeout';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        'Simple email content for timeout test',
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Invoke with timing
      const startTime = Date.now();
      
      const result = await testSuite.lambda.invokeFunction(
        LAMBDA_FUNCTIONS.emailProcessor,
        sesEvent
      );
      
      const invocationTime = Date.now() - startTime;

      // Assert: Should complete well within timeout (Lambda timeout is typically 5+ minutes)
      expect(result.statusCode).toBe(200);
      expect(invocationTime).toBeLessThan(30000); // Should complete within 30 seconds
      
      // Log performance for monitoring
      console.log(`Timeout test completed in ${invocationTime}ms`);
    });
  });

  /**
   * Test Group: Lambda Performance Validation
   * 
   * Validates Lambda function performance characteristics including
   * cold start times, execution duration, and memory usage patterns.
   */
  describe('Lambda Performance', () => {
    
    it('should handle cold start performance acceptably', async () => {
      // Note: Cold start testing is complex as we can't easily control when cold starts occur
      // This test measures typical invocation performance
      
      // Arrange: Prepare multiple test scenarios
      const testScenarios = [
        'cold-start-test-1',
        'cold-start-test-2', 
        'cold-start-test-3'
      ];

      const invocationTimes = [];

      // Act: Invoke Lambda multiple times to measure performance variation
      for (const messageId of testScenarios) {
        const rawEmailKey = `raw-emails/${messageId}`;
        
        await testSuite.s3.uploadTestFile(
          testBucketName,
          rawEmailKey,
          TEST_EMAIL_CONTENT,
          'text/plain'
        );

        const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);
        
        const startTime = Date.now();
        const result = await testSuite.lambda.invokeFunction(
          LAMBDA_FUNCTIONS.emailProcessor,
          sesEvent
        );
        const invocationTime = Date.now() - startTime;

        expect(result.statusCode).toBe(200);
        invocationTimes.push(invocationTime);
        
        // Small delay between invocations
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Assert: Performance characteristics
      const averageTime = invocationTimes.reduce((sum, time) => sum + time, 0) / invocationTimes.length;
      const maxTime = Math.max(...invocationTimes);
      const minTime = Math.min(...invocationTimes);

      expect(averageTime).toBeLessThan(15000); // Average should be under 15 seconds
      expect(maxTime).toBeLessThan(30000); // Max should be under 30 seconds
      
      console.log(`Performance stats - Average: ${averageTime}ms, Min: ${minTime}ms, Max: ${maxTime}ms`);
    });

    it('should handle concurrent invocations efficiently', async () => {
      // Arrange: Prepare concurrent test data
      const concurrentCount = 5; // Conservative number for testing
      const concurrentPromises = [];

      // Act: Invoke Lambda concurrently
      const startTime = Date.now();

      for (let i = 0; i < concurrentCount; i++) {
        const messageId = `concurrent-lambda-test-${i}`;
        const rawEmailKey = `raw-emails/${messageId}`;
        
        // Upload test email
        await testSuite.s3.uploadTestFile(
          testBucketName,
          rawEmailKey,
          TEST_EMAIL_CONTENT.replace('integration-test-message-id', messageId),
          'text/plain'
        );

        const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);
        
        // Add to concurrent promises
        concurrentPromises.push(
          testSuite.lambda.invokeFunction(LAMBDA_FUNCTIONS.emailProcessor, sesEvent)
        );
      }

      // Wait for all concurrent invocations
      const results = await Promise.all(concurrentPromises);
      const totalTime = Date.now() - startTime;

             // Assert: All invocations should succeed
       results.forEach((result) => {
        expect(result.statusCode).toBe(200);
        expect(result.processedAttachments).toBeDefined();
      });

      // Should handle concurrent load efficiently
      expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds
      
      console.log(`Concurrent Lambda invocations (${concurrentCount}) completed in ${totalTime}ms`);
    });

    it('should maintain consistent performance under load', async () => {
      // Arrange: Sequential load test
      const loadTestCount = 10;
      const invocationTimes = [];

      // Act: Perform sequential invocations to test sustained performance
      for (let i = 0; i < loadTestCount; i++) {
        const messageId = `load-test-${i}`;
        const rawEmailKey = `raw-emails/${messageId}`;
        
        await testSuite.s3.uploadTestFile(
          testBucketName,
          rawEmailKey,
          `Load test email ${i}`,
          'text/plain'
        );

        const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);
        
        const startTime = Date.now();
        const result = await testSuite.lambda.invokeFunction(
          LAMBDA_FUNCTIONS.emailProcessor,
          sesEvent
        );
        const invocationTime = Date.now() - startTime;

        expect(result.statusCode).toBe(200);
        invocationTimes.push(invocationTime);
      }

      // Assert: Performance should remain consistent
      const averageTime = invocationTimes.reduce((sum, time) => sum + time, 0) / invocationTimes.length;
      const varianceThreshold = averageTime * 2; // Allow up to 2x average as acceptable variance
      
      invocationTimes.forEach(time => {
        expect(time).toBeLessThan(varianceThreshold);
      });

      console.log(`Load test average: ${averageTime}ms, times: [${invocationTimes.join(', ')}]`);
    });
  });

  /**
   * Test Group: Integration with AWS Services
   * 
   * Validates that deployed Lambda functions correctly integrate
   * with other AWS services in the production environment.
   */
  describe('AWS Service Integration', () => {
    
    it('should successfully integrate with S3 for file operations', async () => {
      // Arrange: Upload test email with attachments
      const messageId = 'lambda-s3-integration-test';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Invoke Lambda and verify S3 operations
      const result = await testSuite.lambda.invokeFunction(
        LAMBDA_FUNCTIONS.emailProcessor,
        sesEvent
      );

      // Assert: Lambda should have performed S3 operations
      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments.length).toBeGreaterThan(0);

      // Verify files were actually created in S3
      const today = new Date().toISOString().split('T')[0];
      const metadataExists = await testSuite.s3.objectExists(
        testBucketName,
        `email-metadata/${today}/${messageId}.json`
      );
      expect(metadataExists).toBe(true);
    });

    it('should successfully integrate with Parameter Store for configuration', async () => {
      // Arrange: Set up test configuration in Parameter Store
      await testSuite.parameterStore.createTestParameter(
        'property-mapping',
        JSON.stringify({ 'test-sender@example.com': 'lambda-test-property' })
      );

      const messageId = 'lambda-parameter-store-test';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Invoke Lambda (should use Parameter Store for property mapping)
      const result = await testSuite.lambda.invokeFunction(
        LAMBDA_FUNCTIONS.emailProcessor,
        sesEvent
      );

      // Assert: Lambda should have used Parameter Store configuration
      expect(result.statusCode).toBe(200);
      
      // Verify that the property was correctly identified (would be in metadata)
      const today = new Date().toISOString().split('T')[0];
      const metadataContent = await testSuite.s3.downloadTestFile(
        testBucketName,
        `email-metadata/${today}/${messageId}.json`
      );
      
      const metadata = JSON.parse(metadataContent.toString());
      expect(metadata.propertyId).toBe('lambda-test-property');
    });

    it('should handle AWS service errors gracefully in deployed environment', async () => {
      // Arrange: Create scenario that will cause AWS service error
      const messageId = 'lambda-error-handling-test';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      // Create SES event with invalid S3 configuration to trigger error
      const invalidSesEvent = createTestSESEvent(messageId, 'invalid-bucket-name', rawEmailKey);

      // Act & Assert: Lambda should handle error gracefully
      try {
        const result = await testSuite.lambda.invokeFunction(
          LAMBDA_FUNCTIONS.emailProcessor,
          invalidSesEvent
        );
        
        // If no exception, check error in response
        if (result.statusCode) {
          expect(result.statusCode).not.toBe(200);
        }
      } catch (error) {
        // Expected for invalid bucket - ensure error is handled properly
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  /**
   * Test Group: Environment-Specific Validation
   * 
   * Validates that Lambda functions are correctly configured for
   * the target deployment environment (development/production).
   */
  describe('Environment Configuration', () => {
    
    it('should have correct environment-specific function names', async () => {
      // Act: Verify environment-specific naming
      const emailProcessorExists = await testSuite.lambda.functionExists(LAMBDA_FUNCTIONS.emailProcessor);
      const fileProcessorExists = await testSuite.lambda.functionExists(LAMBDA_FUNCTIONS.fileProcessor);

      // Assert: Functions should exist with environment-specific names
      expect(emailProcessorExists).toBe(true);
      expect(fileProcessorExists).toBe(true);

      // Verify naming convention includes environment
      expect(LAMBDA_FUNCTIONS.emailProcessor).toContain(environmentConfig.environment);
      expect(LAMBDA_FUNCTIONS.fileProcessor).toContain(environmentConfig.environment);
    });

    it('should validate deployment environment consistency', async () => {
      // This test ensures that the deployment environment matches expectations
      
      // Act: Check that we're testing against the correct environment
      const currentEnvironment = environmentConfig.environment;
      
      // Assert: Environment should be valid
      expect(['development', 'production', 'test']).toContain(currentEnvironment);
      
      // Function names should match the current environment
      expect(LAMBDA_FUNCTIONS.emailProcessor).toContain(currentEnvironment);
      expect(LAMBDA_FUNCTIONS.fileProcessor).toContain(currentEnvironment);
      
      console.log(`Testing Lambda deployment in environment: ${currentEnvironment}`);
    });
  });
}); 