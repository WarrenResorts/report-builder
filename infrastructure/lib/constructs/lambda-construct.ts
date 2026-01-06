import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { EnvironmentConfig } from '../../config';

/**
 * Props for the Lambda construct
 */
export interface LambdaConstructProps {
  /** Deployment environment (development/production) */
  environment: 'development' | 'production';
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** S3 bucket for incoming files */
  incomingFilesBucket: s3.Bucket;
  /** S3 bucket for processed files */
  processedFilesBucket: s3.Bucket;
  /** S3 bucket for mapping files */
  mappingFilesBucket: s3.Bucket;
  /** IAM policy statements for S3 access */
  s3PolicyStatements: iam.PolicyStatement[];
  /** IAM policy statements for SES operations */
  sesPermissions: {
    sendEmail: iam.PolicyStatement;
    lambdaInvoke: iam.PolicyStatement;
  };
}

/**
 * Lambda functions and IAM resources for the Report Builder application
 * 
 * This construct creates and configures all Lambda functions needed for email processing:
 * - Email processor function for parsing emails and extracting attachments
 * - File processor function for transforming and organizing data
 * - IAM roles with least-privilege permissions for each function
 * - Environment variables and runtime configuration
 */
export class LambdaConstruct extends Construct {
  /** Lambda function for processing incoming emails */
  public readonly emailProcessorLambda: lambdaNodejs.NodejsFunction;
  
  /** Lambda function for processing files */
  public readonly fileProcessorLambda: lambdaNodejs.NodejsFunction;
  
  /** Dead Letter Queue for failed email processing */
  public readonly emailProcessorDLQ: sqs.Queue;
  
  /** SNS topic for DLQ alerts */
  public readonly dlqAlertTopic: sns.Topic;
  
  /** CloudWatch alarm for DLQ messages */
  public readonly dlqAlarm: cloudwatch.Alarm;
  
  /** IAM execution role for email processor */
  public readonly emailProcessorRole: iam.Role;
  
  /** IAM execution role for file processor */
  public readonly fileProcessorRole: iam.Role;

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    const { 
      environment, 
      config,
      incomingFilesBucket, 
      processedFilesBucket, 
      mappingFilesBucket,
      s3PolicyStatements,
      sesPermissions
    } = props;

    // ===================================================================
    // IAM ROLE AND PERMISSIONS CONFIGURATION
    // ===================================================================
    
