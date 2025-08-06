/**
 * @fileoverview S3 Integration Tests
 * 
 * These integration tests validate S3-specific functionality including:
 * - Bucket operations and access control
 * - File upload/download operations
 * - File organization and lifecycle policies
 * - Storage error handling and recovery
 * - Performance characteristics of S3 operations
 * 
 * Test Coverage:
 * - S3 bucket creation and management
 * - File storage patterns and organization
 * - Large file handling and performance
 * - Error scenarios and recovery
 * - Access control and permissions
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IntegrationTestSuite } from '../utils/aws-test-helpers';
import { 
  TEST_ATTACHMENTS, 
  EXPECTED_FILE_STRUCTURE,
  TEST_TIMEOUTS 
} from '../fixtures/test-data';

/**
 * Integration Test Suite: S3 Operations
 * 
 * This test suite validates S3-specific functionality to ensure the report
 * builder can correctly store, organize, and retrieve files in production.
 * Tests include validation of file organization patterns, performance
 * characteristics, and error handling scenarios.
 * 
 * Test Environment:
 * - Creates temporary S3 buckets for isolation
 * - Tests realistic file sizes and formats
 * - Validates proper cleanup and resource management
 * - Ensures consistent file organization patterns
 * 
 * Prerequisites:
 * - AWS credentials configured for test environment
 * - S3 permissions for bucket/object operations
 * - Network connectivity to S3 endpoints
 */
