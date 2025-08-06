# GitHub Branch Protection Setup Guide

This guide provides step-by-step instructions for setting up branch protection rules and repository security configurations for the Report Builder project.

## 📋 Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Branch Protection Rules](#branch-protection-rules)
- [Required Status Checks](#required-status-checks)
- [Repository Settings](#repository-settings)
- [Environment Protection](#environment-protection)
- [Team and User Permissions](#team-and-user-permissions)
- [Automated Setup](#automated-setup)
- [Troubleshooting](#troubleshooting)

## Overview

Branch protection rules ensure code quality and prevent direct pushes to critical branches. This setup includes:

- **Main branch protection** with required reviews and status checks
- **Develop branch protection** with automated testing
- **Pull request validation** with comprehensive checks
- **Environment-specific deployment controls**
- **Automated security scanning**

## Prerequisites

### Required Permissions
- Repository admin access or organization owner permissions
- Ability to create and manage GitHub Actions workflows
- Access to repository settings and branch protection rules

### Repository Setup
1. **GitHub Actions enabled** in repository settings
2. **Secrets configured** for AWS deployment (see [Secrets Configuration](#secrets-configuration))
3. **Teams created** for code review assignments (optional)

## Branch Protection Rules

### Main Branch Protection

Navigate to **Settings > Branches > Add rule** and configure:

#### Basic Settings
- **Branch name pattern**: `main`
- **Restrict pushes that create matching branches**: ✅ Enabled

#### Pull Request Requirements
- **Require a pull request before merging**: ✅ Enabled
  - **Required number of reviewers**: `2`
  - **Dismiss stale reviews when new commits are pushed**: ✅ Enabled
  - **Require review from code owners**: ✅ Enabled (if CODEOWNERS file exists)
  - **Restrict reviews to users with write access**: ✅ Enabled

#### Status Check Requirements
- **Require status checks to pass before merging**: ✅ Enabled
- **Require branches to be up to date before merging**: ✅ Enabled
- **Required status checks**:
  - `Lint and Format`
  - `Unit Tests`
  - `Build Application`
  - `Security Scan`
  - `Code Quality`
  - `Dependency Review`

#### Additional Restrictions
- **Restrict pushes that create matching branches**: ✅ Enabled
- **Allow force pushes**: ❌ Disabled
- **Allow deletions**: ❌ Disabled
- **Do not allow bypassing the above settings**: ✅ Enabled

### Develop Branch Protection

Configure similar rules for the `develop` branch:

#### Basic Settings
- **Branch name pattern**: `develop`

#### Pull Request Requirements
- **Require a pull request before merging**: ✅ Enabled
  - **Required number of reviewers**: `1`
  - **Dismiss stale reviews when new commits are pushed**: ✅ Enabled

#### Status Check Requirements
- **Require status checks to pass before merging**: ✅ Enabled
- **Required status checks**:
  - `Lint and Format`
  - `Unit Tests`
  - `Build Application`
  - `Security Scan`

#### Additional Restrictions
- **Allow force pushes**: ❌ Disabled
- **Allow deletions**: ❌ Disabled

## Required Status Checks

### CI/CD Pipeline Checks

The following status checks are automatically run by GitHub Actions:

#### Code Quality Checks
- **Lint and Format**: ESLint and Prettier validation
- **Unit Tests**: Jest/Vitest test suite with coverage
- **Build Application**: TypeScript compilation and build verification
- **Security Scan**: npm audit and KICS security analysis

#### Pull Request Validation
- **PR Validation**: Title and description format validation
- **Code Quality**: Enhanced linting with SARIF reporting
- **Dependency Review**: Security analysis of dependency changes
- **Breaking Changes Check**: API compatibility validation
- **Performance Check**: Bundle size analysis

#### Deployment Checks
- **Pre-deployment Check**: System readiness validation
- **Integration Tests**: End-to-end testing (on main/develop only)

### Manual Override

In exceptional circumstances, repository administrators can override status check requirements:

1. Navigate to the specific pull request
2. Use "Merge without waiting for requirements" (admin only)
3. Document the reason in the merge commit message

## Repository Settings

### General Settings

Navigate to **Settings > General**:

#### Features
- **Wikis**: ❌ Disabled (use docs/ instead)
- **Issues**: ✅ Enabled
- **Sponsorships**: ❌ Disabled
- **Projects**: ✅ Enabled
- **Preserve this repository**: ✅ Enabled

#### Pull Requests
- **Allow merge commits**: ✅ Enabled
- **Allow squash merging**: ✅ Enabled (default)
- **Allow rebase merging**: ❌ Disabled
- **Always suggest updating pull request branches**: ✅ Enabled
- **Allow auto-merge**: ✅ Enabled
- **Automatically delete head branches**: ✅ Enabled

#### Archives
- **Include Git LFS objects in archives**: ✅ Enabled

### Security Settings

Navigate to **Settings > Security & analysis**:

#### Security Features
- **Dependency graph**: ✅ Enabled
- **Dependabot alerts**: ✅ Enabled
- **Dependabot security updates**: ✅ Enabled
- **Dependabot version updates**: ✅ Enabled (create dependabot.yml)
- **Code scanning alerts**: ✅ Enabled
- **Secret scanning alerts**: ✅ Enabled
- **Secret scanning push protection**: ✅ Enabled

#### Private Vulnerability Reporting
- **Enable**: ✅ Enabled (for responsible disclosure)

## Environment Protection

### Development Environment

Navigate to **Settings > Environments > New environment**:

#### Environment Name
- **Name**: `development`

#### Protection Rules
- **Required reviewers**: ❌ Not required
- **Wait timer**: `0 minutes`
- **Deployment branches**: `develop` branch only

#### Environment Secrets
- `AWS_ACCESS_KEY_ID`: Development AWS access key
- `AWS_SECRET_ACCESS_KEY`: Development AWS secret key

### Production Environment

#### Environment Name
- **Name**: `production`

#### Protection Rules
- **Required reviewers**: ✅ Required (select 1-2 senior developers)
- **Wait timer**: `5 minutes` (cooling-off period)
- **Deployment branches**: `main` branch only

#### Environment Secrets
- `AWS_PROD_ACCESS_KEY_ID`: Production AWS access key
- `AWS_PROD_SECRET_ACCESS_KEY`: Production AWS secret key

## Team and User Permissions

### Repository Roles

#### Admin Access
- Repository owners
- Senior developers with deployment responsibilities

#### Write Access
- Core development team members
- Contributors with commit privileges

#### Read Access
- QA team members
- Stakeholders requiring visibility

### Team Assignments

Create teams for code review assignments:

#### @organization/backend-team
- **Members**: Backend developers
- **Responsibilities**: Lambda functions, API changes, infrastructure

#### @organization/infrastructure-team  
- **Members**: DevOps/Platform engineers
- **Responsibilities**: CDK changes, deployment scripts, AWS configurations

#### @organization/security-team
- **Members**: Security engineers
- **Responsibilities**: Security-related changes, dependency updates

#### @organization/qa-team
- **Members**: Quality assurance engineers
- **Responsibilities**: Test changes, CI/CD pipeline modifications

### CODEOWNERS File

Create `.github/CODEOWNERS` for automatic review assignments:

```
# Global owners
* @organization/backend-team

# Infrastructure changes
/infrastructure/ @organization/infrastructure-team
/scripts/ @organization/infrastructure-team
/.github/ @organization/infrastructure-team

# Security-sensitive files
/docs/security/ @organization/security-team
package*.json @organization/security-team

# Testing
/tests/ @organization/qa-team
**/*.test.ts @organization/qa-team
/.github/workflows/ @organization/qa-team

# Documentation
/docs/ @organization/backend-team
README.md @organization/backend-team
```

## Secrets Configuration

### Repository Secrets

Navigate to **Settings > Secrets and variables > Actions**:

#### Development Secrets
- `AWS_ACCESS_KEY_ID`: Development AWS access key
- `AWS_SECRET_ACCESS_KEY`: Development AWS secret key

#### Production Secrets
- `AWS_PROD_ACCESS_KEY_ID`: Production AWS access key  
- `AWS_PROD_SECRET_ACCESS_KEY`: Production AWS secret key

#### Optional Secrets
- `CODECOV_TOKEN`: Code coverage reporting token
- `SEMGREP_APP_TOKEN`: Semgrep security scanning token

### Environment Variables

Repository-level variables for non-sensitive configuration:

- `NODE_VERSION`: `18` (Node.js version for CI/CD)
- `AWS_REGION`: `us-east-1` (Default AWS region)

## Automated Setup

### Setup Script

Run the provided setup script to configure branch protection programmatically:

```bash
./scripts/setup-github-protection.sh
```

### Manual API Configuration

Use GitHub CLI for programmatic setup:

```bash
# Install GitHub CLI
brew install gh  # macOS
# or download from https://cli.github.com/

# Authenticate
gh auth login

# Set branch protection for main
gh api repos/:owner/:repo/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Lint and Format","Unit Tests","Build Application","Security Scan"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":2,"dismiss_stale_reviews":true,"require_code_owner_reviews":true}' \
  --field restrictions=null

# Set branch protection for develop
gh api repos/:owner/:repo/branches/develop/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Lint and Format","Unit Tests","Build Application"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null
```

## Dependabot Configuration

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  # Enable version updates for npm
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
    open-pull-requests-limit: 5
    reviewers:
      - "@organization/backend-team"
    assignees:
      - "@organization/infrastructure-team"
    commit-message:
      prefix: "build"
      include: "scope"

  # Infrastructure dependencies
  - package-ecosystem: "npm"
    directory: "/infrastructure"
    schedule:
      interval: "weekly"
      day: "monday"  
      time: "09:00"
    open-pull-requests-limit: 3
    reviewers:
      - "@organization/infrastructure-team"

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "10:00"
    open-pull-requests-limit: 2
    reviewers:
      - "@organization/infrastructure-team"
```

## Troubleshooting

### Common Issues

#### 1. Status Check Not Found

**Error**: Required status check "Build Application" not found

**Solution**:
1. Ensure GitHub Actions workflow is running
2. Check workflow file syntax in `.github/workflows/`
3. Verify job names match required status check names
4. Re-run failed workflows

#### 2. Cannot Merge - Reviews Required

**Error**: Pull request requires 2 reviews but only has 1

**Solution**:
1. Request additional reviews from team members
2. Ensure reviewers have write access to repository
3. Check if review was dismissed due to new commits

#### 3. Force Push Blocked

**Error**: Remote rejected (protected branch hook declined)

**Solution**:
1. Create a new branch from main: `git checkout -b fix/my-changes`
2. Apply changes and create pull request
3. Use proper git workflow instead of force pushing

#### 4. Admin Override Not Working

**Error**: Cannot bypass branch protection even as admin

**Solution**:
1. Verify admin status in repository settings
2. Check if "Do not allow bypassing" is enabled
3. Temporarily disable protection rule if absolutely necessary

#### 5. GitHub Actions Workflow Failing

**Error**: CI/CD pipeline consistently failing

**Solution**:
1. Check workflow logs in Actions tab
2. Verify secrets are configured correctly
3. Ensure AWS credentials have necessary permissions
4. Test deployment scripts locally

### Debug Commands

```bash
# Check current branch protection rules
gh api repos/:owner/:repo/branches/main/protection

# List repository secrets (names only)
gh secret list

# Check workflow runs
gh run list

# View specific workflow run
gh run view <run-id>

# Check repository settings
gh repo view --json defaultBranch,permissions,visibility
```

### Getting Help

1. **GitHub Documentation**: [Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)
2. **GitHub Community**: [Community Forum](https://github.community/)
3. **GitHub Support**: [Contact Support](https://support.github.com/) (for paid plans)

### Validation Checklist

After setup, verify the following:

- [ ] Cannot push directly to main branch
- [ ] Cannot push directly to develop branch  
- [ ] Pull requests require appropriate reviews
- [ ] Status checks run automatically on PRs
- [ ] Failed status checks block merging
- [ ] Force pushes are blocked
- [ ] Branch deletion is blocked
- [ ] Environment protection rules work
- [ ] Secrets are properly configured
- [ ] Dependabot creates update PRs
- [ ] Code scanning alerts appear in Security tab

## Maintenance

### Regular Tasks

#### Monthly Review
- Review and update required status checks
- Audit team permissions and access
- Check Dependabot alerts and updates
- Review failed workflow runs

#### Quarterly Review  
- Update GitHub Actions versions
- Review and update security scanning tools
- Audit and rotate secrets if necessary
- Review branch protection effectiveness

#### As Needed
- Add new team members to appropriate teams
- Update CODEOWNERS file for new code areas
- Adjust protection rules based on team feedback
- Update documentation for process changes