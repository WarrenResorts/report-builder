#!/usr/bin/env ts-node

/**
 * Configuration Demonstration Script
 * 
 * This script demonstrates the environment-specific configuration system
 * and shows the differences between development and production settings.
 */

import { ConfigLoader, Environment } from '../config';

/**
 * Display configuration for a specific environment
 */
function displayEnvironmentConfig(environment: Environment): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 ${environment.toUpperCase()} ENVIRONMENT CONFIGURATION`);
  console.log(`${'='.repeat(60)}`);

  try {
    const configLoader = ConfigLoader.getInstance();
    const config = configLoader.getConfig(environment);

    console.log('\n🏷️  **Resource Naming:**');
    console.log(`   Project Prefix: ${config.naming.projectPrefix}`);
    console.log(`   Separator: "${config.naming.separator}"`);
    console.log(`   Example Bucket: ${config.naming.projectPrefix}${config.naming.separator}incoming-files${config.naming.separator}${environment}`);

    console.log('\n🌐 **Domain Configuration:**');
    console.log(`   Domain: ${config.domain.domainName}`);
    console.log(`   Email: ${config.domain.emailAddress}`);

    console.log('\n⚡ **Lambda Configuration:**');
    console.log(`   Email Processor: ${config.lambda.emailProcessor.memoryMB}MB, ${config.lambda.emailProcessor.timeoutMinutes}min`);
    console.log(`   File Processor: ${config.lambda.fileProcessor.memoryMB}MB, ${config.lambda.fileProcessor.timeoutMinutes}min`);
    console.log(`   Lambda Insights: ${config.monitoring.lambdaInsights ? 'Enabled' : 'Disabled'}`);

    console.log('\n📦 **Storage Lifecycle (days):**');
    console.log(`   Incoming Files: IA after ${config.storage.incomingFiles.transitionToIADays}, Glacier after ${config.storage.incomingFiles.transitionToGlacierDays}`);
    console.log(`   Processed Files: IA after ${config.storage.processedFiles.transitionToIADays}, Glacier after ${config.storage.processedFiles.transitionToGlacierDays}`);
    console.log(`   Mapping Files: IA after ${config.storage.mappingFiles.transitionToIADays}`);

    console.log('\n⏰ **Scheduling:**');
    console.log(`   Daily Processing: ${config.scheduling.dailyProcessing.cronExpression}`);
    console.log(`   - ${config.scheduling.dailyProcessing.description}`);
    console.log(`   Weekly Reporting: ${config.scheduling.weeklyReporting.cronExpression}`);
    console.log(`   - ${config.scheduling.weeklyReporting.description}`);
    console.log(`   Event Retention: ${config.scheduling.eventRetention.maxEventAgeHours}h, ${config.scheduling.eventRetention.retryAttempts} retries`);

    console.log('\n🏷️  **Required Tags:**');
    Object.entries(config.tagging.required).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });

    console.log('\n🏷️  **Environment-Specific Tags:**');
    Object.entries(config.tagging.environmentSpecific).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });

    console.log('\n📊 **Monitoring:**');
    console.log(`   Enhanced Monitoring: ${config.monitoring.enhancedMonitoring ? 'Enabled' : 'Disabled'}`);
    console.log(`   Log Retention: ${config.monitoring.logRetentionDays} days`);

    // Validate configuration
    const validation = configLoader.validateConfig(config);
    console.log(`\n✅ **Validation Status:** ${validation.isValid ? 'VALID' : 'INVALID'}`);
    
    if (validation.warnings.length > 0) {
      console.log('\n⚠️  **Warnings:**');
      validation.warnings.forEach(warning => console.log(`   - ${warning}`));
    }

    if (!validation.isValid) {
      console.log('\n❌ **Errors:**');
      validation.errors.forEach(error => console.log(`   - ${error}`));
    }

  } catch (error) {
    console.error(`\n❌ Failed to load ${environment} configuration:`, error);
  }
}

/**
 * Compare configurations between environments
 */
function compareConfigurations(): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔄 CONFIGURATION COMPARISON`);
  console.log(`${'='.repeat(60)}`);

  try {
    const configLoader = ConfigLoader.getInstance();
    const devConfig = configLoader.getConfig('development');
    const prodConfig = configLoader.getConfig('production');

    console.log('\n📈 **Key Differences:**');
    
    // Lambda comparison
    console.log(`\n⚡ **Lambda Resources:**`);
    console.log(`   Email Processor Memory: Dev ${devConfig.lambda.emailProcessor.memoryMB}MB → Prod ${prodConfig.lambda.emailProcessor.memoryMB}MB`);
    console.log(`   File Processor Memory: Dev ${devConfig.lambda.fileProcessor.memoryMB}MB → Prod ${prodConfig.lambda.fileProcessor.memoryMB}MB`);
    console.log(`   Email Processor Timeout: Dev ${devConfig.lambda.emailProcessor.timeoutMinutes}min → Prod ${prodConfig.lambda.emailProcessor.timeoutMinutes}min`);

    // Storage comparison
    console.log(`\n📦 **Storage Lifecycle:**`);
    console.log(`   Incoming Files IA: Dev ${devConfig.storage.incomingFiles.transitionToIADays}d → Prod ${prodConfig.storage.incomingFiles.transitionToIADays}d`);
    console.log(`   Incoming Files Glacier: Dev ${devConfig.storage.incomingFiles.transitionToGlacierDays}d → Prod ${prodConfig.storage.incomingFiles.transitionToGlacierDays}d`);

    // Scheduling comparison
    console.log(`\n⏰ **Scheduling:**`);
    console.log(`   Daily Processing: Dev "${devConfig.scheduling.dailyProcessing.cronExpression}" → Prod "${prodConfig.scheduling.dailyProcessing.cronExpression}"`);
    console.log(`   Event Retention: Dev ${devConfig.scheduling.eventRetention.maxEventAgeHours}h → Prod ${prodConfig.scheduling.eventRetention.maxEventAgeHours}h`);

    // Monitoring comparison
    console.log(`\n📊 **Monitoring:**`);
    console.log(`   Lambda Insights: Dev ${devConfig.monitoring.lambdaInsights} → Prod ${prodConfig.monitoring.lambdaInsights}`);
    console.log(`   Log Retention: Dev ${devConfig.monitoring.logRetentionDays}d → Prod ${prodConfig.monitoring.logRetentionDays}d`);

  } catch (error) {
    console.error('\n❌ Failed to compare configurations:', error);
  }
}

