/**
 * @fileoverview Email Processing Workflow Integration Tests
 * 
 * These integration tests validate the complete email processing pipeline
 * from SES event reception through email parsing, attachment extraction,
 * and S3 storage operations. Tests use real AWS services where possible
 * to ensure production-like behavior.
 * 
 * Test Coverage:
 * - End-to-end email processing workflow
 * - S3 bucket operations and file structure validation
 * - Parameter Store integration for configuration
 * - Error handling and retry mechanisms
 * - Performance and timeout validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EmailProcessor } from '../../src/lambda/email-processor';
import { IntegrationTestSuite } from '../utils/aws-test-helpers';
import { 
  TEST_EMAIL_CONTENT, 
  TEST_EMAIL_NO_ATTACHMENTS, 
  createTestSESEvent, 
  EXPECTED_FILE_STRUCTURE,
  TEST_TIMEOUTS,
  TEST_PROPERTY_MAPPING
} from '../fixtures/test-data';

/**
 * Integration Test Suite: Email Processing Workflow
 * 
 * This comprehensive test suite validates the entire email processing pipeline
 * using real AWS services to ensure production-level functionality. The tests
 * create temporary AWS resources, process realistic email data, and validate
 * that files are correctly stored with proper organization and metadata.
 * 
 * Test Environment:
 * - Uses temporary S3 buckets for isolation
 * - Creates test parameters in isolated Parameter Store namespace
 * - Validates complete workflow including error scenarios
 * - Ensures proper cleanup of all resources
 * 
 * Prerequisites:
 * - AWS credentials configured for test environment
 * - Sufficient permissions for S3, Parameter Store operations
 * - Network connectivity to AWS services
 */
