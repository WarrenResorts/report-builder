# Report Builder

Automated file processing system that receives files via email, processes them through Excel mapping, and sends transformed results via email.

## 🏗️ Architecture Overview

### Multi-Account AWS Strategy
This project uses a **multi-AWS account strategy** for true environment isolation:

- **Management Account** (316422224105): AWS Organizations management, no resources
- **Development Account** (237124340260): Development environment with `dev.example.com` subdomain  
- **Production Account** (400534944857): Production environment with `example.com` subdomain

### Email Processing Flow
1. **Email Reception**: SES receives emails at environment-specific addresses
   - Development: `dev@dev.example.com`
   - Production: `reports@example.com`
2. **Storage**: Raw emails stored in S3 incoming bucket
3. **Processing**: Lambda function extracts attachments and processes data
4. **Organization**: Files organized by property and date in processed bucket
5. **Metadata**: Email metadata stored for tracking and auditing

### Infrastructure Components
- **AWS CDK**: Infrastructure as Code
- **Amazon S3**: File storage (incoming, processed, mapping)
- **Amazon SES**: Email receiving and sending with domain verification
- **AWS Lambda**: Serverless email and file processing (Node.js 20.x)
- **Amazon EventBridge**: Scheduled batch processing
- **AWS Systems Manager**: Configuration management via Parameter Store
- **Amazon CloudWatch**: Logging and monitoring

## 🚀 Development Workflow

### Conventional Commits
This project uses conventional commits. Your commit messages must follow this format:
```
<type>(<scope>): <description>

Examples:
feat: add email processing functionality
fix: resolve file parsing issue
docs: update README with setup instructions
```

### Branch Strategy & Deployment
- **feature branches**: Development work
- **Pull Requests**: Auto-deploy to Development account for testing
- **main branch**: Protected, requires PR approval
- **Production**: Manual deployment via GitHub Actions workflow

### CI/CD Pipeline
1. **Create PR** → Auto-deploys to Development account (237124340260)
2. **Test in development** → Validate with `dev@dev.example.com`
3. **Merge to main** → Code ready for production (no auto-deploy)
4. **Manual production deploy** → Use GitHub Actions workflow dispatch to deploy to Production account (400534944857)

### Security Features
- **OIDC Authentication**: GitHub Actions uses OpenID Connect (no long-lived credentials)
- **Least Privilege IAM**: Separate roles per function with minimal permissions
- **Parameter Store**: Secure configuration management (SecureString for production)
- **Account Isolation**: Complete separation between environments

## 🛠️ Local Development

### Prerequisites
- Node.js 20.x
- npm
- AWS CLI configured
- TypeScript

### Getting Started
```bash
npm install
npm run lint           # Run linting  
npm run format:check   # Check code formatting
npm run test           # Run tests once
npm run test:watch     # Run tests in watch mode
npm run build          # Build application
```

### Testing
```bash
npm run test:all       # Run all tests (unit + integration)
npm run test:integration # Integration tests only
```

## 🚀 Deployment

### Development Environment
Automatic deployment on PR creation/updates:
- **Account**: Development (237124340260)
- **Domain**: Configured via Parameter Store
- **Email**: Configured via Parameter Store

### Production Environment
Manual deployment via GitHub Actions:
1. Go to Actions tab in GitHub
2. Select "Deploy to Production" workflow
3. Click "Run workflow" and confirm deployment

- **Account**: Production (400534944857)  
- **Domain**: Configured via Parameter Store
- **Email**: Configured via Parameter Store

**⚠️ IMPORTANT**: Parameter Store parameters must be created manually BEFORE deployment. See [PARAMETER_STORE_SETUP.md](./PARAMETER_STORE_SETUP.md) for required setup.

## 📋 Post-Deployment Setup
After infrastructure deployment, see [POST_DEPLOYMENT_STEPS.md](./POST_DEPLOYMENT_STEPS.md) for required manual configuration steps.

## 📖 Documentation
- [PROJECT_PLAN.md](./PROJECT_PLAN.md) - Detailed implementation roadmap
- [REQUIREMENTS.md](./REQUIREMENTS.md) - Project requirements and specifications  
- [docs/](./docs/) - Technical documentation and ADRs
