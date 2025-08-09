/**
 * @fileoverview AWS Integration Test Utilities
 * 
 * Provides utilities for testing AWS service integrations including:
 * - S3 bucket operations and cleanup
 * - Parameter Store configuration management
 * - Lambda function deployment validation
 * - Test environment setup and teardown
 */

import { S3Client, CreateBucketCommand, DeleteBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { SSMClient, PutParameterCommand, DeleteParameterCommand, GetParameterCommand } from '@aws-sdk/client-ssm';
import { LambdaClient, InvokeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { environmentConfig } from '../../src/config/environment';

/**
 * Configuration for integration tests
 */
export interface IntegrationTestConfig {
  /** Test bucket name prefix */
  bucketPrefix: string;
  /** Test parameter path prefix */
  parameterPrefix: string;
  /** AWS region for testing */
  region: string;
  /** Test timeout in milliseconds */
  timeout: number;
}

/**
 * Default integration test configuration
 */
export const DEFAULT_INTEGRATION_CONFIG: IntegrationTestConfig = {
  bucketPrefix: 'report-builder-integration-test',
  parameterPrefix: '/report-builder/integration-test',
  region: environmentConfig.awsRegion,
  timeout: 30000, // 30 seconds
};

/**
 * S3 Integration Test Helper
 * 
 * Provides utilities for testing S3 operations including bucket creation,
 * file upload/download, and cleanup operations.
 */
export class S3TestHelper {
  private s3Client: S3Client;
  private createdBuckets: Set<string> = new Set();
  private uploadedObjects: Map<string, string[]> = new Map();

  constructor(private config: IntegrationTestConfig = DEFAULT_INTEGRATION_CONFIG) {
    this.s3Client = new S3Client({ region: config.region });
  }

  /**
   * Create a test bucket with unique name
   * 
   * @param suffix - Optional suffix for bucket name
   * @returns Promise resolving to bucket name
   */
  async createTestBucket(suffix: string = ''): Promise<string> {
    const timestamp = Date.now();
    const bucketName = `${this.config.bucketPrefix}-${timestamp}${suffix ? '-' + suffix : ''}`;
    
    await this.s3Client.send(new CreateBucketCommand({
      Bucket: bucketName,
    }));

    this.createdBuckets.add(bucketName);
    return bucketName;
  }

  /**
   * Upload test content to S3
   * 
   * @param bucketName - Target bucket name
   * @param key - Object key
   * @param content - Content to upload
   * @param contentType - MIME type
   */
  async uploadTestFile(
    bucketName: string, 
    key: string, 
    content: string | Buffer,
    contentType: string = 'text/plain'
  ): Promise<void> {
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content,
      ContentType: contentType,
    }));

    // Track uploaded objects for cleanup
    if (!this.uploadedObjects.has(bucketName)) {
      this.uploadedObjects.set(bucketName, []);
    }
    this.uploadedObjects.get(bucketName)!.push(key);
  }

  /**
   * Download content from S3
   * 
   * @param bucketName - Source bucket name
   * @param key - Object key
   * @returns Promise resolving to file content
   */
  async downloadTestFile(bucketName: string, key: string): Promise<Buffer> {
    const response = await this.s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));

    if (!response.Body) {
      throw new Error(`No content found for ${bucketName}/${key}`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  /**
   * Check if object exists in S3
   * 
   * @param bucketName - Bucket name
   * @param key - Object key
   * @returns Promise resolving to boolean
   */
  async objectExists(bucketName: string, key: string): Promise<boolean> {
    try {
      await this.s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all objects in bucket with prefix
   * 
   * @param bucketName - Bucket name
   * @param prefix - Object key prefix
   * @returns Promise resolving to list of object keys
   */
  async listObjects(bucketName: string, prefix?: string): Promise<string[]> {
    const response = await this.s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    }));

    return response.Contents?.map(obj => obj.Key!) || [];
  }

  /**
   * Clean up all test resources
   */
  async cleanup(): Promise<void> {
    // Delete all uploaded objects
    for (const [bucketName, objectKeys] of this.uploadedObjects) {
      for (const key of objectKeys) {
        try {
          await this.s3Client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
          }));
        } catch (error) {
          console.warn(`Failed to delete object ${bucketName}/${key}:`, error);
        }
      }
    }

    // Delete all created buckets
    for (const bucketName of this.createdBuckets) {
      try {
        await this.s3Client.send(new DeleteBucketCommand({
          Bucket: bucketName,
        }));
      } catch (error) {
        console.warn(`Failed to delete bucket ${bucketName}:`, error);
      }
    }

    // Clear tracking
    this.createdBuckets.clear();
    this.uploadedObjects.clear();
  }
}

/**
 * Parameter Store Integration Test Helper
 * 
 * Provides utilities for testing Parameter Store operations including
 * parameter creation, retrieval, and cleanup.
 */
export class ParameterStoreTestHelper {
  private ssmClient: SSMClient;
  private createdParameters: Set<string> = new Set();

  constructor(private config: IntegrationTestConfig = DEFAULT_INTEGRATION_CONFIG) {
    this.ssmClient = new SSMClient({ region: config.region });
  }

