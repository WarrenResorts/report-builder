/**
 * @fileoverview S3 Integration Tests
 * 
 * Tests the deployed S3 buckets to ensure they exist and are accessible.
 * Only tests what we've actually built and deployed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { shouldUseRealAWS, getTestMode } from './setup';
import { environmentConfig } from '../../src/config/environment';

describe('S3 Integration Tests', () => {
  let s3Client: S3Client;
  const testMode = getTestMode();
  const environment = environmentConfig.environment;

  beforeAll(async () => {
    if (testMode !== 'mocked') {
      s3Client = new S3Client({ 
        region: environmentConfig.awsRegion 
      });
    }
  });

  describe('Required S3 Buckets', () => {
    const buckets = [
      `report-builder-incoming-files-${environment}-v2`,
      `report-builder-processed-files-${environment}-v2`,
      `report-builder-mapping-files-${environment}-v2`
    ];

    buckets.forEach(bucketName => {
      it(`should have ${bucketName.replace(/-v2$/, '')} bucket accessible`, async () => {
        if (testMode === 'mocked') {
          // Just verify we can create the client and commands
          expect(() => new S3Client({ region: 'us-east-1' })).not.toThrow();
          expect(() => new HeadBucketCommand({ Bucket: bucketName })).not.toThrow();
          return;
        }

        // Test against real AWS - verify bucket exists and is accessible
        const command = new HeadBucketCommand({
          Bucket: bucketName
        });

        // Should not throw an error if bucket exists and is accessible
        await expect(s3Client.send(command)).resolves.not.toThrow();
      });

      it(`should be able to list objects in ${bucketName.replace(/-v2$/, '')} bucket`, async () => {
        if (testMode === 'mocked') {
          // Just verify we can create the list command
          expect(() => new ListObjectsV2Command({ Bucket: bucketName })).not.toThrow();
          return;
        }

        // Test against real AWS - verify we can list objects (even if empty)
        const command = new ListObjectsV2Command({
          Bucket: bucketName,
          MaxKeys: 1 // Just test that we can list
        });

        const response = await s3Client.send(command);
        
        expect(response).toBeDefined();
        expect(response.Name).toBe(bucketName);
        // Contents may be undefined if bucket is empty, which is fine
        expect(response.Contents).toBeUndefined(); // Should be empty initially
      });
    });
  });
});
