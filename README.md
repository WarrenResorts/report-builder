# Report Builder

Automated file processing system that receives files via email, processes them through Excel mapping, and sends transformed results via email.

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

### Branch Strategy
- **main**: Production environment
- **feature branches**: Development work
- **PRs**: Automatically deploy to development environment

### CI/CD Pipeline
1. **Create PR** → Deploys to development environment
2. **Test in development** → Validate functionality
3. **Merge to main** → Deploys to production + creates release

### Getting Started
```bash
npm install
npm run lint           # Run linting
npm run test:run       # Run tests once
npm test              # Run tests in watch mode
npm run test:coverage # Run tests with coverage
npm run build         # Build application
```

## 📋 Project Plan
See [PROJECT_PLAN.md](./PROJECT_PLAN.md) for detailed implementation roadmap.