import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface InfrastructureStackProps extends cdk.StackProps {
  environment: 'development' | 'production';
}

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // S3 Buckets for file storage
    const incomingFilesBucket = new s3.Bucket(this, 'IncomingFilesBucket', {
      bucketName: `report-builder-incoming-files-${environment}`,
      removalPolicy: environment === 'development' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: environment === 'development',
      // No lifecycle rules - preserve source data indefinitely
    });

    const processedFilesBucket = new s3.Bucket(this, 'ProcessedFilesBucket', {
      bucketName: `report-builder-processed-files-${environment}`,
      removalPolicy: environment === 'development' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: environment === 'development',
      lifecycleRules: [{
        id: 'DeleteProcessedFiles',
        expiration: cdk.Duration.days(7), // Quick cleanup since files can be regenerated
      }],
    });

    // SES Configuration for email handling
    // Note: Domain verification must be done manually in AWS Console first
    const sesConfigurationSet = new ses.ConfigurationSet(this, 'SESConfigurationSet', {
      configurationSetName: `report-builder-${environment}`,
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
      },
    });

    // Placeholder Lambda function for email processing
    const emailProcessorLambda = new lambda.Function(this, 'EmailProcessorLambda', {
      functionName: `report-builder-email-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Email processor triggered:', JSON.stringify(event, null, 2));
          return { statusCode: 200, body: 'Email processed successfully' };
        };
      `),
      role: lambdaExecutionRole,
      environment: {
        ENVIRONMENT: environment,
        INCOMING_BUCKET: incomingFilesBucket.bucketName,
        PROCESSED_BUCKET: processedFilesBucket.bucketName,
        MAPPING_PREFIX: 'mapping-files/', // Mapping files stored in incoming bucket with prefix
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Placeholder Lambda function for file processing
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
        MAPPING_PREFIX: 'mapping-files/', // Mapping files stored in incoming bucket with prefix
      },
      timeout: cdk.Duration.minutes(15), // File processing might take longer
    });

    // CloudFormation outputs for reference
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
  }
}
