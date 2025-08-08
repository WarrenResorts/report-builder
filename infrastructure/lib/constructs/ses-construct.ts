import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { EnvironmentConfig } from '../../config';

/**
 * Props for the SES construct
 */
export interface SESConstructProps {
  /** Deployment environment (development/production) */
  environment: 'development' | 'production';
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** S3 bucket for storing incoming emails */
  incomingFilesBucket: s3.Bucket;
  /** Lambda function for processing emails (optional - can be set later) */
  emailProcessorLambda?: lambda.Function;
}

/**
 * SES (Simple Email Service) resources for the Report Builder application
 * 
 * This construct creates and configures all SES resources needed for email processing:
 * - Domain identity verification for sending/receiving emails
 * - Configuration set for tracking and management
 * - Receipt rule set for processing incoming emails
 * - Integration with S3 and Lambda for email processing pipeline
 */
export class SESConstruct extends Construct {
  /** SES domain identity for email verification */
  public readonly domainIdentity: ses.EmailIdentity;
  
  /** SES configuration set for email tracking */
  public readonly configurationSet: ses.ConfigurationSet;
  
  /** SES receipt rule set for processing incoming emails */
  public readonly receiptRuleSet: ses.ReceiptRuleSet;

  /** Store configuration for later use */
  private readonly config: EnvironmentConfig;
  private readonly environment: 'development' | 'production';
  private readonly incomingFilesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SESConstructProps) {
    super(scope, id);

    const { environment, config, incomingFilesBucket, emailProcessorLambda } = props;
    const { domainName, emailAddress } = config.domain;

    // Store for later use
    this.config = config;
    this.environment = environment;
    this.incomingFilesBucket = incomingFilesBucket;

    // ===================================================================
    // SES DOMAIN AND EMAIL CONFIGURATION
    // ===================================================================
    
    // SES Domain Identity - verify domain ownership for sending/receiving emails
    this.domainIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(domainName),
    });

    // SES Configuration Set - for email sending configuration and tracking
    this.configurationSet = new ses.ConfigurationSet(this, 'SESConfigurationSet', {
      configurationSetName: `${config.naming.projectPrefix}${config.naming.separator}${environment}`,
      // Add reputation tracking for production
      reputationMetrics: environment === 'production',
    });

    // ===================================================================
    // SES EMAIL RECEIPT RULE CONFIGURATION
    // ===================================================================
    
    // Receipt Rule Set - defines how to handle incoming emails
    this.receiptRuleSet = new ses.ReceiptRuleSet(this, 'EmailReceiptRuleSet', {
      receiptRuleSetName: `${config.naming.projectPrefix}${config.naming.separator}rules${config.naming.separator}${environment}`,
    });

    // Receipt Rule - process emails sent to the specified address
    const actions = [
      // First: Store raw email in S3
      new sesActions.S3({
        bucket: incomingFilesBucket,
        objectKeyPrefix: 'raw-emails/',
        topic: undefined, // We'll use Lambda for processing instead of SNS
      }),
    ];

    // Add Lambda action only if emailProcessorLambda is provided
    if (emailProcessorLambda) {
      actions.push(
        new sesActions.Lambda({
          function: emailProcessorLambda,
          invocationType: sesActions.LambdaInvocationType.EVENT, // Async processing
        }) as any // Type assertion needed due to CDK typing complexity
      );
    }

    const emailReceiptRule = this.receiptRuleSet.addRule('ProcessIncomingEmails', {
      enabled: true,
      // Match emails sent to our reports address
      recipients: [emailAddress],
      // Define actions to take when email is received
      actions,
      // Scan for spam and viruses
      scanEnabled: true,
    });

    // Make the rule set active (only one can be active at a time)
    // Temporarily commented out to debug deployment issues
    // new ses.CfnReceiptRuleSet(this, 'ActiveRuleSet', {
    //   ruleSetName: this.receiptRuleSet.receiptRuleSetName,
    // });

    // ===================================================================
    // CLOUDFORMATION OUTPUTS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'SESdomainVerificationToken', {
      value: this.domainIdentity.dkimDnsTokenName1,
      description: 'SES domain verification token for DNS configuration',
    });

    new cdk.CfnOutput(this, 'SESConfigurationSetName', {
      value: this.configurationSet.configurationSetName,
      description: 'SES configuration set name for email sending',
    });

    new cdk.CfnOutput(this, 'SESReceiptRuleSetName', {
      value: this.receiptRuleSet.receiptRuleSetName,
      description: 'SES receipt rule set name for email processing',
    });

    new cdk.CfnOutput(this, 'EmailAddress', {
      value: emailAddress,
      description: 'Email address for receiving reports',
    });

    // ===================================================================
    // MANUAL SETUP INSTRUCTIONS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'ManualSetupInstructions', {
      value: [
        'MANUAL SETUP REQUIRED:',
        '1. Add DNS TXT record for domain verification:',
        `   Name: _amazonses.${domainName}`,
        `   Value: ${this.domainIdentity.dkimDnsTokenName1}`,
        '2. Configure MX record to receive emails:',
        `   Name: ${domainName}`,
        '   Value: 10 inbound-smtp.<region>.amazonaws.com',
        '3. Activate the SES receipt rule set in the AWS Console',
        '4. Verify domain identity status in SES console'
      ].join('\\n'),
      description: 'Manual setup steps required after deployment',
    });
  }

  /**
   * Create IAM permissions for services to interact with SES
   * 
   * @returns Array of IAM policy statements for SES operations
   */
  public createSESPermissions() {
    return {
      // Permissions for Lambda to send emails through SES
      sendEmail: new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          'ses:SendEmail',
          'ses:SendRawEmail',
        ],
        resources: [
          `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:identity/${this.domainIdentity.emailIdentityName}`,
          `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:configuration-set/${this.configurationSet.configurationSetName}`,
        ],
      }),
      
      // Permissions for SES to invoke Lambda functions
      lambdaInvoke: new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['lambda:InvokeFunction'],
        conditions: {
          StringEquals: {
            'AWS:SourceAccount': cdk.Stack.of(this).account,
          },
        },
      }),
    };
  }

  /**
   * Add Lambda function to the existing receipt rule
   * Call this after the Lambda function has been created
   * 
   * @param emailProcessorLambda - Lambda function to add to receipt rule actions
   */
  public addLambdaToReceiptRule(emailProcessorLambda: lambda.Function): void {
    const { emailAddress } = this.config.domain;

    // Create a new receipt rule that includes the Lambda action
    // This will replace the existing rule that only had S3 action
    this.receiptRuleSet.addRule('ProcessIncomingEmailsWithLambda', {
      enabled: true,
      recipients: [emailAddress],
      actions: [
        // First: Store raw email in S3
        new sesActions.S3({
          bucket: this.incomingFilesBucket,
          objectKeyPrefix: 'raw-emails/',
          topic: undefined,
        }),
        // Second: Trigger Lambda function for processing
        new sesActions.Lambda({
          function: emailProcessorLambda,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
             scanEnabled: true,
    });
  }

  /**
   * Get the SES service principal for S3 bucket policies
   * 
   * @returns SES service principal
   */
  public static getSESServicePrincipal(): cdk.aws_iam.ServicePrincipal {
    return new cdk.aws_iam.ServicePrincipal('ses.amazonaws.com');
  }
} 