describe('Email Processing Workflow Integration', () => {
  let testSuite: IntegrationTestSuite;
  let testBucketName: string;
  
  /**
   * Global test setup
   * Creates AWS test infrastructure and configures test environment
   */
  beforeAll(async () => {
    testSuite = new IntegrationTestSuite();
    
    // Create test S3 bucket
    testBucketName = await testSuite.s3.createTestBucket('email-processing');
    
    // Set up test configuration in Parameter Store
    await testSuite.setup();
    
    // Configure property mapping for test scenarios
    await testSuite.parameterStore.createTestParameter(
      'property-mapping',
      JSON.stringify(TEST_PROPERTY_MAPPING)
    );
  }, TEST_TIMEOUTS.S3_OPERATION);

  /**
   * Global test cleanup
   * Removes all created AWS resources to prevent cost accumulation
   */
  afterAll(async () => {
    await testSuite.cleanup();
  }, TEST_TIMEOUTS.S3_OPERATION);

  /**
   * Test Group: Complete Email Processing Workflow
   * 
   * Validates the end-to-end email processing pipeline including:
   * - Email retrieval from S3
   * - Email parsing and attachment extraction
   * - Property identification via Parameter Store
   * - File organization and storage in S3
   * - Metadata generation and storage
   */
  describe('Complete Email Processing Pipeline', () => {
    
    it('should process email with attachments end-to-end', async () => {
      // Arrange: Upload test email to S3
      const messageId = 'integration-test-with-attachments';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      // Create SES event for the uploaded email
      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Process the email using EmailProcessor
      const emailProcessor = new EmailProcessor();
      
      // Override environment variable for test bucket
      process.env.INCOMING_FILES_BUCKET = testBucketName;
      
      const result = await emailProcessor.processEmail(sesEvent);

      // Assert: Verify processing results
      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toHaveLength(2); // PDF and CSV attachments
      
      // Verify attachments were stored correctly
      const today = new Date().toISOString().split('T')[0];
      const propertyId = 'test-property-1'; // From TEST_PROPERTY_MAPPING
      
      // Check PDF attachment
      const pdfExists = await testSuite.s3.objectExists(
        testBucketName,
        EXPECTED_FILE_STRUCTURE.dailyFiles(propertyId, today, 'daily-report.pdf')
      );
      expect(pdfExists).toBe(true);
      
      // Check CSV attachment
      const csvExists = await testSuite.s3.objectExists(
        testBucketName,
        EXPECTED_FILE_STRUCTURE.dailyFiles(propertyId, today, 'data.csv')
      );
      expect(csvExists).toBe(true);
      
      // Verify email metadata was stored
      const metadataExists = await testSuite.s3.objectExists(
        testBucketName,
        EXPECTED_FILE_STRUCTURE.emailMetadata(today, messageId)
      );
      expect(metadataExists).toBe(true);
      
      // Validate metadata content
      const metadataContent = await testSuite.s3.downloadTestFile(
        testBucketName,
        EXPECTED_FILE_STRUCTURE.emailMetadata(today, messageId)
      );
      
      const metadata = JSON.parse(metadataContent.toString());
      expect(metadata.messageId).toBe(messageId);
      expect(metadata.sender).toBe('test-sender@example.com');
      expect(metadata.subject).toBe('Daily Report - Integration Test');
      expect(metadata.attachmentCount).toBe(2);
      expect(metadata.propertyId).toBe(propertyId);
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);

    it('should handle email without attachments correctly', async () => {
      // Arrange: Upload email without attachments
      const messageId = 'integration-test-no-attachments';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_NO_ATTACHMENTS,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Process the email
      const emailProcessor = new EmailProcessor();
      process.env.INCOMING_FILES_BUCKET = testBucketName;
      
      const result = await emailProcessor.processEmail(sesEvent);

      // Assert: Verify processing results
      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toHaveLength(0);
      
      // Verify only metadata was stored (no attachment files)
      const today = new Date().toISOString().split('T')[0];
      const metadataExists = await testSuite.s3.objectExists(
        testBucketName,
        EXPECTED_FILE_STRUCTURE.emailMetadata(today, messageId)
      );
      expect(metadataExists).toBe(true);
      
      // Verify no daily files were created
      const dailyFiles = await testSuite.s3.listObjects(testBucketName, 'daily-files/');
      const messageFiles = dailyFiles.filter(key => key.includes(messageId));
      expect(messageFiles).toHaveLength(0);
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);

    it('should handle unknown sender gracefully', async () => {
      // Arrange: Create email from unknown sender
      const unknownSenderEmail = TEST_EMAIL_CONTENT.replace(
        'test-sender@example.com',
        'unknown-sender@example.com'
      );
      
      const messageId = 'integration-test-unknown-sender';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        unknownSenderEmail,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Process the email
      const emailProcessor = new EmailProcessor();
      process.env.INCOMING_FILES_BUCKET = testBucketName;
      
      const result = await emailProcessor.processEmail(sesEvent);

      // Assert: Should use fallback property ID
      expect(result.statusCode).toBe(200);
      expect(result.processedAttachments).toHaveLength(2);
      
      // Verify files stored under unknown-property folder
      const today = new Date().toISOString().split('T')[0];
      const unknownPropertyFiles = await testSuite.s3.listObjects(
        testBucketName, 
        `daily-files/unknown-property/${today}/`
      );
      expect(unknownPropertyFiles.length).toBeGreaterThan(0);
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);

    it('should handle S3 storage errors gracefully', async () => {
      // Arrange: Use invalid bucket name to trigger S3 error
      const messageId = 'integration-test-s3-error';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act: Process with invalid bucket configuration
      const emailProcessor = new EmailProcessor();
      process.env.INCOMING_FILES_BUCKET = 'non-existent-bucket-name-12345';
      
      // Assert: Should throw appropriate error
      await expect(emailProcessor.processEmail(sesEvent))
        .rejects.toThrow(/bucket|storage|access/i);
        
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);
  });

  /**
   * Test Group: Performance and Scale Validation
   * 
   * Validates that the email processing pipeline can handle
   * realistic workloads and completes within acceptable timeframes.
   */
  describe('Performance and Scale', () => {
    
    it('should process large email within timeout limits', async () => {
      // Arrange: Create email with multiple large attachments
      const largeContent = 'x'.repeat(100000); // 100KB of content
      const largeEmailContent = TEST_EMAIL_CONTENT.replace(
        'This is an integration test email with attachments.',
        `This is a large email test.\n\n${largeContent}`
      );
      
      const messageId = 'integration-test-large-email';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        largeEmailContent,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);

      // Act & Assert: Should complete within reasonable time
      const startTime = Date.now();
      
      const emailProcessor = new EmailProcessor();
      process.env.INCOMING_FILES_BUCKET = testBucketName;
      
      const result = await emailProcessor.processEmail(sesEvent);
      
      const processingTime = Date.now() - startTime;
      
      expect(result.statusCode).toBe(200);
      expect(processingTime).toBeLessThan(TEST_TIMEOUTS.EMAIL_PROCESSING);
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);

    it('should handle concurrent processing simulation', async () => {
      // Arrange: Create multiple test emails
      const emailPromises = [];
      const messageIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
      
      for (const messageId of messageIds) {
        const rawEmailKey = `raw-emails/${messageId}`;
        await testSuite.s3.uploadTestFile(
          testBucketName,
          rawEmailKey,
          TEST_EMAIL_CONTENT.replace('integration-test-message-id', messageId),
          'text/plain'
        );
        
        const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);
        
        // Create processing promise
        const emailProcessor = new EmailProcessor();
        process.env.INCOMING_FILES_BUCKET = testBucketName;
        
        emailPromises.push(emailProcessor.processEmail(sesEvent));
      }

      // Act: Process all emails concurrently
      const results = await Promise.all(emailPromises);

      // Assert: All should succeed
      results.forEach(result => {
        expect(result.statusCode).toBe(200);
        expect(result.processedAttachments).toHaveLength(2);
      });
      
      // Verify all files were stored correctly
      const today = new Date().toISOString().split('T')[0];
      const dailyFiles = await testSuite.s3.listObjects(
        testBucketName, 
        `daily-files/test-property-1/${today}/`
      );
      
      // Should have files from all 3 emails (2 attachments each = 6 files)
      expect(dailyFiles.length).toBeGreaterThanOrEqual(6);
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING * 2); // Extended timeout for concurrent processing
  });

  /**
   * Test Group: File Organization and Metadata Validation
   * 
   * Validates that processed files are organized correctly in S3
   * and that metadata contains accurate information.
   */
  describe('File Organization and Metadata', () => {
    
    it('should organize files in correct S3 structure', async () => {
      // Arrange & Act: Process a test email
      const messageId = 'integration-test-file-structure';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);
      const emailProcessor = new EmailProcessor();
      process.env.INCOMING_FILES_BUCKET = testBucketName;
      
      await emailProcessor.processEmail(sesEvent);

      // Assert: Verify file organization
      const today = new Date().toISOString().split('T')[0];
      const allObjects = await testSuite.s3.listObjects(testBucketName);
      
      // Check for expected folder structure
      const rawEmailFiles = allObjects.filter(key => key.startsWith('raw-emails/'));
      const dailyFiles = allObjects.filter(key => key.startsWith('daily-files/'));
      const metadataFiles = allObjects.filter(key => key.startsWith('email-metadata/'));
      
      expect(rawEmailFiles.length).toBeGreaterThan(0);
      expect(dailyFiles.length).toBeGreaterThan(0);
      expect(metadataFiles.length).toBeGreaterThan(0);
      
      // Verify specific file paths
      expect(allObjects).toContain(`raw-emails/${messageId}`);
      expect(allObjects).toContain(`email-metadata/${today}/${messageId}.json`);
      
      // Verify daily files follow correct naming pattern
      const dailyFilesForProperty = dailyFiles.filter(key => 
        key.includes('test-property-1') && key.includes(today)
      );
      expect(dailyFilesForProperty.length).toBe(2); // PDF and CSV
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);

    it('should generate accurate metadata', async () => {
      // Arrange & Act: Process email and retrieve metadata
      const messageId = 'integration-test-metadata-validation';
      const rawEmailKey = `raw-emails/${messageId}`;
      
      await testSuite.s3.uploadTestFile(
        testBucketName,
        rawEmailKey,
        TEST_EMAIL_CONTENT,
        'text/plain'
      );

      const sesEvent = createTestSESEvent(messageId, testBucketName, rawEmailKey);
      const emailProcessor = new EmailProcessor();
      process.env.INCOMING_FILES_BUCKET = testBucketName;
      
      await emailProcessor.processEmail(sesEvent);

      // Retrieve and validate metadata
      const today = new Date().toISOString().split('T')[0];
      const metadataContent = await testSuite.s3.downloadTestFile(
        testBucketName,
        EXPECTED_FILE_STRUCTURE.emailMetadata(today, messageId)
      );
      
      const metadata = JSON.parse(metadataContent.toString());

      // Assert: Validate metadata structure and content
      expect(metadata).toHaveProperty('messageId', messageId);
      expect(metadata).toHaveProperty('sender', 'test-sender@example.com');
      expect(metadata).toHaveProperty('subject', 'Daily Report - Integration Test');
      expect(metadata).toHaveProperty('propertyId', 'test-property-1');
      expect(metadata).toHaveProperty('attachmentCount', 2);
      expect(metadata).toHaveProperty('processedAt');
      expect(metadata).toHaveProperty('attachments');
      
             // Validate attachment metadata
       expect(metadata.attachments).toHaveLength(2);
       metadata.attachments.forEach((attachment: { filename: string; storedPath: string; contentType: string }) => {
        expect(attachment).toHaveProperty('filename');
        expect(attachment).toHaveProperty('storedPath');
        expect(attachment).toHaveProperty('contentType');
        expect(attachment.storedPath).toContain('test-property-1');
        expect(attachment.storedPath).toContain(today);
      });
      
    }, TEST_TIMEOUTS.EMAIL_PROCESSING);
  });
}); 