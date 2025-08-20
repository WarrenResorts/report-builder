/**
 * @fileoverview SES Integration Tests
 * 
 * Tests the deployed SES configuration to ensure receipt rules exist.
 * Only tests what we've actually built and deployed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SESClient, DescribeReceiptRuleSetCommand, DescribeReceiptRuleCommand } from '@aws-sdk/client-ses';
import { shouldUseRealAWS, getTestMode } from './setup';
import { environmentConfig } from '../../src/config/environment';

describe('SES Integration Tests', () => {
  let sesClient: SESClient;
  const testMode = getTestMode();
  const environment = environmentConfig.environment;

  beforeAll(async () => {
    if (testMode !== 'mocked') {
      sesClient = new SESClient({ 
        region: environmentConfig.awsRegion 
      });
    }
  });

  describe('Receipt Rules', () => {
    const ruleSetName = `report-builder-rules-${environment}`;

    it('should have receipt rule set configured', async () => {
      if (testMode === 'mocked') {
        // Just verify we can create the command
        expect(() => new DescribeReceiptRuleSetCommand({ RuleSetName: ruleSetName })).not.toThrow();
        return;
      }

      const command = new DescribeReceiptRuleSetCommand({
        RuleSetName: ruleSetName
      });

      const response = await sesClient.send(command);
      
      expect(response.RuleSet).toBeDefined();
      expect(response.RuleSet?.Name).toBe(ruleSetName);
      expect(response.Rules).toBeDefined();
      expect(response.Rules?.length).toBeGreaterThan(0);
    });

    it('should have email processing rule configured', async () => {
      if (testMode === 'mocked') {
        // Just verify we can create the command
        expect(() => new DescribeReceiptRuleCommand({ 
          RuleSetName: ruleSetName, 
          RuleName: 'ProcessIncomingEmails' 
        })).not.toThrow();
        return;
      }

      const command = new DescribeReceiptRuleCommand({
        RuleSetName: ruleSetName,
        RuleName: 'ProcessIncomingEmails'
      });

      const response = await sesClient.send(command);
      
      expect(response.Rule).toBeDefined();
      expect(response.Rule?.Name).toBe('ProcessIncomingEmails');
      expect(response.Rule?.Enabled).toBe(true);
      expect(response.Rule?.Actions).toBeDefined();
      expect(response.Rule?.Actions?.length).toBeGreaterThan(0);
      
      // Should have S3 action for storing emails
      const s3Action = response.Rule?.Actions?.find(action => action.S3Action);
      expect(s3Action).toBeDefined();
      
      // Should have Lambda action for processing emails
      const lambdaAction = response.Rule?.Actions?.find(action => action.LambdaAction);
      expect(lambdaAction).toBeDefined();
    });
  });
});