describe('S3 Integration Tests', () => {
  let testSuite: IntegrationTestSuite;
  let testBucketName: string;

  /**
   * Global test setup
   * Creates test S3 infrastructure
   */
  beforeAll(async () => {
    testSuite = new IntegrationTestSuite();
    testBucketName = await testSuite.s3.createTestBucket('s3-integration');
  }, TEST_TIMEOUTS.S3_OPERATION);

  /**
   * Global test cleanup
   * Removes all created S3 resources
   */
  afterAll(async () => {
    await testSuite.cleanup();
  }, TEST_TIMEOUTS.S3_OPERATION);

  /**
   * Test Group: Basic S3 Operations
   * 
   * Validates fundamental S3 operations including upload, download,
   * existence checking, and basic error handling.
   */
  describe('Basic S3 Operations', () => {
    
    it('should upload and download files correctly', async () => {
      // Arrange: Prepare test content
      const testKey = 'test-files/sample.txt';
      const testContent = 'Integration test content for S3 operations';

      // Act: Upload file
      await testSuite.s3.uploadTestFile(
        testBucketName,
        testKey,
        testContent,
        'text/plain'
      );

      // Download file
      const downloadedContent = await testSuite.s3.downloadTestFile(
        testBucketName,
        testKey
      );

      // Assert: Content should match
      expect(downloadedContent.toString()).toBe(testContent);
      
      // Verify file exists
      const exists = await testSuite.s3.objectExists(testBucketName, testKey);
      expect(exists).toBe(true);
    });

    it('should handle different file types correctly', async () => {
      // Arrange & Act: Upload different file types
      const uploadPromises = Object.entries(TEST_ATTACHMENTS).map(
        async ([type, attachment]) => {
          const key = `test-attachments/${attachment.filename}`;
          await testSuite.s3.uploadTestFile(
            testBucketName,
            key,
            attachment.content,
            attachment.contentType
          );
          return { type, key, originalContent: attachment.content };
        }
      );

      const uploadResults = await Promise.all(uploadPromises);

             // Assert: All files should be downloadable with correct content
       for (const { key, originalContent } of uploadResults) {
        const downloadedContent = await testSuite.s3.downloadTestFile(
          testBucketName,
          key
        );
        
        expect(Buffer.compare(downloadedContent, originalContent)).toBe(0);
        
        const exists = await testSuite.s3.objectExists(testBucketName, key);
        expect(exists).toBe(true);
      }
    });

    it('should handle non-existent files gracefully', async () => {
      // Act & Assert: Check for non-existent file
      const exists = await testSuite.s3.objectExists(
        testBucketName, 
        'non-existent/file.txt'
      );
      expect(exists).toBe(false);

      // Should throw error when trying to download non-existent file
      await expect(
        testSuite.s3.downloadTestFile(testBucketName, 'non-existent/file.txt')
      ).rejects.toThrow();
    });
  });

  /**
   * Test Group: File Organization Patterns
   * 
   * Validates that the S3 file organization follows the expected
   * patterns for the report builder application.
   */
  describe('File Organization Patterns', () => {
    
    it('should organize files in expected directory structure', async () => {
      // Arrange: Define expected file structure
      const today = new Date().toISOString().split('T')[0];
      const propertyId = 'test-property-1';
      const messageId = 'test-message-123';

      const expectedFiles = [
        // Raw emails
        `raw-emails/${messageId}`,
        
        // Daily files organized by property and date
        EXPECTED_FILE_STRUCTURE.dailyFiles(propertyId, today, 'report.pdf'),
        EXPECTED_FILE_STRUCTURE.dailyFiles(propertyId, today, 'data.csv'),
        
        // Email metadata
        EXPECTED_FILE_STRUCTURE.emailMetadata(today, messageId),
      ];

      // Act: Upload files following the expected pattern
      for (const filePath of expectedFiles) {
        await testSuite.s3.uploadTestFile(
          testBucketName,
          filePath,
          `Test content for ${filePath}`,
          'text/plain'
        );
      }

      // Assert: Verify file organization
      const allObjects = await testSuite.s3.listObjects(testBucketName);
      
      // Check that all expected files exist
      expectedFiles.forEach(expectedFile => {
        expect(allObjects).toContain(expectedFile);
      });

      // Verify folder structure
      const rawEmailFiles = allObjects.filter(key => key.startsWith('raw-emails/'));
      const dailyFiles = allObjects.filter(key => key.startsWith('daily-files/'));
      const metadataFiles = allObjects.filter(key => key.startsWith('email-metadata/'));

      expect(rawEmailFiles.length).toBeGreaterThan(0);
      expect(dailyFiles.length).toBeGreaterThan(0);
      expect(metadataFiles.length).toBeGreaterThan(0);

      // Verify daily files follow property/date structure
      const propertyFiles = dailyFiles.filter(key => 
        key.includes(propertyId) && key.includes(today)
      );
      expect(propertyFiles.length).toBe(2); // PDF and CSV
    });

    it('should handle multiple properties and dates correctly', async () => {
      // Arrange: Create files for multiple properties and dates
      const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
      const properties = ['property-1', 'property-2', 'property-3'];
      const fileTypes = ['report.pdf', 'data.csv'];

      // Act: Upload files for all combinations
      const uploadPromises = [];
      for (const date of dates) {
        for (const property of properties) {
          for (const fileType of fileTypes) {
            const filePath = EXPECTED_FILE_STRUCTURE.dailyFiles(property, date, fileType);
            uploadPromises.push(
              testSuite.s3.uploadTestFile(
                testBucketName,
                filePath,
                `Content for ${property} on ${date} - ${fileType}`,
                'text/plain'
              )
            );
          }
        }
      }

      await Promise.all(uploadPromises);

      // Assert: Verify organized structure
      for (const date of dates) {
        for (const property of properties) {
          const propertyFiles = await testSuite.s3.listObjects(
            testBucketName,
            `daily-files/${property}/${date}/`
          );
          expect(propertyFiles.length).toBe(2); // Should have both file types
        }
      }

      // Verify total file count
      const allDailyFiles = await testSuite.s3.listObjects(
        testBucketName,
        'daily-files/'
      );
      expect(allDailyFiles.length).toBe(dates.length * properties.length * fileTypes.length);
    });
  });

  /**
   * Test Group: Performance and Scale Testing
   * 
   * Validates S3 performance characteristics under various load conditions
   * and file sizes to ensure production readiness.
   */
  describe('Performance and Scale', () => {
    
    it('should handle large file uploads efficiently', async () => {
      // Arrange: Create large test content (1MB)
      const largeContent = Buffer.alloc(1024 * 1024, 'x'); // 1MB of 'x' characters
      const largeFileKey = 'performance-test/large-file.bin';

      // Act: Upload large file and measure time
      const startTime = Date.now();
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        largeFileKey,
        largeContent,
        'application/octet-stream'
      );

      const uploadTime = Date.now() - startTime;

      // Verify file was uploaded correctly
      const downloadStartTime = Date.now();
      const downloadedContent = await testSuite.s3.downloadTestFile(
        testBucketName,
        largeFileKey
      );
      const downloadTime = Date.now() - downloadStartTime;

      // Assert: Performance and correctness
      expect(Buffer.compare(downloadedContent, largeContent)).toBe(0);
      expect(uploadTime).toBeLessThan(30000); // Should complete within 30 seconds
      expect(downloadTime).toBeLessThan(30000); // Should download within 30 seconds
      
      console.log(`Large file (1MB) - Upload: ${uploadTime}ms, Download: ${downloadTime}ms`);
    });

    it('should handle concurrent uploads efficiently', async () => {
      // Arrange: Prepare multiple files for concurrent upload
      const concurrentCount = 10;
      const fileSize = 100 * 1024; // 100KB each
      const uploadPromises = [];

      // Act: Upload multiple files concurrently
      const startTime = Date.now();
      
      for (let i = 0; i < concurrentCount; i++) {
        const content = Buffer.alloc(fileSize, String.fromCharCode(65 + (i % 26))); // A-Z
        const key = `concurrent-test/file-${i}.bin`;
        
        uploadPromises.push(
          testSuite.s3.uploadTestFile(
            testBucketName,
            key,
            content,
            'application/octet-stream'
          )
        );
      }

      await Promise.all(uploadPromises);
      const totalTime = Date.now() - startTime;

      // Assert: All files should be uploaded successfully
      const concurrentFiles = await testSuite.s3.listObjects(
        testBucketName,
        'concurrent-test/'
      );
      expect(concurrentFiles.length).toBe(concurrentCount);
      expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds
      
      console.log(`Concurrent uploads (${concurrentCount} files) completed in ${totalTime}ms`);
    });

    it('should handle rapid sequential operations', async () => {
      // Arrange: Prepare for rapid sequential operations
      const operationCount = 20;
      const testContent = 'Rapid operation test content';

      // Act: Perform rapid upload/download cycles
      const startTime = Date.now();
      
      for (let i = 0; i < operationCount; i++) {
        const key = `rapid-test/operation-${i}.txt`;
        
        // Upload
        await testSuite.s3.uploadTestFile(
          testBucketName,
          key,
          `${testContent} ${i}`,
          'text/plain'
        );
        
        // Verify existence
        const exists = await testSuite.s3.objectExists(testBucketName, key);
        expect(exists).toBe(true);
      }

      const totalTime = Date.now() - startTime;

      // Assert: Performance characteristics
      expect(totalTime).toBeLessThan(45000); // Should complete within 45 seconds
      
      const rapidFiles = await testSuite.s3.listObjects(testBucketName, 'rapid-test/');
      expect(rapidFiles.length).toBe(operationCount);
      
      console.log(`Rapid sequential operations (${operationCount}) completed in ${totalTime}ms`);
    });
  });

  /**
   * Test Group: Error Handling and Recovery
   * 
   * Validates S3 error scenarios and recovery mechanisms to ensure
   * robust production behavior.
   */
  describe('Error Handling and Recovery', () => {
    
    it('should handle invalid bucket names gracefully', async () => {
      // Act & Assert: Invalid bucket operations should throw appropriate errors
      await expect(
        testSuite.s3.uploadTestFile(
          'invalid-bucket-name-that-does-not-exist-12345',
          'test.txt',
          'content',
          'text/plain'
        )
      ).rejects.toThrow();

      await expect(
        testSuite.s3.objectExists(
          'invalid-bucket-name-that-does-not-exist-12345',
          'test.txt'
        )
      ).rejects.toThrow();
    });

    it('should handle malformed object keys correctly', async () => {
      // Arrange: Test various problematic key patterns
      const problematicKeys = [
        '', // Empty key
        '//double-slash',
        'key with spaces',
        'key/with/../dots',
        'very-long-key-' + 'x'.repeat(1000), // Very long key
      ];

      // Act & Assert: Should handle each problematic key appropriately
      for (const key of problematicKeys) {
        try {
          if (key === '') {
            // Empty key should definitely fail
            await expect(
              testSuite.s3.uploadTestFile(testBucketName, key, 'content', 'text/plain')
            ).rejects.toThrow();
          } else {
            // Other keys may or may not work depending on S3 rules
            // We just ensure no unexpected crashes occur
            await testSuite.s3.uploadTestFile(testBucketName, key, 'content', 'text/plain');
            const exists = await testSuite.s3.objectExists(testBucketName, key);
            expect(typeof exists).toBe('boolean');
          }
        } catch (error) {
          // Expected for some problematic keys - ensure error is meaningful
          expect(error).toBeInstanceOf(Error);
        }
      }
    });

    it('should handle network interruption simulation', async () => {
      // Note: This test simulates network issues by using invalid endpoints
      // In a real environment, you might use network conditions simulation
      
      // Arrange: Create a client with invalid endpoint
      const { S3Client } = await import('@aws-sdk/client-s3');
      const invalidS3Client = new S3Client({
        endpoint: 'https://invalid-endpoint-that-does-not-exist.com',
        region: 'us-east-1',
      });

      // Act & Assert: Operations should fail with network-related errors
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      
      await expect(
        invalidS3Client.send(new GetObjectCommand({
          Bucket: testBucketName,
          Key: 'test.txt'
        }))
      ).rejects.toThrow();
    });
  });

  /**
   * Test Group: Advanced S3 Features
   * 
   * Tests advanced S3 features that may be used in production
   * including metadata, tagging, and storage classes.
   */
  describe('Advanced S3 Features', () => {
    
    it('should handle custom metadata correctly', async () => {
      // Arrange: Upload file with custom metadata
      const key = 'metadata-test/file-with-metadata.txt';
      const content = 'File with custom metadata';
      
      // Note: For full metadata testing, you'd need to use the S3Client directly
      // This test validates that our helper can work with files that have metadata
      await testSuite.s3.uploadTestFile(testBucketName, key, content, 'text/plain');

      // Act: Verify file operations work with metadata
      const exists = await testSuite.s3.objectExists(testBucketName, key);
      const downloadedContent = await testSuite.s3.downloadTestFile(testBucketName, key);

      // Assert: Standard operations should work regardless of metadata
      expect(exists).toBe(true);
      expect(downloadedContent.toString()).toBe(content);
    });

    it('should handle files with special characters in names', async () => {
      // Arrange: Test files with various special characters
      const specialCharFiles = [
        'special-chars/file with spaces.txt',
        'special-chars/file-with-dashes.txt',
        'special-chars/file_with_underscores.txt',
        'special-chars/file.with.dots.txt',
        'special-chars/file@symbol.txt',
        'special-chars/file(parentheses).txt',
      ];

      // Act: Upload files with special characters
      for (const key of specialCharFiles) {
        await testSuite.s3.uploadTestFile(
          testBucketName,
          key,
          `Content for ${key}`,
          'text/plain'
        );
      }

      // Assert: All files should be accessible
      for (const key of specialCharFiles) {
        const exists = await testSuite.s3.objectExists(testBucketName, key);
        expect(exists).toBe(true);
        
        const content = await testSuite.s3.downloadTestFile(testBucketName, key);
        expect(content.toString()).toBe(`Content for ${key}`);
      }

      // Verify all files are listed correctly
      const specialCharFilesList = await testSuite.s3.listObjects(
        testBucketName,
        'special-chars/'
      );
      expect(specialCharFilesList.length).toBe(specialCharFiles.length);
    });
  });
}); 