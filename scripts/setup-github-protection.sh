#!/bin/bash

# GitHub Branch Protection Setup Script
# This script automates the setup of branch protection rules using GitHub CLI

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
REPO=""
DRY_RUN=false
SKIP_CHECKS=false

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Setup GitHub branch protection rules for the Report Builder repository

OPTIONS:
    -r, --repo REPO         Repository in format owner/repo (auto-detected if not provided)
    -d, --dry-run          Show what would be configured without making changes
    -s, --skip-checks      Skip prerequisite checks
    -h, --help             Show this help message

EXAMPLES:
    $0 --repo your-org/report-builder
    $0 --dry-run
    $0 --skip-checks

PREREQUISITES:
    - GitHub CLI (gh) installed and authenticated
    - Repository admin permissions
    - Repository must exist and be accessible

EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -r|--repo)
                REPO="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -s|--skip-checks)
                SKIP_CHECKS=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

check_prerequisites() {
    if [[ "$SKIP_CHECKS" == true ]]; then
        print_info "Skipping prerequisite checks"
        return
    fi

    print_info "Checking prerequisites..."

    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
        print_error "GitHub CLI (gh) is not installed"
        print_info "Install from: https://cli.github.com/"
        exit 1
    fi

    # Check if authenticated
    if ! gh auth status &> /dev/null; then
        print_error "GitHub CLI is not authenticated"
        print_info "Run: gh auth login"
        exit 1
    fi

    # Auto-detect repository if not provided
    if [[ -z "$REPO" ]]; then
        if git remote get-url origin &> /dev/null; then
            local origin_url=$(git remote get-url origin)
            if [[ "$origin_url" =~ github\.com[:/]([^/]+/[^/]+)(\.git)?$ ]]; then
                REPO="${BASH_REMATCH[1]}"
                print_info "Auto-detected repository: $REPO"
            else
                print_error "Could not auto-detect GitHub repository"
                print_info "Please specify with --repo owner/repo"
                exit 1
            fi
        else
            print_error "No git remote found and no repository specified"
            print_info "Please specify with --repo owner/repo"
            exit 1
        fi
    fi

    # Check if repository exists and we have access
    if ! gh repo view "$REPO" &> /dev/null; then
        print_error "Cannot access repository: $REPO"
        print_info "Ensure the repository exists and you have admin permissions"
        exit 1
    fi

    # Check if we have admin permissions
    local permissions=$(gh api "repos/$REPO" --jq '.permissions.admin')
    if [[ "$permissions" != "true" ]]; then
        print_error "Admin permissions required for repository: $REPO"
        exit 1
    fi

    print_success "Prerequisites check passed"
}

setup_main_branch_protection() {
    print_info "Setting up main branch protection..."

    local protection_config='{
        "required_status_checks": {
            "strict": true,
            "contexts": [
                "Lint and Format",
                "Unit Tests", 
                "Build Application",
                "Security Scan",
                "Code Quality",
                "Dependency Review"
            ]
        },
        "enforce_admins": true,
        "required_pull_request_reviews": {
            "required_approving_review_count": 2,
            "dismiss_stale_reviews": true,
            "require_code_owner_reviews": true,
            "restrict_reviews_to_users_with_write_access": true
        },
        "restrictions": null,
        "allow_force_pushes": false,
        "allow_deletions": false
    }'

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would configure main branch protection with:"
        echo "$protection_config" | jq '.'
        return
    fi

    if gh api "repos/$REPO/branches/main/protection" \
        --method PUT \
        --input <(echo "$protection_config") &> /dev/null; then
        print_success "Main branch protection configured"
    else
        print_error "Failed to configure main branch protection"
        return 1
    fi
}

