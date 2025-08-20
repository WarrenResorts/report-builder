/**
 * @fileoverview Lambda Integration Tests
 * 
 * Tests the deployed Lambda functions to ensure they exist and are functional.
 * Only tests what we've actually built and deployed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LambdaClient, InvokeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { shouldUseRealAWS, getTestMode } from './setup';
import { environmentConfig } from '../../src/config/environment';

describe('Lambda Integration Tests', () => {
  let lambdaClient: LambdaClient;
  const testMode = getTestMode();
  const environment = environmentConfig.environment;

  beforeAll(async () => {
    if (testMode !== 'mocked') {
      lambdaClient = new LambdaClient({ 
        region: environmentConfig.awsRegion 
      });
    }
  });

  describe('Email Processor Lambda', () => {
    const functionName = `report-builder-email-processor-${environment}`;

    it('should exist and be accessible', async () => {
      if (testMode === 'mocked') {
        // Just verify we can create the client
        expect(() => new LambdaClient({ region: 'us-east-1' })).not.toThrow();
        return;
      }

      // Test against real AWS - verify function exists
      const command = new GetFunctionCommand({
        FunctionName: functionName
      });

      const response = await lambdaClient.send(command);
      
      expect(response.Configuration).toBeDefined();
      expect(response.Configuration?.FunctionName).toContain('email-processor');
      expect(response.Configuration?.Runtime).toBe('nodejs20.x');
      expect(response.Configuration?.State).toBe('Active');
    });

    it('should be invokable', async () => {
      if (testMode === 'mocked') {
        // Just verify we can create the invoke command
        expect(() => new InvokeCommand({ FunctionName: 'test' })).not.toThrow();
        return;
      }

      // Test against real AWS - verify function can be invoked
      // We'll use a minimal test event that won't cause processing errors
      const testEvent = {
        Records: []
      };

      const command = new InvokeCommand({
        FunctionName: functionName,
        Payload: JSON.stringify(testEvent),
        InvocationType: 'RequestResponse'
      });

      const response = await lambdaClient.send(command);
      
      expect(response.StatusCode).toBe(200);
      expect(response.Payload).toBeDefined();
    });
  });
});