  /**
   * Create a test parameter
   * 
   * @param name - Parameter name (will be prefixed)
   * @param value - Parameter value
   * @param type - Parameter type
   */
  async createTestParameter(
    name: string, 
    value: string, 
    type: 'String' | 'SecureString' = 'String'
  ): Promise<string> {
    const parameterName = `${this.config.parameterPrefix}/${name}`;
    
    await this.ssmClient.send(new PutParameterCommand({
      Name: parameterName,
      Value: value,
      Type: type,
      Overwrite: true,
    }));

    this.createdParameters.add(parameterName);
    return parameterName;
  }

  /**
   * Get a test parameter value
   * 
   * @param name - Parameter name (will be prefixed)
   * @returns Promise resolving to parameter value
   */
  async getTestParameter(name: string): Promise<string> {
    const parameterName = `${this.config.parameterPrefix}/${name}`;
    
    const response = await this.ssmClient.send(new GetParameterCommand({
      Name: parameterName,
    }));

    return response.Parameter?.Value || '';
  }

  /**
   * Set up test configuration parameters
   */
  async setupTestConfig(): Promise<void> {
    // Property mapping configuration
    await this.createTestParameter(
      'property-mapping', 
      JSON.stringify({
        'test-sender@example.com': 'test-property-1',
        'sender@warrenresorthotels.com': 'warren-main',
      })
    );

    // Email configuration
    await this.createTestParameter('email/recipients', 'test-reports@example.com');
    await this.createTestParameter('email/alert-notifications', 'test-alerts@example.com');
    await this.createTestParameter('email/from-address', 'test-noreply@warrenresorthotels.com');
    await this.createTestParameter('ses/configuration-set', 'test-report-builder');
  }

  /**
   * Clean up all test parameters
   */
  async cleanup(): Promise<void> {
    for (const parameterName of this.createdParameters) {
      try {
        await this.ssmClient.send(new DeleteParameterCommand({
          Name: parameterName,
        }));
      } catch (error) {
        console.warn(`Failed to delete parameter ${parameterName}:`, error);
      }
    }

    this.createdParameters.clear();
  }
}

/**
 * Lambda Integration Test Helper
 * 
 * Provides utilities for testing deployed Lambda functions including
 * invocation and validation.
 */
export class LambdaTestHelper {
  private lambdaClient: LambdaClient;

  constructor(private config: IntegrationTestConfig = DEFAULT_INTEGRATION_CONFIG) {
    this.lambdaClient = new LambdaClient({ region: config.region });
  }

  /**
   * Check if Lambda function exists and is deployable
   * 
   * @param functionName - Lambda function name
   * @returns Promise resolving to boolean
   */
  async functionExists(functionName: string): Promise<boolean> {
    try {
      await this.lambdaClient.send(new GetFunctionCommand({
        FunctionName: functionName,
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invoke Lambda function with test payload
   * 
   * @param functionName - Lambda function name
   * @param payload - Test payload
   * @returns Promise resolving to invocation result
   */
     async invokeFunction(functionName: string, payload: unknown): Promise<unknown> {
    const response = await this.lambdaClient.send(new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
    }));

    if (response.Payload) {
      const result = JSON.parse(Buffer.from(response.Payload).toString());
      
      if (response.FunctionError) {
        throw new Error(`Lambda function error: ${JSON.stringify(result)}`);
      }
      
      return result;
    }

    return null;
  }

  /**
   * Create test SES event payload
   * 
   * @param messageId - Test message ID
   * @param bucketName - S3 bucket name
   * @param objectKey - S3 object key
   * @returns SES event payload for testing
   */
  createTestSESEvent(messageId: string, bucketName: string, objectKey: string) {
    return {
      Records: [{
        eventSource: 'aws:ses',
        eventVersion: '1.0',
        ses: {
          mail: {
            messageId,
            timestamp: new Date().toISOString(),
            source: 'test-sender@example.com',
            destination: ['test@example.com'],
            commonHeaders: {
              from: ['test-sender@example.com'],
              to: ['test@example.com'],
              subject: 'Integration Test Email'
            }
          },
          receipt: {
            recipients: ['test@example.com'],
            timestamp: new Date().toISOString(),
            processingTimeMillis: 100,
            action: {
              type: 'S3',
              bucketName,
              objectKey
            }
          }
        }
      }]
    };
  }
}

/**
 * Integration Test Suite Manager
 * 
 * Coordinates multiple AWS service helpers and provides
 * centralized setup/teardown for integration tests.
 */
export class IntegrationTestSuite {
  public s3: S3TestHelper;
  public parameterStore: ParameterStoreTestHelper;
  public lambda: LambdaTestHelper;

  constructor(config: IntegrationTestConfig = DEFAULT_INTEGRATION_CONFIG) {
    this.s3 = new S3TestHelper(config);
    this.parameterStore = new ParameterStoreTestHelper(config);
    this.lambda = new LambdaTestHelper(config);
  }

  /**
   * Set up all test resources
   */
  async setup(): Promise<void> {
    await this.parameterStore.setupTestConfig();
  }

  /**
   * Clean up all test resources
   */
  async cleanup(): Promise<void> {
    await Promise.all([
      this.s3.cleanup(),
      this.parameterStore.cleanup(),
    ]);
  }
} 