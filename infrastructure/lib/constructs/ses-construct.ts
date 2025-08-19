import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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
  public readonly domainIdentity: ses.IEmailIdentity;
  
  /** SES configuration set for email tracking */
  public readonly configurationSet: ses.ConfigurationSet;
  
  /** SES receipt rule set for processing incoming emails */
  public readonly receiptRuleSet: ses.IReceiptRuleSet;

  /** Store configuration for later use */
  private readonly config: EnvironmentConfig;
  private readonly environment: 'development' | 'production';
  private readonly incomingFilesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SESConstructProps) {
    super(scope, id);

    const { environment, config, incomingFilesBucket, emailProcessorLambda } = props;
    const { domainName } = config.domain;

    // Store for later use
    this.config = config;
    this.environment = environment;
    this.incomingFilesBucket = incomingFilesBucket;

    // ===================================================================
    // SES DOMAIN AND EMAIL CONFIGURATION
    // ===================================================================
    
    // SES Domain Identity - verify domain ownership for sending/receiving emails
    // Only create the domain identity in development; production will reference the existing one
    if (environment === 'development') {
      this.domainIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
        identity: ses.Identity.domain(domainName),
      });
    } else {
      // For production, reference the existing domain identity created by development
      this.domainIdentity = ses.EmailIdentity.fromEmailIdentityName(
        this, 
        'DomainIdentity', 
        domainName
      );
    }

    // SES Configuration Set - for email sending configuration and tracking
    this.configurationSet = new ses.ConfigurationSet(this, 'SESConfigurationSet', {
      configurationSetName: `${config.naming.projectPrefix}${config.naming.separator}${environment}`,
      // Add reputation tracking for production
      reputationMetrics: environment === 'production',
    });

    // ===================================================================
    // EMAIL ADDRESS PARAMETER STORE CONFIGURATION
    // ===================================================================
    
    // Each environment creates only its own parameter (multi-account approach)
    const defaultFromEmail = environment === 'development' 
      ? 'dev@dev.warrenresorthotels.com' 
      : 'reports@aws.warrenresorthotels.com';
    
    const currentEmailParam = new ssm.StringParameter(this, 'IncomingEmailParameter', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/email/incoming-address`,
      stringValue: defaultFromEmail,
      description: `${environment} incoming email address for SES receipt rules`,
    });

    // ===================================================================
    // SES EMAIL RECEIPT RULE CONFIGURATION  
    // ===================================================================
    
    // Each environment has its own independent rule set (multi-account approach)
    const ruleSetName = `${config.naming.projectPrefix}${config.naming.separator}rules${config.naming.separator}${environment}`;

    // Create rule set for current environment only
    this.receiptRuleSet = new ses.ReceiptRuleSet(this, 'EmailReceiptRuleSet', {
      receiptRuleSetName: ruleSetName,
    });

    // Create email processing rule for current environment
    const emailActions = [
      new sesActions.S3({
        bucket: incomingFilesBucket,
        objectKeyPrefix: 'raw-emails/',
      }),
    ];

    if (emailProcessorLambda) {
      emailActions.push(
        new sesActions.Lambda({
          function: emailProcessorLambda,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }) as any
      );
    }

    this.receiptRuleSet.addRule(`ProcessEmails${environment.charAt(0).toUpperCase() + environment.slice(1)}`, {
      enabled: true,
      recipients: [currentEmailParam.stringValue],
      actions: emailActions,
      scanEnabled: true,
    });

    // Activate the rule set for this environment
    new cr.AwsCustomResource(this, 'ActivateReceiptRuleSet', {
      onCreate: {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: {
          RuleSetName: ruleSetName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`activate-${ruleSetName}`),
      },
      onUpdate: {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: {
          RuleSetName: ruleSetName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`activate-${ruleSetName}`),
      },
      onDelete: {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: {
          // Deactivate by setting no active rule set
        },
        physicalResourceId: cr.PhysicalResourceId.of(`activate-${ruleSetName}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            'ses:SetActiveReceiptRuleSet',
            'ses:DescribeActiveReceiptRuleSet'
          ],
          resources: ['*'],
        }),
      ]),
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // ===================================================================
    // CLOUDFORMATION OUTPUTS
    // ===================================================================
    
    // Only output DKIM tokens when we create the domain identity (development)
    // Note: DKIM records are automatically generated by SES and can be viewed in the AWS Console
    // We don't output them here to avoid CloudFormation synthesis issues

    new cdk.CfnOutput(this, 'SESConfigurationSetName', {
      value: this.configurationSet.configurationSetName,
      description: 'SES configuration set name for email sending',
    });

    new cdk.CfnOutput(this, 'SESReceiptRuleSetName', {
      value: ruleSetName,
      description: 'SES receipt rule set name for email processing',
    });

    new cdk.CfnOutput(this, 'EmailAddressParameters', {
      value: `${environment}: ${currentEmailParam.parameterName}`,
      description: 'Parameter Store path for incoming email address',
    });

    // ===================================================================
    // MANUAL SETUP INSTRUCTIONS
    // ===================================================================
    
    const setupInstructions = [
      'MANUAL SETUP REQUIRED:',
      '1. Add DNS TXT record for domain verification:',
      `   Name: _amazonses.${domainName}`,
    ];

    setupInstructions.push('   Value: <Check AWS SES Console for DKIM verification tokens>');

    setupInstructions.push(
      '2. Configure MX record to receive emails:',
      `   Name: ${domainName}`,
      '   Value: 10 inbound-smtp.<region>.amazonaws.com',
      '3. Activate the SES receipt rule set in the AWS Console',
      '4. Verify domain identity status in SES console'
    );

    new cdk.CfnOutput(this, 'ManualSetupInstructions', {
      value: setupInstructions.join('\\n'),
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

    // Note: Lambda functions are now added to receipt rules automatically in the constructor

  /**
   * Get the SES service principal for S3 bucket policies
   * 
   * @returns SES service principal
   */
  public static getSESServicePrincipal(): cdk.aws_iam.ServicePrincipal {
    return new cdk.aws_iam.ServicePrincipal('ses.amazonaws.com');
  }
} 