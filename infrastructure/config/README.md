# Environment-Specific Configuration System

This directory contains the environment-specific configuration system for the Report Builder infrastructure. It provides a centralized, type-safe way to manage different settings for development and production environments.

## 📁 Directory Structure

```
infrastructure/config/
├── README.md                    # This documentation
├── index.ts                     # Main exports
├── types.ts                     # TypeScript interfaces
├── loader.ts                    # Configuration loader with validation
├── environments/                # Environment-specific config files
│   ├── development.json        # Development environment settings
│   └── production.json         # Production environment settings
└── scripts/
    └── show-config.ts          # Demo script showing configuration differences
```

## 🎯 Features

- **Type-Safe Configuration**: Full TypeScript support with comprehensive interfaces
- **Environment Validation**: Automatic validation of configuration values
- **Centralized Management**: All environment settings in JSON files
- **Flexible Resource Naming**: Configurable naming conventions for all AWS resources
- **Lifecycle Management**: Environment-specific S3 lifecycle policies
- **Scheduling Configuration**: Different cron schedules for dev/prod
- **Monitoring Settings**: Environment-appropriate monitoring levels
- **Tagging Strategy**: Automated resource tagging with environment-specific tags

## 🚀 Quick Start

### 1. Using in CDK Infrastructure

```typescript
import { ConfigLoader } from '../config';

// In your CDK stack
const configLoader = ConfigLoader.getInstance();
const config = configLoader.getConfig('development'); // or 'production'

// Use configuration values
const bucket = new s3.Bucket(this, 'MyBucket', {
  bucketName: `${config.naming.projectPrefix}-my-bucket-${config.environment}`,
  lifecycleRules: [{
    transitions: [{
      storageClass: s3.StorageClass.INFREQUENT_ACCESS,
      transitionAfter: cdk.Duration.days(config.storage.incomingFiles.transitionToIADays),
    }]
  }]
});
```

### 2. Viewing Configuration

```bash
# Show configuration for both environments
cd infrastructure
npx ts-node scripts/show-config.ts

# Or run with npm script (if added to package.json)
npm run show-config
```

### 3. Deploying to Different Environments

```bash
# Development deployment
npx cdk deploy --context environment=development

# Production deployment  
npx cdk deploy --context environment=production
```

## ⚙️ Configuration Reference

### Environment Files

#### `environments/development.json`
- **Lambda**: Lower memory allocation, shorter timeouts
- **Storage**: Faster transitions to save costs
- **Scheduling**: More frequent processing for testing
- **Monitoring**: Basic monitoring, shorter log retention
- **Tags**: Development-specific tags (AutoShutdown, etc.)

#### `environments/production.json`
- **Lambda**: Higher memory allocation, longer timeouts
- **Storage**: Conservative transitions for data retention
- **Scheduling**: Standard business schedules
- **Monitoring**: Enhanced monitoring, longer log retention
- **Tags**: Production-specific tags (Backup, Compliance, etc.)

### Configuration Sections

#### 🏷️ **Naming Configuration**
```json
{
  "naming": {
    "projectPrefix": "report-builder",
    "separator": "-"
  }
}
```
Controls how all AWS resources are named. Results in names like:
- `report-builder-incoming-files-development`
- `report-builder-email-processor-production`

#### 🌐 **Domain Configuration**
```json
{
  "domain": {
    "domainName": "aws.example.com",
    "emailAddress": "test@example.com"
  }
}
```

#### ⚡ **Lambda Configuration**
```json
{
  "lambda": {
    "emailProcessor": {
      "timeoutMinutes": 3,    // Dev: 3min, Prod: 5min
      "memoryMB": 384         // Dev: 384MB, Prod: 512MB
    },
    "fileProcessor": {
      "timeoutMinutes": 8,    // Dev: 8min, Prod: 10min
      "memoryMB": 768         // Dev: 768MB, Prod: 1024MB
    }
  }
}
```

#### 📦 **Storage Configuration**
```json
{
  "storage": {
    "incomingFiles": {
      "transitionToIADays": 7,      // Dev: 7d, Prod: 30d
      "transitionToGlacierDays": 30 // Dev: 30d, Prod: 90d
    }
  }
}
```

