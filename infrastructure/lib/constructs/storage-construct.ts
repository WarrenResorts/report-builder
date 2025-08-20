import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvironmentConfig } from '../../config';

/**
 * Props for the Storage construct
 */
export interface StorageConstructProps {
  /** Deployment environment (development/production) */
  environment: 'development' | 'production';
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** SES service principal for bucket policy permissions */
  sesServicePrincipal: iam.ServicePrincipal;
}

/**
 * Storage resources for the Report Builder application
 * 
 * This construct creates and configures all S3 buckets needed for the email processing pipeline:
 * - Incoming files bucket for raw emails and extracted attachments
 * - Processed files bucket for transformed and organized data  
 * - Mapping files bucket for configuration and lookup data
 * 
 * Includes lifecycle policies for cost optimization and proper IAM permissions.
 */
export class StorageConstruct extends Construct {
  /** Bucket for incoming files (raw emails and attachments) */
  public readonly incomingFilesBucket: s3.Bucket;
  
  /** Bucket for processed files (transformed data) */
  public readonly processedFilesBucket: s3.Bucket;
  
  /** Bucket for mapping and configuration files */
  public readonly mappingFilesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);

    const { environment, config, sesServicePrincipal } = props;

    // ===================================================================
    // S3 BUCKET CREATION
    // ===================================================================
    
    // Incoming files bucket: stores raw emails and extracted attachments
    this.incomingFilesBucket = new s3.Bucket(this, 'IncomingFilesBucket', {
      bucketName: `${config.naming.projectPrefix}${config.naming.separator}incoming-files${config.naming.separator}${environment}-v2`,
      versioned: true, // Enable versioning for data protection
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Security: block all public access
      removalPolicy: environment === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'incoming-files-lifecycle',
          enabled: true,
          // Transition to Infrequent Access and Glacier based on config
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(config.storage.incomingFiles.transitionToIADays),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(config.storage.incomingFiles.transitionToGlacierDays),
            },
          ],
        },
      ],
    });

    // Processed files bucket: stores transformed and organized files
    this.processedFilesBucket = new s3.Bucket(this, 'ProcessedFilesBucket', {
      bucketName: `${config.naming.projectPrefix}${config.naming.separator}processed-files${config.naming.separator}${environment}-v2`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'processed-files-lifecycle', 
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(config.storage.processedFiles.transitionToIADays),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(config.storage.processedFiles.transitionToGlacierDays),
            },
          ],
        },
      ],
    });

    // Mapping files bucket: stores configuration and lookup data
    this.mappingFilesBucket = new s3.Bucket(this, 'MappingFilesBucket', {
      bucketName: `${config.naming.projectPrefix}${config.naming.separator}mapping-files${config.naming.separator}${environment}-v2`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'mapping-files-lifecycle',
          enabled: true,
          // Configuration files accessed less frequently
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS, 
              transitionAfter: cdk.Duration.days(config.storage.mappingFiles.transitionToIADays),
            },
          ],
        },
      ],
    });

    // ===================================================================
    // S3 BUCKET POLICY FOR SES INTEGRATION
    // ===================================================================
    
    // Add bucket policy to allow SES to store emails in the incoming files bucket
    this.incomingFilesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSESPuts',
        effect: iam.Effect.ALLOW,
        principals: [sesServicePrincipal],
        actions: ['s3:PutObject'],
        resources: [`${this.incomingFilesBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            's3:x-amz-server-side-encryption': 'AES256',
          },
        },
      })
    );

    // Allow SES to get bucket location and list bucket (required for some SES operations)
    this.incomingFilesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSESGetBucketLocation',
        effect: iam.Effect.ALLOW,
        principals: [sesServicePrincipal],
        actions: [
          's3:GetBucketLocation',
          's3:ListBucket'
        ],
        resources: [this.incomingFilesBucket.bucketArn],
      })
    );

    // ===================================================================
    // CLOUDFORMATION OUTPUTS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'IncomingFilesBucketName', {
      value: this.incomingFilesBucket.bucketName,
      description: 'S3 bucket for incoming files (raw emails and attachments)',
      exportName: `${cdk.Stack.of(this).stackName}-IncomingFilesBucket`,
    });

    new cdk.CfnOutput(this, 'ProcessedFilesBucketName', {
      value: this.processedFilesBucket.bucketName,
      description: 'S3 bucket for processed files (transformed data)',
      exportName: `${cdk.Stack.of(this).stackName}-ProcessedFilesBucket`,
    });

    new cdk.CfnOutput(this, 'MappingFilesBucketName', {
      value: this.mappingFilesBucket.bucketName,
      description: 'S3 bucket for mapping and configuration files',
      exportName: `${cdk.Stack.of(this).stackName}-MappingFilesBucket`,
    });
  }

  /**
   * Create IAM policy statements for Lambda functions to access the S3 buckets
   * 
   * @returns Array of IAM policy statements for S3 access
   */
  public createLambdaS3Permissions(): iam.PolicyStatement[] {
    return [
      // Allow read/write access to all buckets
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          this.incomingFilesBucket.bucketArn,
          `${this.incomingFilesBucket.bucketArn}/*`,
          this.processedFilesBucket.bucketArn,
          `${this.processedFilesBucket.bucketArn}/*`,
          this.mappingFilesBucket.bucketArn,
          `${this.mappingFilesBucket.bucketArn}/*`,
        ],
      }),
    ];
  }
} 