setup_develop_branch_protection() {
    print_info "Setting up develop branch protection..."

    # Check if develop branch exists
    if ! gh api "repos/$REPO/branches/develop" &> /dev/null; then
        print_warning "Develop branch does not exist, skipping protection setup"
        return
    fi

    local protection_config='{
        "required_status_checks": {
            "strict": true,
            "contexts": [
                "Lint and Format",
                "Unit Tests",
                "Build Application",
                "Security Scan"
            ]
        },
        "enforce_admins": false,
        "required_pull_request_reviews": {
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": true,
            "require_code_owner_reviews": false,
            "restrict_reviews_to_users_with_write_access": true
        },
        "restrictions": null,
        "allow_force_pushes": false,
        "allow_deletions": false
    }'

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would configure develop branch protection with:"
        echo "$protection_config" | jq '.'
        return
    fi

    if gh api "repos/$REPO/branches/develop/protection" \
        --method PUT \
        --input <(echo "$protection_config") &> /dev/null; then
        print_success "Develop branch protection configured"
    else
        print_error "Failed to configure develop branch protection"
        return 1
    fi
}

setup_repository_settings() {
    print_info "Configuring repository settings..."

    local repo_settings='{
        "allow_squash_merge": true,
        "allow_merge_commit": true,
        "allow_rebase_merge": false,
        "delete_branch_on_merge": true,
        "allow_auto_merge": true,
        "allow_update_branch": true
    }'

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would configure repository settings with:"
        echo "$repo_settings" | jq '.'
        return
    fi

    if gh api "repos/$REPO" \
        --method PATCH \
        --input <(echo "$repo_settings") &> /dev/null; then
        print_success "Repository settings configured"
    else
        print_warning "Failed to configure some repository settings (may require higher permissions)"
    fi
}

setup_environments() {
    print_info "Setting up deployment environments..."

    # Development environment
    local dev_env_config='{
        "wait_timer": 0,
        "reviewers": [],
        "deployment_branch_policy": {
            "protected_branches": false,
            "custom_branch_policies": true
        }
    }'

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would create development environment"
        print_info "[DRY RUN] Would create production environment with manual approval"
        return
    fi

    # Create development environment
    if gh api "repos/$REPO/environments/development" \
        --method PUT \
        --input <(echo "$dev_env_config") &> /dev/null; then
        print_success "Development environment created"
        
        # Set deployment branch policy for development
        gh api "repos/$REPO/environments/development/deployment-branch-policies" \
            --method POST \
            --field name="develop" \
            --field type="branch" &> /dev/null || true
    else
        print_warning "Failed to create development environment"
    fi

    # Production environment with manual approval
    local prod_env_config='{
        "wait_timer": 5,
        "reviewers": [],
        "deployment_branch_policy": {
            "protected_branches": false,
            "custom_branch_policies": true
        }
    }'

    if gh api "repos/$REPO/environments/production" \
        --method PUT \
        --input <(echo "$prod_env_config") &> /dev/null; then
        print_success "Production environment created"
        
        # Set deployment branch policy for production
        gh api "repos/$REPO/environments/production/deployment-branch-policies" \
            --method POST \
            --field name="main" \
            --field type="branch" &> /dev/null || true
    else
        print_warning "Failed to create production environment"
    fi
}

