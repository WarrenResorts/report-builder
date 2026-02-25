import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageConstruct } from './constructs/storage-construct';
import { SESConstruct } from './constructs/ses-construct';
import { LambdaConstruct } from './constructs/lambda-construct';
import { EventsConstruct } from './constructs/events-construct';
import { ConfigLoader } from '../config';

/**
 * Props interface for the InfrastructureStack
 * Extends standard CDK stack props with environment-specific configuration
 */
export interface InfrastructureStackProps extends cdk.StackProps {
  environment: 'development' | 'production';
}

/**
 * Main infrastructure stack for the Report Builder application
 * 
 * This stack orchestrates all AWS resources needed for the email processing pipeline
 * by composing focused construct classes for different concerns:
 * 
 * - **StorageConstruct**: S3 buckets for file storage with lifecycle policies
 * - **SESConstruct**: SES domain verification and email receipt rules
 * - **LambdaConstruct**: Lambda functions for email and file processing with IAM roles
 * - **EventsConstruct**: EventBridge rules for scheduled batch processing
 * 
 * Each construct is focused on a single responsibility, making the infrastructure
 * easier to understand, test, and maintain. The main stack coordinates the
 * dependencies between constructs and exposes key outputs.
 */
export class InfrastructureStack extends cdk.Stack {
  /** Storage resources (S3 buckets) */
  public readonly storage: StorageConstruct;
  
  /** SES resources (domain, rules) */
  public readonly ses: SESConstruct;
  
  /** Lambda resources (functions, roles) */
  public readonly lambda: LambdaConstruct;
  
  /** EventBridge resources (scheduling) */
  public readonly events: EventsConstruct;

  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    const { environment } = props;
    
    // Load environment-specific configuration
    const configLoader = ConfigLoader.getInstance();
    const config = configLoader.getConfig(environment);
    
    // Extract configuration values
    const { domainName } = config.domain;

    // ===================================================================
    // STORAGE CONSTRUCT - S3 BUCKETS AND POLICIES
    // ===================================================================
    
    this.storage = new StorageConstruct(this, 'Storage', {
      environment,
      config,
      sesServicePrincipal: SESConstruct.getSESServicePrincipal(),
    });

    // ===================================================================
    // SES CONSTRUCT - DOMAIN AND EMAIL CONFIGURATION (PARTIAL)
    // ===================================================================
    
    // Create SES construct first to get domain identity and config set, but without receipt rules
    this.ses = new SESConstruct(this, 'SES', {
      environment,
      config,
      incomingFilesBucket: this.storage.incomingFilesBucket,
      // emailProcessorLambda will be added to receipt rules after Lambda is created
    });

    // ===================================================================
    // LAMBDA CONSTRUCT - FUNCTIONS AND IAM ROLES
    // ===================================================================
    
    this.lambda = new LambdaConstruct(this, 'Lambda', {
      environment,
      config,
      incomingFilesBucket: this.storage.incomingFilesBucket,
      processedFilesBucket: this.storage.processedFilesBucket,
      mappingFilesBucket: this.storage.mappingFilesBucket,
      s3PolicyStatements: this.storage.createLambdaS3Permissions(),
      sesPermissions: this.ses.createSESPermissions(), // SES permissions are now available
    });

    // Add Lambda action to SES receipt rules after Lambda is created
    this.ses.addLambdaToReceiptRule(this.lambda.emailProcessorLambda);

    // Note: SES receipt rules with Lambda actions are now created automatically in the SES construct

    // ===================================================================
    // EVENTS CONSTRUCT - EVENTBRIDGE SCHEDULING
    // ===================================================================
    
    this.events = new EventsConstruct(this, 'Events', {
      environment,
      config,
      fileProcessorLambda: this.lambda.fileProcessorLambda,
    });

    // ===================================================================
    // CROSS-CONSTRUCT CONFIGURATION
    // ===================================================================
    
    // Add SES configuration set name to Lambda environment variables
    this.lambda.addEnvironmentVariables({
      SES_CONFIGURATION_SET: this.ses.configurationSet.configurationSetName,
    });

    // ===================================================================
    // STACK-LEVEL OUTPUTS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'StackSummary', {
      value: [
        'REPORT BUILDER INFRASTRUCTURE DEPLOYED:',
        `Environment: ${environment}`,
        `Domain: ${domainName}`,
        'Email addresses: Available in Parameter Store',
        '',
        'Resources Created:',
        `- S3 Buckets: ${this.storage.incomingFilesBucket.bucketName}, ${this.storage.processedFilesBucket.bucketName}, ${this.storage.mappingFilesBucket.bucketName}`,
        `- Lambda Functions: ${this.lambda.getFunctionNames().emailProcessor}, ${this.lambda.getFunctionNames().fileProcessor}`,
        `- SES Domain: ${this.ses.domainIdentity.emailIdentityName}`,
        `- EventBridge Rules: ${this.events.getRuleNames().dailyProcessing}, ${this.events.getRuleNames().weeklyReport}`,
      ].join('\\n'),
      description: 'Summary of deployed Report Builder infrastructure',
    });

    new cdk.CfnOutput(this, 'NextSteps', {
      value: [
        'NEXT STEPS AFTER DEPLOYMENT:',
        '1. Configure DNS records for SES domain verification',
        '2. Activate SES receipt rule set in AWS Console',
        '3. Upload mapping files to the mapping bucket',
        '4. Test email processing by sending to the configured address',
        '5. Monitor CloudWatch logs for processing status',
      ].join('\\n'),
      description: 'Required manual steps after infrastructure deployment',
    });

    // ===================================================================
    // TAGGING STRATEGY
    // ===================================================================
    
    // Apply consistent tags to all resources in the stack from configuration
    Object.entries(config.tagging.required).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment-specific tags from configuration
    Object.entries(config.tagging.environmentSpecific).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }

  /**
   * Get all resource names for external reference
   * 
   * @returns Object containing all resource names
   */
  public getResourceNames() {
    return {
      buckets: {
        incoming: this.storage.incomingFilesBucket.bucketName,
        processed: this.storage.processedFilesBucket.bucketName,
        mapping: this.storage.mappingFilesBucket.bucketName,
      },
      functions: this.lambda.getFunctionNames(),
      rules: this.events.getRuleNames(),
      ses: {
        domain: this.ses.domainIdentity.emailIdentityName,
        configurationSet: this.ses.configurationSet.configurationSetName,
        ruleSet: this.ses.receiptRuleSet.receiptRuleSetName,
      },
    };
  }

  /**
   * Get all resource ARNs for cross-stack references
   * 
   * @returns Object containing all resource ARNs
   */
  public getResourceArns() {
    return {
      buckets: {
        incoming: this.storage.incomingFilesBucket.bucketArn,
        processed: this.storage.processedFilesBucket.bucketArn,
        mapping: this.storage.mappingFilesBucket.bucketArn,
      },
      functions: this.lambda.getFunctionArns(),
      rules: this.events.getRuleArns(),
    };
  }
}
