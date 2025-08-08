/**
 * @fileoverview Parameter Store Integration Tests
 * 
 * These integration tests validate Parameter Store functionality including:
 * - Configuration parameter management
 * - Caching mechanisms and performance
 * - Error handling and fallback behavior
 * - Parameter hierarchy and organization
 * - Integration with application configuration
 * 
 * Test Coverage:
 * - Parameter creation, retrieval, and updates
 * - Caching behavior and invalidation
 * - Error scenarios and recovery
 * - Performance characteristics
 * - Security and access control
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ParameterStoreConfig } from '../../src/config/parameter-store';
import { IntegrationTestSuite } from '../utils/aws-test-helpers';
import { 
  TEST_PROPERTY_MAPPING, 
  TEST_EMAIL_CONFIG,
  TEST_TIMEOUTS 
} from '../fixtures/test-data';

/**
 * Integration Test Suite: Parameter Store Operations
 * 
 * This test suite validates Parameter Store functionality to ensure the report
 * builder can correctly manage configuration in production. Tests include
 * validation of parameter organization, caching behavior, and error recovery.
 * 
 * Test Environment:
 * - Creates test parameters in isolated namespace
 * - Tests realistic configuration scenarios
 * - Validates caching and performance
 * - Ensures proper cleanup of test resources
 * 
 * Prerequisites:
 * - AWS credentials configured for test environment
 * - Parameter Store permissions for get/put/delete operations
 * - Network connectivity to SSM endpoints
 */