/**
 * Show deployment commands for different environments
 */
function showDeploymentCommands(): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 DEPLOYMENT COMMANDS`);
  console.log(`${'='.repeat(60)}`);

  console.log('\n📝 **CDK Commands with Environment Context:**');
  console.log('\n   🔧 **Development Environment:**');
  console.log('   ```bash');
  console.log('   # Synthesize CloudFormation template');
  console.log('   npx cdk synth --context environment=development');
  console.log('');
  console.log('   # Deploy to development');
  console.log('   npx cdk deploy --context environment=development');
  console.log('');
  console.log('   # Destroy development stack');
  console.log('   npx cdk destroy --context environment=development');
  console.log('   ```');

  console.log('\n   🏭 **Production Environment:**');
  console.log('   ```bash');
  console.log('   # Synthesize CloudFormation template');
  console.log('   npx cdk synth --context environment=production');
  console.log('');
  console.log('   # Deploy to production (with approval)');
  console.log('   npx cdk deploy --context environment=production --require-approval never');
  console.log('');
  console.log('   # Destroy production stack');
  console.log('   npx cdk destroy --context environment=production');
  console.log('   ```');

  console.log('\n💡 **Configuration Updates:**');
  console.log('   - Edit `infrastructure/config/environments/development.json` for dev settings');
  console.log('   - Edit `infrastructure/config/environments/production.json` for prod settings');
  console.log('   - Changes take effect on next `cdk deploy`');
}

/**
 * Main execution
 */
function main(): void {
  console.log('🎛️  Report Builder - Environment Configuration Demo');
  
  // Display both environments
  displayEnvironmentConfig('development');
  displayEnvironmentConfig('production');
  
  // Compare them
  compareConfigurations();
  
  // Show deployment commands
  showDeploymentCommands();

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Configuration demo completed successfully!');
  console.log(`${'='.repeat(60)}\n`);
}

// Run the demo
if (require.main === module) {
  main();
} 