    // IAM Role for Email Processor Lambda - with specific permissions for email processing
    this.emailProcessorRole = new iam.Role(this, 'EmailProcessorRole', {
      roleName: `${config.naming.projectPrefix}${config.naming.separator}email-processor-role${config.naming.separator}${environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Report Builder email processor Lambda function',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: s3PolicyStatements,
        }),
                ParameterStoreAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters', 
                'ssm:GetParametersByPath',
              ],
              resources: [
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/${config.naming.projectPrefix}/${environment}/*`,
              ],
            }),
            // KMS permissions for decrypting SecureString parameters
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt',
                'kms:DescribeKey',
              ],
              resources: [
                // Allow access to default SSM KMS key
                `arn:aws:kms:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:key/alias/aws/ssm`,
                // Allow access to account's default KMS key for SSM
                `arn:aws:kms:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:alias/aws/ssm`,
              ],
            }),
          ],
        }),
        SESAccess: new iam.PolicyDocument({
          statements: [sesPermissions.sendEmail],
        }),
      },
    });

    // IAM Role for File Processor Lambda - with specific permissions for file processing
    this.fileProcessorRole = new iam.Role(this, 'FileProcessorRole', {
      roleName: `${config.naming.projectPrefix}${config.naming.separator}file-processor-role${config.naming.separator}${environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Report Builder file processor Lambda function',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: s3PolicyStatements,
        }),
                ParameterStoreAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
              ],
              resources: [
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/${config.naming.projectPrefix}/${environment}/*`,
              ],
            }),
            // KMS permissions for decrypting SecureString parameters
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt',
                'kms:DescribeKey',
              ],
              resources: [
                // Allow access to default SSM KMS key
                `arn:aws:kms:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:key/alias/aws/ssm`,
                // Allow access to account's default KMS key for SSM
                `arn:aws:kms:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:alias/aws/ssm`,
              ],
            }),
          ],
        }),
        SESAccess: new iam.PolicyDocument({
          statements: [sesPermissions.sendEmail],
        }),
      },
    });

    // ===================================================================
    // DEAD LETTER QUEUE CONFIGURATION
    // ===================================================================
    
    // Dead Letter Queue for failed email processing attempts
    // This captures Lambda invocations that fail after automatic retries
    this.emailProcessorDLQ = new sqs.Queue(this, 'EmailProcessorDLQ', {
      queueName: `${config.naming.projectPrefix}${config.naming.separator}email-processor-dlq${config.naming.separator}${environment}`,
      // Retain messages for 14 days for debugging and recovery
      retentionPeriod: cdk.Duration.days(14),
      // Set visibility timeout for message processing
      visibilityTimeout: cdk.Duration.minutes(5),
      // Add encryption for sensitive email content
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // SNS Topic for DLQ alerts - enables email and Slack notifications
    this.dlqAlertTopic = new sns.Topic(this, 'EmailProcessorDLQAlertTopic', {
      topicName: `${config.naming.projectPrefix}${config.naming.separator}email-processor-dlq-alerts${config.naming.separator}${environment}`,
      displayName: `Report Builder Email Processing Alerts (${environment})`,
      // Add encryption for sensitive notification content
      masterKey: undefined, // Use default AWS managed key
    });

    // Get alert notification email address from Parameter Store
    const alertEmailParam = ssm.StringParameter.fromStringParameterName(
      this,
      'AlertEmailParameter',
      `/${config.naming.projectPrefix}/${environment}/email/alert-notifications`
    );

    // Add email subscription to SNS topic for DLQ alerts
    this.dlqAlertTopic.addSubscription(
      new snsSubscriptions.EmailSubscription(alertEmailParam.stringValue, {
        json: false, // Send plain text notifications for better readability
      })
    );

    // CloudWatch alarm for DLQ messages - alerts when emails fail processing
    this.dlqAlarm = new cloudwatch.Alarm(this, 'EmailProcessorDLQAlarm', {
      alarmName: `${config.naming.projectPrefix}${config.naming.separator}email-processor-dlq-alarm${config.naming.separator}${environment}`,
      alarmDescription: 'Alert when emails fail processing and are sent to DLQ',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfVisibleMessages',
        dimensionsMap: {
          QueueName: this.emailProcessorDLQ.queueName,
        },
        period: cdk.Duration.minutes(5),
      }),
      // Alert immediately when any message appears in DLQ
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Connect the alarm to SNS topic for notifications
    this.dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.dlqAlertTopic));
    this.dlqAlarm.addOkAction(new cloudwatchActions.SnsAction(this.dlqAlertTopic));

    // ===================================================================
    // LAMBDA FUNCTION CONFIGURATION
    // ===================================================================
    
    // Email Processor Lambda Function - processes incoming emails and extracts attachments
    this.emailProcessorLambda = new lambdaNodejs.NodejsFunction(this, 'EmailProcessorLambda', {
      functionName: `${config.naming.projectPrefix}${config.naming.separator}email-processor${config.naming.separator}${environment}`,
      description: 'Processes incoming emails and extracts attachments for the Report Builder',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '..', '..', '..', 'src', 'lambda', 'email-processor.ts'),
      handler: 'handler',
      role: this.emailProcessorRole,
      timeout: cdk.Duration.minutes(config.lambda.emailProcessor.timeoutMinutes),
      memorySize: config.lambda.emailProcessor.memoryMB,
      projectRoot: path.join(__dirname, '..', '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', '..', 'package-lock.json'),
      bundling: {
        nodeModules: ['mailparser'],
        externalModules: ['@aws-sdk/*'],
        format: lambdaNodejs.OutputFormat.ESM,
        target: 'es2022',
        sourceMap: true,
      },
      environment: {
        NODE_ENV: environment,
        INCOMING_FILES_BUCKET: incomingFilesBucket.bucketName,
        PROCESSED_FILES_BUCKET: processedFilesBucket.bucketName,
        MAPPING_FILES_BUCKET: mappingFilesBucket.bucketName,
        PARAMETER_STORE_CACHE_TTL_SECONDS: config.application.parameterStore.cacheTTLSeconds.toString(),
      },
      // Enable Lambda insights based on monitoring configuration
      insightsVersion: config.monitoring.lambdaInsights ? lambda.LambdaInsightsVersion.VERSION_1_0_229_0 : undefined,
      // Configure Dead Letter Queue for failed asynchronous invocations
      deadLetterQueue: this.emailProcessorDLQ,
      // Configure retry behavior for failed invocations
      retryAttempts: 2, // AWS Lambda default (total of 3 attempts: initial + 2 retries)
    });

    // ===================================================================
    // FILE PROCESSING LAMBDA FUNCTION
    // ===================================================================
    
    // File Processor Lambda Function - processes and transforms uploaded files
    this.fileProcessorLambda = new lambdaNodejs.NodejsFunction(this, 'FileProcessorLambda', {
      functionName: `${config.naming.projectPrefix}${config.naming.separator}file-processor${config.naming.separator}${environment}`,
      description: 'Processes and transforms files for the Report Builder application',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '..', '..', '..', 'src', 'lambda', 'file-processor.ts'),
      handler: 'handler',
      role: this.fileProcessorRole,
      timeout: cdk.Duration.minutes(config.lambda.fileProcessor.timeoutMinutes),
      memorySize: config.lambda.fileProcessor.memoryMB,
      projectRoot: path.join(__dirname, '..', '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', '..', 'package-lock.json'),
      bundling: {
        nodeModules: ['exceljs', 'pdf-parse'],
        externalModules: ['@aws-sdk/*'],
        format: lambdaNodejs.OutputFormat.ESM,
        target: 'es2022',
        sourceMap: true,
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [
              // Create the test directory structure that pdf-parse expects
              `mkdir -p ${outputDir}/test/data`,
              // Copy the test file that pdf-parse needs during initialization
              `cp ${inputDir}/test/data/05-versions-space.pdf ${outputDir}/test/data/05-versions-space.pdf`,
            ];
          },
          beforeInstall(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
        },
      },
      environment: {
        NODE_ENV: environment,
        INCOMING_FILES_BUCKET: incomingFilesBucket.bucketName,
        PROCESSED_FILES_BUCKET: processedFilesBucket.bucketName,
        MAPPING_FILES_BUCKET: mappingFilesBucket.bucketName,
        PARAMETER_STORE_CACHE_TTL_SECONDS: config.application.parameterStore.cacheTTLSeconds.toString(),
      },
      // Enable Lambda insights based on monitoring configuration
      insightsVersion: config.monitoring.lambdaInsights ? lambda.LambdaInsightsVersion.VERSION_1_0_229_0 : undefined,
    });

    // Add SES permission to invoke the email processor Lambda
    this.emailProcessorLambda.addPermission('SESInvokePermission', {
      principal: new iam.ServicePrincipal('ses.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: cdk.Stack.of(this).account,
    });

    // ===================================================================
    // CLOUDFORMATION OUTPUTS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'EmailProcessorLambdaArn', {
      value: this.emailProcessorLambda.functionArn,
      description: 'ARN of the email processor Lambda function',
      exportName: `${cdk.Stack.of(this).stackName}-EmailProcessorLambdaArn`,
    });

    new cdk.CfnOutput(this, 'FileProcessorLambdaArn', {
      value: this.fileProcessorLambda.functionArn,
      description: 'ARN of the file processor Lambda function',
      exportName: `${cdk.Stack.of(this).stackName}-FileProcessorLambdaArn`,
    });

    new cdk.CfnOutput(this, 'EmailProcessorDLQArn', {
      value: this.emailProcessorDLQ.queueArn,
      description: 'ARN of the email processor Dead Letter Queue',
      exportName: `${cdk.Stack.of(this).stackName}-EmailProcessorDLQArn`,
    });

    new cdk.CfnOutput(this, 'EmailProcessorDLQUrl', {
      value: this.emailProcessorDLQ.queueUrl,
      description: 'URL of the email processor Dead Letter Queue',
      exportName: `${cdk.Stack.of(this).stackName}-EmailProcessorDLQUrl`,
    });

    new cdk.CfnOutput(this, 'EmailProcessorDLQAlarmArn', {
      value: this.dlqAlarm.alarmArn,
      description: 'ARN of the CloudWatch alarm for DLQ messages',
    });

    new cdk.CfnOutput(this, 'EmailProcessorDLQAlertTopicArn', {
      value: this.dlqAlertTopic.topicArn,
      description: 'ARN of the SNS topic for DLQ alert notifications',
      exportName: `${cdk.Stack.of(this).stackName}-EmailProcessorDLQAlertTopicArn`,
    });

    new cdk.CfnOutput(this, 'EmailProcessorDLQAlertTopicName', {
      value: this.dlqAlertTopic.topicName,
      description: 'Name of the SNS topic for DLQ alert notifications',
    });

    new cdk.CfnOutput(this, 'EmailProcessorRoleArn', {
      value: this.emailProcessorRole.roleArn,
      description: 'ARN of the email processor IAM role',
    });

    new cdk.CfnOutput(this, 'FileProcessorRoleArn', {
      value: this.fileProcessorRole.roleArn,
      description: 'ARN of the file processor IAM role',
    });
  }

  /**
   * Get Lambda function names for use by other constructs
   * 
   * @returns Object with Lambda function names
   */
  public getFunctionNames() {
    return {
      emailProcessor: this.emailProcessorLambda.functionName,
      fileProcessor: this.fileProcessorLambda.functionName,
    };
  }

  /**
   * Get Lambda function ARNs for use by other constructs
   * 
   * @returns Object with Lambda function ARNs
   */
  public getFunctionArns() {
    return {
      emailProcessor: this.emailProcessorLambda.functionArn,
      fileProcessor: this.fileProcessorLambda.functionArn,
    };
  }

  /**
   * Add environment variables to both Lambda functions
   * 
   * @param variables - Object with environment variables to add
   */
  public addEnvironmentVariables(variables: Record<string, string>) {
    Object.entries(variables).forEach(([key, value]) => {
      this.emailProcessorLambda.addEnvironment(key, value);
      this.fileProcessorLambda.addEnvironment(key, value);
    });
  }
} 