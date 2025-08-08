import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { EnvironmentConfig } from '../../config';

/**
 * Props for the Events construct
 */
export interface EventsConstructProps {
  /** Deployment environment (development/production) */
  environment: 'development' | 'production';
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** Lambda function for file processing */
  fileProcessorLambda: lambda.Function;
}

/**
 * EventBridge and scheduling resources for the Report Builder application
 * 
 * This construct creates and configures EventBridge rules for automated processing:
 * - Scheduled rules for daily batch processing of files
 * - Parameter Store integration for dynamic configuration
 * - Environment-specific scheduling (different schedules for dev/prod)
 * - Lambda targets for automated processing workflows
 */
export class EventsConstruct extends Construct {
  /** EventBridge rule for daily file processing */
  public readonly dailyProcessingRule: events.Rule;
  
  /** EventBridge rule for weekly report generation */
  public readonly weeklyReportRule: events.Rule;

  constructor(scope: Construct, id: string, props: EventsConstructProps) {
    super(scope, id);

    const { environment, config, fileProcessorLambda } = props;

    // ===================================================================
    // PARAMETER STORE CONFIGURATION
    // ===================================================================
    
    // Store scheduling configuration in Parameter Store for dynamic updates
    // Scheduling parameters are NOT sensitive, so we use StringParameter (unencrypted)
    const batchProcessingSchedule = new ssm.StringParameter(this, 'BatchProcessingSchedule', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/scheduling/batch-processing-cron`,
      stringValue: config.scheduling.dailyProcessing.cronExpression,
      description: config.scheduling.dailyProcessing.description,
      // Unencrypted for scheduling data - not sensitive
    });

    const weeklyReportSchedule = new ssm.StringParameter(this, 'WeeklyReportSchedule', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/scheduling/weekly-report-cron`,
      stringValue: config.scheduling.weeklyReporting.cronExpression,
      description: config.scheduling.weeklyReporting.description,
      // Unencrypted for scheduling data - not sensitive
    });

    // ===================================================================
    // PARAMETER STORE CONFIGURATION (TEMPORARILY AS STRING)
    // ===================================================================
    
    // Create configuration parameters as regular strings for initial deployment
    // These will be manually converted to SecureString parameters after deployment
    // This approach avoids CloudFormation validation issues with SecureString during stack creation
    
