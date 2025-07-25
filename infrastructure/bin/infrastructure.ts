#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();

// Get environment from context (set via --context environment=development)
const environment = app.node.tryGetContext('environment') || 'development';

// Validate environment
if (!['development', 'production'].includes(environment)) {
  throw new Error(`Invalid environment: ${environment}. Must be 'development' or 'production'`);
}

// Create stack with environment-specific configuration
new InfrastructureStack(app, `ReportBuilderStack-${environment}`, {
  environment: environment as 'development' | 'production',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: `Report Builder infrastructure for ${environment} environment`,
  tags: {
    Environment: environment,
    Project: 'report-builder',
    ManagedBy: 'CDK',
  },
});