#### ⏰ **Scheduling Configuration**
```json
{
  "scheduling": {
    "dailyProcessing": {
      "cronExpression": "cron(0 */6 * * ? *)",           // Dev: every 6h
      "description": "Every 6 hours for development testing"
    },
    "eventRetention": {
      "maxEventAgeHours": 12,  // Dev: 12h, Prod: 24h
      "retryAttempts": 2       // Dev: 2, Prod: 3
    }
  }
}
```

#### 🏷️ **Tagging Configuration**
```json
{
  "tagging": {
    "required": {
      "Project": "ReportBuilder",
      "Environment": "development",
      "ManagedBy": "CDK",
      "CostCenter": "IT-DataProcessing"
    },
    "environmentSpecific": {
      "AutoShutdown": "Enabled",    // Development only
      "Backup": "Required"          // Production only
    }
  }
}
```

#### 📊 **Monitoring Configuration**
```json
{
  "monitoring": {
    "enhancedMonitoring": false,  // Dev: false, Prod: true
    "lambdaInsights": false,      // Dev: false, Prod: true
    "logRetentionDays": 14        // Dev: 14d, Prod: 90d
  }
}
```

## 🔧 Customization

### Adding New Configuration Values

1. **Update Type Definitions** (`types.ts`):
```typescript
export interface LambdaConfig {
  emailProcessor: {
    timeoutMinutes: number;
    memoryMB: number;
    reservedConcurrency?: number; // New field
  };
}
```

2. **Update Environment Files**:
```json
{
  "lambda": {
    "emailProcessor": {
      "timeoutMinutes": 5,
      "memoryMB": 512,
      "reservedConcurrency": 10
    }
  }
}
```

3. **Update Validation** (`loader.ts`):
```typescript
if (config.lambda?.emailProcessor?.reservedConcurrency < 0) {
  errors.push('Reserved concurrency must be non-negative');
}
```

### Adding New Environments

1. Create new environment file: `environments/staging.json`
2. Update the `Environment` type in `types.ts`:
```typescript
export type Environment = 'development' | 'staging' | 'production';
```

3. Update the loader's environment list in `loader.ts`:
```typescript
const environments: Environment[] = ['development', 'staging', 'production'];
```

## 🧪 Validation

The configuration loader includes comprehensive validation:

- **Required Fields**: Ensures all mandatory configuration is present
- **Type Checking**: Validates data types and ranges
- **Format Validation**: Checks email addresses, domain names, cron expressions
- **Logic Validation**: Ensures lifecycle transitions are logical
- **Environment-Specific Warnings**: Alerts for potential production issues

### Running Validation

```typescript
const configLoader = ConfigLoader.getInstance();
const validation = configLoader.validateConfig(config);

if (!validation.isValid) {
  console.error('Configuration errors:', validation.errors);
}

if (validation.warnings.length > 0) {
  console.warn('Configuration warnings:', validation.warnings);
}
```

## 🏗️ Architecture Benefits

### Before (Hard-coded)
- ❌ Values scattered across multiple files
- ❌ No type safety
- ❌ Difficult to compare environments
- ❌ Manual synchronization required
- ❌ No validation

### After (Environment-Specific)
- ✅ Centralized configuration management
- ✅ Full TypeScript type safety
- ✅ Easy environment comparisons
- ✅ Automatic validation
- ✅ Single source of truth
- ✅ Flexible and extensible

## 🔍 Troubleshooting

### Configuration Not Found
```
Error: Configuration not found for environment: development
```
**Solution**: Ensure `environments/development.json` exists and is valid JSON.

### Validation Errors
```
Error: Invalid configuration for production: Email processor timeout must be positive
```
**Solution**: Check the configuration values in the environment file match the expected types and ranges.

### CDK Context Issues
```
Error: Cannot determine stack environment
```
**Solution**: Always specify the environment context:
```bash
npx cdk deploy --context environment=development
```

## 📚 Related Documentation

- [CDK Best Practices](../README.md)
- [Infrastructure Overview](../lib/README.md)
- [Deployment Guide](../../README.md)

## 🤝 Contributing

When adding new configuration options:

1. **Add types first** - Update the TypeScript interfaces
2. **Add validation** - Include appropriate validation rules
3. **Update both environments** - Ensure both dev and prod configs are updated
4. **Test thoroughly** - Validate with both environments
5. **Document changes** - Update this README and inline comments 