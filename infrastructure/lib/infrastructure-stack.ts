import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';

export interface InfrastructureStackProps extends cdk.StackProps {
  environment: 'development' | 'production';
}

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const domainName = 'aws.warrenresorthotels.com';
    const emailAddress = `reports@${domainName}`;

    // S3 Buckets for file storage - import existing buckets
    const incomingFilesBucket = s3.Bucket.fromBucketName(
      this, 
      'IncomingFilesBucket', 
      `report-builder-incoming-files-${environment}`
    );

    const processedFilesBucket = s3.Bucket.fromBucketName(
      this, 
      'ProcessedFilesBucket', 
      `report-builder-processed-files-${environment}`
    );

    // SES Configuration for email handling
    const sesConfigurationSet = new ses.ConfigurationSet(this, 'SESConfigurationSet', {
      configurationSetName: `report-builder-${environment}`,
    });

    // SES Domain Identity for warrenresorthotels.com
    const domainIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(domainName),
      configurationSet: sesConfigurationSet,
    });

    // SES Receipt Rule Set for handling incoming emails
    const receiptRuleSet = new ses.ReceiptRuleSet(this, 'EmailReceiptRuleSet', {
      receiptRuleSetName: `report-builder-email-rules-${environment}`,
    });

    // Lambda execution role with necessary permissions
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                incomingFilesBucket.bucketArn,
                `${incomingFilesBucket.bucketArn}/*`,
                processedFilesBucket.bucketArn,
                `${processedFilesBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
        SESAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ses:SendEmail',
                'ses:SendRawEmail',
              ],
              resources: ['*'], // SES doesn't support resource-level permissions
            }),
          ],
        }),
        ParameterStoreAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
              ],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/report-builder/${environment}/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Email processing Lambda function
    const emailProcessorLambda = new lambdaNodejs.NodejsFunction(this, 'EmailProcessorLambda', {
      functionName: `report-builder-email-processor-${environment}`,
      entry: '../src/lambda/email-processor.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      role: lambdaExecutionRole,
      environment: {
        ENVIRONMENT: environment,
        INCOMING_FILES_BUCKET: incomingFilesBucket.bucketName,
        PROCESSED_BUCKET: processedFilesBucket.bucketName,
        MAPPING_PREFIX: 'mapping-files/',
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Grant SES permission to invoke the Lambda function
    emailProcessorLambda.addPermission('SESInvokePermission', {
      principal: new iam.ServicePrincipal('ses.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
    });

    // SES Receipt Rule for processing incoming emails
    new ses.ReceiptRule(this, 'EmailReceiptRule', {
      ruleSet: receiptRuleSet,
      recipients: [emailAddress],
      actions: [
        // Store email in S3
        new sesActions.S3({
          bucket: incomingFilesBucket,
          objectKeyPrefix: 'raw-emails/',
        }),
        // Trigger Lambda processing
        new sesActions.Lambda({
          function: emailProcessorLambda,
        }),
      ],
      enabled: true,
    });

    // Grant SES permission to write to S3 bucket
    new s3.CfnBucketPolicy(this, 'IncomingFilesBucketPolicy', {
      bucket: incomingFilesBucket.bucketName,
      policyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'ses.amazonaws.com' },
            Action: 's3:PutObject',
            Resource: `${incomingFilesBucket.bucketArn}/raw-emails/*`,
            Condition: {
              StringEquals: {
                'aws:Referer': this.account,
              },
            },
          },
        ],
      },
    });

    // Note: Parameter Store configuration will be added in a separate deployment
    // to avoid conflicts during initial setup

    // File processing Lambda function (placeholder for Phase 3)
    const fileProcessorLambda = new lambda.Function(this, 'FileProcessorLambda', {
      functionName: `report-builder-file-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('File processor triggered:', JSON.stringify(event, null, 2));
          return { statusCode: 200, body: 'Files processed successfully' };
        };
      `),
      role: lambdaExecutionRole,
      environment: {
        ENVIRONMENT: environment,
        INCOMING_BUCKET: incomingFilesBucket.bucketName,
        PROCESSED_BUCKET: processedFilesBucket.bucketName,
        MAPPING_PREFIX: 'mapping-files/',
      },
      timeout: cdk.Duration.minutes(15), // File processing might take longer
    });

    // EventBridge Scheduled Rule - Daily at 11:59 AM
    const dailyProcessingRule = new events.Rule(this, 'DailyProcessingRule', {
      ruleName: `report-builder-daily-processing-${environment}`,
      description: 'Triggers daily batch processing of collected files',
      schedule: events.Schedule.cron({
        minute: '59',
        hour: '11', // 11:59 AM (UTC - adjust for timezone as needed)
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    // Add file processor Lambda as target for scheduled processing
    dailyProcessingRule.addTarget(new eventsTargets.LambdaFunction(fileProcessorLambda));

    // Grant EventBridge permission to invoke the Lambda function
    fileProcessorLambda.addPermission('EventBridgeInvokePermission', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: dailyProcessingRule.ruleArn,
    });

    // CloudFormation outputs for reference
    new cdk.CfnOutput(this, 'DomainName', {
      value: domainName,
      description: 'Domain name for email receiving (warrenresorthotels.com)',
    });

    new cdk.CfnOutput(this, 'EmailAddress', {
      value: emailAddress,
      description: 'Email address for receiving reports (reports@warrenresorthotels.com)',
    });

    new cdk.CfnOutput(this, 'DomainIdentityName', {
      value: domainIdentity.emailIdentityName,
      description: 'SES Domain Identity Name for verification',
    });

    new cdk.CfnOutput(this, 'ReceiptRuleSetName', {
      value: receiptRuleSet.receiptRuleSetName,
      description: 'SES Receipt Rule Set Name',
    });

    new cdk.CfnOutput(this, 'IncomingBucketName', {
      value: incomingFilesBucket.bucketName,
      description: 'S3 bucket for incoming files and mapping files (mapping-files/ prefix)',
    });

    new cdk.CfnOutput(this, 'ProcessedBucketName', {
      value: processedFilesBucket.bucketName,
      description: 'S3 bucket for processed files',
    });

    new cdk.CfnOutput(this, 'EmailProcessorLambdaArn', {
      value: emailProcessorLambda.functionArn,
      description: 'ARN of the email processor Lambda function',
    });

    new cdk.CfnOutput(this, 'FileProcessorLambdaArn', {
      value: fileProcessorLambda.functionArn,
      description: 'ARN of the file processor Lambda function',
    });

    new cdk.CfnOutput(this, 'SESConfigurationSetName', {
      value: sesConfigurationSet.configurationSetName,
      description: 'SES configuration set name',
    });

    new cdk.CfnOutput(this, 'DailyProcessingRuleArn', {
      value: dailyProcessingRule.ruleArn,
      description: 'ARN of the daily processing EventBridge rule (11:59 AM daily)',
    });

    // Parameter Store outputs will be added later

    // Manual setup instructions output
    new cdk.CfnOutput(this, 'ManualSetupInstructions', {
      value: 'After deployment: 1) Add DNS records for domain verification, 2) Set receipt rule set as active in SES console, 3) Populate Parameter Store values',
      description: 'Required manual setup steps after deployment',
    });
  }
}