create_codeowners_file() {
    print_info "Creating CODEOWNERS file..."

    local codeowners_content='# Global owners
* @your-org/backend-team

# Infrastructure changes  
/infrastructure/ @your-org/infrastructure-team
/scripts/ @your-org/infrastructure-team
/.github/ @your-org/infrastructure-team

# Security-sensitive files
/docs/security/ @your-org/security-team
package*.json @your-org/security-team

# Testing
/tests/ @your-org/qa-team
**/*.test.ts @your-org/qa-team
/.github/workflows/ @your-org/qa-team

# Documentation
/docs/ @your-org/backend-team
README.md @your-org/backend-team'

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would create .github/CODEOWNERS file"
        return
    fi

    # Create .github directory if it doesn't exist
    mkdir -p .github

    # Create CODEOWNERS file
    echo "$codeowners_content" > .github/CODEOWNERS

    # Add to git if we're in a git repository
    if git rev-parse --git-dir &> /dev/null; then
        git add .github/CODEOWNERS
        print_success "CODEOWNERS file created and staged"
    else
        print_success "CODEOWNERS file created"
    fi
}

create_dependabot_config() {
    print_info "Creating Dependabot configuration..."

    local dependabot_config='version: 2
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
      - "@your-org/backend-team"
    assignees:
      - "@your-org/infrastructure-team"
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
      - "@your-org/infrastructure-team"

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "10:00"
    open-pull-requests-limit: 2
    reviewers:
      - "@your-org/infrastructure-team"'

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would create .github/dependabot.yml file"
        return
    fi

    # Create .github directory if it doesn't exist
    mkdir -p .github

    # Create dependabot.yml file
    echo "$dependabot_config" > .github/dependabot.yml

    # Add to git if we're in a git repository
    if git rev-parse --git-dir &> /dev/null; then
        git add .github/dependabot.yml
        print_success "Dependabot configuration created and staged"
    else
        print_success "Dependabot configuration created"
    fi
}

enable_security_features() {
    print_info "Enabling security features..."

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would enable security scanning features"
        return
    fi

    # Enable vulnerability alerts
    gh api "repos/$REPO/vulnerability-alerts" \
        --method PUT &> /dev/null || print_warning "Could not enable vulnerability alerts"

    # Enable automated security fixes
    gh api "repos/$REPO/automated-security-fixes" \
        --method PUT &> /dev/null || print_warning "Could not enable automated security fixes"

    print_success "Security features enabled"
}

verify_setup() {
    print_info "Verifying setup..."

    # Check main branch protection
    if gh api "repos/$REPO/branches/main/protection" &> /dev/null; then
        print_success "✅ Main branch protection is active"
    else
        print_error "❌ Main branch protection is not configured"
    fi

    # Check develop branch protection
    if gh api "repos/$REPO/branches/develop/protection" &> /dev/null; then
        print_success "✅ Develop branch protection is active"
    else
        print_warning "⚠️  Develop branch protection is not configured (branch may not exist)"
    fi

    # Check if workflows exist
    if [[ -f ".github/workflows/ci.yml" ]]; then
        print_success "✅ CI/CD workflow file exists"
    else
        print_warning "⚠️  CI/CD workflow file not found"
    fi

    if [[ -f ".github/workflows/pr-validation.yml" ]]; then
        print_success "✅ PR validation workflow file exists"
    else
        print_warning "⚠️  PR validation workflow file not found"
    fi

    # Check CODEOWNERS
    if [[ -f ".github/CODEOWNERS" ]]; then
        print_success "✅ CODEOWNERS file exists"
    else
        print_warning "⚠️  CODEOWNERS file not found"
    fi

    # Check Dependabot
    if [[ -f ".github/dependabot.yml" ]]; then
        print_success "✅ Dependabot configuration exists"
    else
        print_warning "⚠️  Dependabot configuration not found"
    fi
}

print_next_steps() {
    echo
    print_success "🎉 GitHub branch protection setup completed!"
    echo
    print_info "Next steps:"
    echo "1. 📝 Review and commit the created configuration files:"
    echo "   - .github/CODEOWNERS"
    echo "   - .github/dependabot.yml"
    echo
    echo "2. 🔐 Configure repository secrets in GitHub:"
    echo "   - AWS_ACCESS_KEY_ID (development)"
    echo "   - AWS_SECRET_ACCESS_KEY (development)"
    echo "   - AWS_PROD_ACCESS_KEY_ID (production)"
    echo "   - AWS_PROD_SECRET_ACCESS_KEY (production)"
    echo
    echo "3. 👥 Create GitHub teams (if not already existing):"
    echo "   - @your-org/backend-team"
    echo "   - @your-org/infrastructure-team"
    echo "   - @your-org/security-team"
    echo "   - @your-org/qa-team"
    echo
    echo "4. 🧪 Test the setup:"
    echo "   - Create a test branch and pull request"
    echo "   - Verify status checks run automatically"
    echo "   - Confirm review requirements work"
    echo
    echo "5. 📚 Review the documentation:"
    echo "   - docs/github/branch-protection-setup.md"
    echo
    if [[ "$DRY_RUN" == true ]]; then
        echo "Note: This was a dry run. No changes were made."
        echo "Run without --dry-run to apply the configuration."
    fi
}

main() {
    echo "🔐 GitHub Branch Protection Setup"
    echo "================================="
    echo
    
    parse_args "$@"
    check_prerequisites
    setup_main_branch_protection
    setup_develop_branch_protection
    setup_repository_settings
    setup_environments
    create_codeowners_file
    create_dependabot_config
    enable_security_features
    verify_setup
    print_next_steps
}

main "$@"