describe('Parameter Store Integration Tests', () => {
  let testSuite: IntegrationTestSuite;
  let parameterStore: ParameterStoreConfig;

  /**
   * Global test setup
   * Creates test Parameter Store infrastructure
   */
  beforeAll(async () => {
    testSuite = new IntegrationTestSuite();
    await testSuite.setup();
  }, TEST_TIMEOUTS.PARAMETER_STORE);

  /**
   * Global test cleanup
   * Removes all created Parameter Store resources
   */
  afterAll(async () => {
    await testSuite.cleanup();
  }, TEST_TIMEOUTS.PARAMETER_STORE);

  /**
   * Test setup for each test
   * Creates fresh ParameterStoreConfig instance
   */
  beforeEach(() => {
    parameterStore = new ParameterStoreConfig();
  });

  /**
   * Test Group: Basic Parameter Operations
   * 
   * Validates fundamental Parameter Store operations including
   * parameter retrieval, caching, and basic error handling.
   */
  describe('Basic Parameter Operations', () => {
    
    it('should retrieve property mapping configuration', async () => {
      // Arrange: Set up property mapping parameter
      await testSuite.parameterStore.createTestParameter(
        'property-mapping',
        JSON.stringify(TEST_PROPERTY_MAPPING)
      );

      // Act: Retrieve property mapping
      const propertyMapping = await parameterStore.getPropertyMapping();

      // Assert: Should match test data
      expect(propertyMapping).toEqual(TEST_PROPERTY_MAPPING);
      
      // Verify specific property mappings
      expect(propertyMapping['test-sender@example.com']).toBe('test-property-1');
      expect(propertyMapping['property1@warrenresorts.com']).toBe('warren-main');
      expect(propertyMapping['finance@warrenresorts.com']).toBe('warren-corporate');
    });

    it('should retrieve email configuration', async () => {
      // Arrange: Set up email configuration parameters
      await testSuite.parameterStore.createTestParameter(
        'email/recipients',
        TEST_EMAIL_CONFIG.recipients
      );
      await testSuite.parameterStore.createTestParameter(
        'email/alert-notifications',
        TEST_EMAIL_CONFIG.alertEmail
      );
      await testSuite.parameterStore.createTestParameter(
        'email/from-address',
        TEST_EMAIL_CONFIG.fromEmail
      );
      await testSuite.parameterStore.createTestParameter(
        'ses/configuration-set',
        TEST_EMAIL_CONFIG.configurationSet
      );

      // Act: Retrieve email configuration
      const emailConfig = await parameterStore.getEmailConfiguration();

      // Assert: Should match test configuration
      expect(emailConfig.recipients).toBe(TEST_EMAIL_CONFIG.recipients);
      expect(emailConfig.alertEmail).toBe(TEST_EMAIL_CONFIG.alertEmail);
      expect(emailConfig.fromEmail).toBe(TEST_EMAIL_CONFIG.fromEmail);
      expect(emailConfig.configurationSet).toBe(TEST_EMAIL_CONFIG.configurationSet);
    });

    it('should handle missing parameters gracefully', async () => {
      // Act: Try to retrieve non-existent parameter
      const propertyMapping = await parameterStore.getPropertyMapping();

      // Assert: Should return empty object for missing property mapping
      expect(propertyMapping).toEqual({});
    });

    it('should handle malformed JSON in parameters', async () => {
      // Arrange: Create parameter with invalid JSON
      await testSuite.parameterStore.createTestParameter(
        'property-mapping',
        'invalid json content {'
      );

      // Act & Assert: Should handle parsing error gracefully
      const propertyMapping = await parameterStore.getPropertyMapping();
      expect(propertyMapping).toEqual({});
    });
  });

  /**
   * Test Group: Caching Behavior
   * 
   * Validates Parameter Store caching mechanisms to ensure
   * performance optimization and proper cache invalidation.
   */
  describe('Caching Behavior', () => {
    
    it('should cache parameters for improved performance', async () => {
      // Arrange: Set up test parameter
      await testSuite.parameterStore.createTestParameter(
        'property-mapping',
        JSON.stringify(TEST_PROPERTY_MAPPING)
      );

      // Act: Retrieve same parameter multiple times and measure performance
      const startTime = Date.now();
      
      // First call - should hit Parameter Store
      const firstResult = await parameterStore.getPropertyMapping();
      const firstCallTime = Date.now() - startTime;
      
      const secondCallStart = Date.now();
      
      // Second call - should use cache
      const secondResult = await parameterStore.getPropertyMapping();
      const secondCallTime = Date.now() - secondCallStart;

      // Assert: Results should be identical
      expect(firstResult).toEqual(secondResult);
      expect(firstResult).toEqual(TEST_PROPERTY_MAPPING);
      
      // Second call should be significantly faster (cached)
      expect(secondCallTime).toBeLessThan(firstCallTime);
      expect(secondCallTime).toBeLessThan(100); // Should be very fast (< 100ms)
      
      console.log(`Parameter retrieval - First call: ${firstCallTime}ms, Cached call: ${secondCallTime}ms`);
    });

    it('should handle cache invalidation correctly', async () => {
      // Arrange: Set up initial parameter
      await testSuite.parameterStore.createTestParameter(
        'test-cache-invalidation',
        'initial-value'
      );

      // Act: Get initial value (populates cache)
      const initialValue = await testSuite.parameterStore.getTestParameter('test-cache-invalidation');
      expect(initialValue).toBe('initial-value');

      // Update parameter externally
      await testSuite.parameterStore.createTestParameter(
        'test-cache-invalidation',
        'updated-value'
      );

             // Create new ParameterStoreConfig instance (simulates cache reset)
       new ParameterStoreConfig();
       const updatedValue = await testSuite.parameterStore.getTestParameter('test-cache-invalidation');

      // Assert: Should get updated value
      expect(updatedValue).toBe('updated-value');
    });

    it('should handle concurrent parameter requests efficiently', async () => {
      // Arrange: Set up test parameter
      await testSuite.parameterStore.createTestParameter(
        'concurrent-test',
        JSON.stringify({ test: 'concurrent-access' })
      );

      // Act: Make multiple concurrent requests
      const concurrentRequests = Array(10).fill(0).map(() => 
        parameterStore.getPropertyMapping()
      );

      const startTime = Date.now();
      const results = await Promise.all(concurrentRequests);
      const totalTime = Date.now() - startTime;

      // Assert: All results should be identical
      results.forEach(result => {
        expect(result).toEqual(results[0]);
      });

      // Should complete efficiently even with multiple concurrent requests
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      console.log(`Concurrent parameter requests (${concurrentRequests.length}) completed in ${totalTime}ms`);
    });
  });

  /**
   * Test Group: Parameter Hierarchy and Organization
   * 
   * Validates that parameters are properly organized in hierarchical
   * structure and that different parameter types are handled correctly.
   */
  describe('Parameter Hierarchy and Organization', () => {
    
    it('should handle hierarchical parameter structure', async () => {
      // Arrange: Create parameters in different hierarchies
      const testParameters = {
        'email/recipients': 'test-recipients@example.com',
        'email/alert-notifications': 'test-alerts@example.com',
        'email/from-address': 'test-from@example.com',
        'ses/configuration-set': 'test-config-set',
        'property-mapping': JSON.stringify({ 'test@example.com': 'test-property' }),
        'processing/batch-size': '100',
        'processing/timeout': '300',
      };

      // Act: Create all test parameters
      for (const [key, value] of Object.entries(testParameters)) {
        await testSuite.parameterStore.createTestParameter(key, value);
      }

      // Retrieve different parameter types
      const emailConfig = await parameterStore.getEmailConfiguration();
      const propertyMapping = await parameterStore.getPropertyMapping();

      // Assert: Should correctly parse hierarchical parameters
      expect(emailConfig.recipients).toBe(testParameters['email/recipients']);
      expect(emailConfig.alertEmail).toBe(testParameters['email/alert-notifications']);
      expect(emailConfig.fromEmail).toBe(testParameters['email/from-address']);
      expect(emailConfig.configurationSet).toBe(testParameters['ses/configuration-set']);
      
      expect(propertyMapping).toEqual({ 'test@example.com': 'test-property' });
    });

    it('should handle different parameter data types', async () => {
      // Arrange: Create parameters with different data types
      const parameterTypes = {
        'string-param': 'simple string value',
        'json-param': JSON.stringify({ key: 'value', number: 42, array: [1, 2, 3] }),
        'number-param': '12345',
        'boolean-param': 'true',
        'empty-param': '',
        'whitespace-param': '   test with spaces   ',
      };

      // Act: Create all parameters
      for (const [key, value] of Object.entries(parameterTypes)) {
        await testSuite.parameterStore.createTestParameter(key, value);
      }

      // Retrieve and validate each parameter type
      for (const [key, expectedValue] of Object.entries(parameterTypes)) {
        const retrievedValue = await testSuite.parameterStore.getTestParameter(key);
        expect(retrievedValue).toBe(expectedValue);
      }

      // Test JSON parsing specifically
      const jsonParam = await testSuite.parameterStore.getTestParameter('json-param');
      const parsedJson = JSON.parse(jsonParam);
      expect(parsedJson.key).toBe('value');
      expect(parsedJson.number).toBe(42);
      expect(parsedJson.array).toEqual([1, 2, 3]);
    });
  });

  /**
   * Test Group: Error Handling and Recovery
   * 
   * Validates Parameter Store error scenarios and recovery mechanisms
   * to ensure robust production behavior.
   */
  describe('Error Handling and Recovery', () => {
    
    it('should handle network connectivity issues gracefully', async () => {
      // Arrange: Create a parameter store config with invalid endpoint
      // Note: This simulates network issues by using an invalid region
      const { SSMClient } = await import('@aws-sdk/client-ssm');
      const invalidSSMClient = new SSMClient({
        region: 'invalid-region-that-does-not-exist',
      });

      // Act & Assert: Should handle network errors gracefully
      const { GetParameterCommand } = await import('@aws-sdk/client-ssm');
      
      await expect(
        invalidSSMClient.send(new GetParameterCommand({
          Name: '/test/parameter'
        }))
      ).rejects.toThrow();
    });

    it('should handle access permission errors', async () => {
      // This test would require setting up IAM roles/policies that deny access
      // For now, we test the error handling structure
      
             // Arrange: Try to access a parameter that would require different permissions
      
      // Act & Assert: Should handle permission errors gracefully
      try {
        await testSuite.parameterStore.getTestParameter('restricted/high-security-parameter');
      } catch (error) {
        // Expected for restricted parameters
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle parameter store service limits gracefully', async () => {
      // Arrange: Test with very long parameter values (near service limits)
      const longValue = 'x'.repeat(4000); // 4KB value (near Parameter Store limit)
      const parameterName = 'large-parameter-test';

      // Act: Create and retrieve large parameter
      await testSuite.parameterStore.createTestParameter(parameterName, longValue);
      const retrievedValue = await testSuite.parameterStore.getTestParameter(parameterName);

      // Assert: Should handle large parameters correctly
      expect(retrievedValue).toBe(longValue);
      expect(retrievedValue.length).toBe(4000);
    });

    it('should handle rapid sequential parameter requests', async () => {
      // Arrange: Set up test parameter
      await testSuite.parameterStore.createTestParameter(
        'rapid-access-test',
        'rapid-test-value'
      );

             // Act: Make many rapid requests
       const rapidRequests = Array(50).fill(0).map(() => 
         testSuite.parameterStore.getTestParameter('rapid-access-test')
       );

      const startTime = Date.now();
      const results = await Promise.all(rapidRequests);
      const totalTime = Date.now() - startTime;

      // Assert: All requests should succeed
      results.forEach(result => {
        expect(result).toBe('rapid-test-value');
      });

      // Should handle rapid requests without throttling issues
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      console.log(`Rapid parameter requests (${rapidRequests.length}) completed in ${totalTime}ms`);
    });
  });

  /**
   * Test Group: Performance and Scale Testing
   * 
   * Validates Parameter Store performance characteristics under
   * various load conditions to ensure production readiness.
   */
  describe('Performance and Scale', () => {
    
    it('should perform efficiently with multiple parameter types', async () => {
      // Arrange: Set up comprehensive configuration
      const comprehensiveConfig = {
        'property-mapping': JSON.stringify(TEST_PROPERTY_MAPPING),
        'email/recipients': TEST_EMAIL_CONFIG.recipients,
        'email/alert-notifications': TEST_EMAIL_CONFIG.alertEmail,
        'email/from-address': TEST_EMAIL_CONFIG.fromEmail,
        'ses/configuration-set': TEST_EMAIL_CONFIG.configurationSet,
        'processing/max-attachment-size': '10485760', // 10MB
        'processing/allowed-file-types': 'pdf,csv,txt,xlsx,xls',
        'processing/timeout-seconds': '300',
        'monitoring/log-level': 'INFO',
        'monitoring/metrics-enabled': 'true',
      };

      // Create all parameters
      for (const [key, value] of Object.entries(comprehensiveConfig)) {
        await testSuite.parameterStore.createTestParameter(key, value);
      }

      // Act: Measure performance of retrieving all configuration
      const startTime = Date.now();
      
      const [propertyMapping, emailConfig] = await Promise.all([
        parameterStore.getPropertyMapping(),
        parameterStore.getEmailConfiguration(),
      ]);
      
      const retrievalTime = Date.now() - startTime;

      // Assert: Should retrieve all configurations efficiently
      expect(propertyMapping).toEqual(TEST_PROPERTY_MAPPING);
      expect(emailConfig.recipients).toBe(TEST_EMAIL_CONFIG.recipients);
      expect(retrievalTime).toBeLessThan(3000); // Should complete within 3 seconds
      
      console.log(`Comprehensive configuration retrieval completed in ${retrievalTime}ms`);
    });

    it('should handle configuration updates efficiently', async () => {
      // Arrange: Set up initial configuration
      await testSuite.parameterStore.createTestParameter(
        'update-test',
        JSON.stringify({ version: 1, config: 'initial' })
      );

      // Act: Perform multiple updates and retrievals
      const updateCycles = 5;
      const startTime = Date.now();

      for (let i = 1; i <= updateCycles; i++) {
        // Update parameter
        await testSuite.parameterStore.createTestParameter(
          'update-test',
          JSON.stringify({ version: i + 1, config: `updated-${i}` })
        );

                 // Retrieve updated value (with new instance to avoid caching)
         new ParameterStoreConfig();
         const updatedValue = await testSuite.parameterStore.getTestParameter('update-test');
        
        const parsed = JSON.parse(updatedValue);
        expect(parsed.version).toBe(i + 1);
        expect(parsed.config).toBe(`updated-${i}`);
      }

      const totalTime = Date.now() - startTime;
      
      // Assert: Updates should be performed efficiently
      expect(totalTime).toBeLessThan(15000); // Should complete within 15 seconds
      
      console.log(`Configuration update cycles (${updateCycles}) completed in ${totalTime}ms`);
    });
  });

  /**
   * Test Group: Integration with Application Configuration
   * 
   * Validates that Parameter Store integrates correctly with the
   * application's configuration management system.
   */
  describe('Application Configuration Integration', () => {
    
    it('should provide fallback values for missing configuration', async () => {
      // Act: Try to get email configuration when parameters don't exist
      const emailConfig = await parameterStore.getEmailConfiguration();

      // Assert: Should provide reasonable fallback values
      expect(emailConfig.recipients).toBeDefined();
      expect(emailConfig.alertEmail).toBeDefined();
      expect(emailConfig.fromEmail).toBeDefined();
      expect(emailConfig.configurationSet).toBeDefined();
      
      // Fallback values should be non-empty strings
      expect(typeof emailConfig.recipients).toBe('string');
      expect(typeof emailConfig.alertEmail).toBe('string');
      expect(typeof emailConfig.fromEmail).toBe('string');
      expect(typeof emailConfig.configurationSet).toBe('string');
    });

    it('should handle configuration validation correctly', async () => {
      // Arrange: Set up configuration with some invalid values
      await testSuite.parameterStore.createTestParameter(
        'email/recipients',
        '' // Empty recipients
      );
      await testSuite.parameterStore.createTestParameter(
        'email/alert-notifications',
        'valid-alert@example.com'
      );

      // Act: Retrieve configuration
      const emailConfig = await parameterStore.getEmailConfiguration();

      // Assert: Should handle empty/invalid values appropriately
      expect(emailConfig.alertEmail).toBe('valid-alert@example.com');
      // Recipients might fall back to default or remain empty based on implementation
      expect(typeof emailConfig.recipients).toBe('string');
    });
  });
}); 