    // Email recipients configuration (will be encrypted post-deployment)
    const emailRecipientsParam = new ssm.StringParameter(this, 'EmailRecipientsParameter', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/email/recipients`,
      stringValue: 'example@domain.com', // Default placeholder - to be updated and encrypted manually
      description: 'Comma-separated list of email recipients for reports (convert to SecureString post-deployment)',
    });

    // Alert notification email (will be encrypted post-deployment)
    const alertEmailParam = new ssm.StringParameter(this, 'AlertEmailParameter', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/email/alert-notifications`,
      stringValue: `alerts@${config.domain.domainName}`, // Default based on domain
      description: 'Email address for system alerts and notifications (convert to SecureString post-deployment)',
    });

    // From email address (will be encrypted post-deployment)
    const fromEmailParam = new ssm.StringParameter(this, 'FromEmailParameter', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/email/from-address`,
      stringValue: config.domain.emailAddress, // Use configured email address
      description: 'From email address for outbound reports (convert to SecureString post-deployment)',
    });

    // Property mapping configuration (will be encrypted post-deployment)
    const propertyMappingParam = new ssm.StringParameter(this, 'PropertyMappingParameter', {
      parameterName: `/${config.naming.projectPrefix}/${environment}/config/property-mapping`,
      stringValue: '{}', // Default empty JSON object - to be populated and encrypted manually
      description: 'JSON configuration mapping sender emails to property IDs (convert to SecureString post-deployment)',
    });

    // ===================================================================
    // EVENTBRIDGE SCHEDULED RULE
    // ===================================================================
    
    // Daily file processing rule - triggers batch processing of accumulated files
    this.dailyProcessingRule = new events.Rule(this, 'DailyFileProcessingRule', {
      ruleName: `${config.naming.projectPrefix}${config.naming.separator}daily-processing${config.naming.separator}${environment}`,
      description: config.scheduling.dailyProcessing.description,
      // Schedule based on configuration
      schedule: events.Schedule.expression(config.scheduling.dailyProcessing.cronExpression),
      enabled: true,
    });

    // Add file processor Lambda as target for daily processing
    this.dailyProcessingRule.addTarget(
      new eventsTargets.LambdaFunction(fileProcessorLambda, {
        event: events.RuleTargetInput.fromObject({
          source: 'eventbridge.scheduled',
          'detail-type': 'Daily File Processing',
          detail: {
            processingType: 'daily-batch',
            environment: environment,
            timestamp: events.EventField.time,
            scheduleExpression: config.scheduling.dailyProcessing.cronExpression,
          },
        }),
        // Add retry configuration for failed invocations
        retryAttempts: config.scheduling.eventRetention.retryAttempts,
        maxEventAge: cdk.Duration.hours(config.scheduling.eventRetention.maxEventAgeHours),
        // Add dead letter queue for failed events (could be added later)
      })
    );

    // Weekly report generation rule - generates summary reports
    this.weeklyReportRule = new events.Rule(this, 'WeeklyReportRule', {
      ruleName: `${config.naming.projectPrefix}${config.naming.separator}weekly-report${config.naming.separator}${environment}`,
      description: config.scheduling.weeklyReporting.description,
      schedule: events.Schedule.expression(config.scheduling.weeklyReporting.cronExpression),
      enabled: true,
    });

    // Add file processor Lambda as target for weekly reporting
    this.weeklyReportRule.addTarget(
      new eventsTargets.LambdaFunction(fileProcessorLambda, {
        event: events.RuleTargetInput.fromObject({
          source: 'eventbridge.scheduled',
          'detail-type': 'Weekly Report Generation',
          detail: {
            processingType: 'weekly-report',
            environment: environment,
            timestamp: events.EventField.time,
            scheduleExpression: config.scheduling.weeklyReporting.cronExpression,
          },
        }),
        retryAttempts: config.scheduling.eventRetention.retryAttempts,
        maxEventAge: cdk.Duration.hours(config.scheduling.eventRetention.maxEventAgeHours),
      })
    );

    // ===================================================================
    // CLOUDFORMATION OUTPUTS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'DailyProcessingRuleArn', {
      value: this.dailyProcessingRule.ruleArn,
      description: 'ARN of the daily file processing EventBridge rule',
      exportName: `${cdk.Stack.of(this).stackName}-DailyProcessingRule`,
    });

    new cdk.CfnOutput(this, 'WeeklyReportRuleArn', {
      value: this.weeklyReportRule.ruleArn,
      description: 'ARN of the weekly report generation EventBridge rule',
      exportName: `${cdk.Stack.of(this).stackName}-WeeklyReportRule`,
    });

    new cdk.CfnOutput(this, 'BatchProcessingScheduleValue', {
      value: batchProcessingSchedule.stringValue,
      description: 'Cron expression for batch processing schedule',
    });

    new cdk.CfnOutput(this, 'WeeklyReportScheduleValue', {
      value: weeklyReportSchedule.stringValue,
      description: 'Cron expression for weekly report schedule',
    });

    // ===================================================================
    // PARAMETER STORE OUTPUTS
    // ===================================================================
    
    new cdk.CfnOutput(this, 'SchedulingParametersInfo', {
      value: [
        'SCHEDULING CONFIGURATION (Unencrypted):',
        `Daily Processing: ${batchProcessingSchedule.parameterName}`,
        `Weekly Reports: ${weeklyReportSchedule.parameterName}`,
        '',
        'To update schedules:',
        `aws ssm put-parameter --name "${batchProcessingSchedule.parameterName}" --value "cron(0 7 * * ? *)" --overwrite`,
        `aws ssm put-parameter --name "${weeklyReportSchedule.parameterName}" --value "cron(0 9 ? * MON *)" --overwrite`,
      ].join('\\n'),
      description: 'Information about scheduling parameters and how to update them',
    });

    new cdk.CfnOutput(this, 'ConfigurationParametersInfo', {
      value: [
        'CONFIGURATION PARAMETERS (Created as String, convert to SecureString for production):',
        `Email Recipients: ${emailRecipientsParam.parameterName}`,
        `Alert Email: ${alertEmailParam.parameterName}`,
        `From Email: ${fromEmailParam.parameterName}`,
        `Property Mapping: ${propertyMappingParam.parameterName}`,
        '',
        'IMPORTANT - For production security, convert to SecureString and update values:',
        `aws ssm put-parameter --name "${emailRecipientsParam.parameterName}" --value "user1@domain.com,user2@domain.com" --type "SecureString" --overwrite`,
        `aws ssm put-parameter --name "${alertEmailParam.parameterName}" --value "alerts@yourdomain.com" --type "SecureString" --overwrite`,
        `aws ssm put-parameter --name "${fromEmailParam.parameterName}" --value "reports@yourdomain.com" --type "SecureString" --overwrite`,
        `aws ssm put-parameter --name "${propertyMappingParam.parameterName}" --value "{\\"sender@property1.com\\":\\"PROP001\\"}" --type "SecureString" --overwrite`,
        '',
        'NOTE: After converting to SecureString, update Lambda IAM roles to include KMS permissions for decryption.',
      ].join('\\n'),
      description: 'Information about configuration parameters and how to secure them for production',
    });
  }

  /**
   * Get EventBridge rule names for monitoring and management
   * 
   * @returns Object with rule names
   */
  public getRuleNames() {
    return {
      dailyProcessing: this.dailyProcessingRule.ruleName,
      weeklyReport: this.weeklyReportRule.ruleName,
    };
  }

  /**
   * Get EventBridge rule ARNs for cross-stack references
   * 
   * @returns Object with rule ARNs
   */
  public getRuleArns() {
    return {
      dailyProcessing: this.dailyProcessingRule.ruleArn,
      weeklyReport: this.weeklyReportRule.ruleArn,
    };
  }

  /**
   * Enable or disable the scheduled rules
   * 
   * @param enabled - Whether to enable the rules
   */
  public setRulesEnabled(enabled: boolean) {
    // Note: This would require a custom resource to implement
    // For now, rules are enabled by default and can be managed through AWS Console
    
    // Could be implemented with a custom resource like:
    // new cr.AwsCustomResource(this, 'ToggleRules', {
    //   onUpdate: {
    //     service: 'EventBridge',
    //     action: enabled ? 'enableRule' : 'disableRule',
    //     parameters: { Name: this.dailyProcessingRule.ruleName }
    //   }
    // });
  }

  /**
   * Add additional targets to the processing rules
   * 
   * @param target - EventBridge target to add
   * @param ruleType - Which rule to add the target to
   */
  public addTarget(target: events.IRuleTarget, ruleType: 'daily' | 'weekly') {
    if (ruleType === 'daily') {
      this.dailyProcessingRule.addTarget(target);
    } else {
      this.weeklyReportRule.addTarget(target);
    }
  }
} 