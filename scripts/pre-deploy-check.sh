#!/bin/bash

# Pre-deployment Health Check Script
# Validates system readiness before deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check results
CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((CHECKS_PASSED++))
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
    ((WARNINGS++))
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((CHECKS_FAILED++))
}

print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# Check system requirements
check_system_requirements() {
    print_header "System Requirements"
    
    # Node.js version
    if command -v node &> /dev/null; then
        local node_version=$(node --version)
        local major_version=$(echo $node_version | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ $major_version -ge 18 ]]; then
            print_success "Node.js version: $node_version"
        else
            print_error "Node.js version too old: $node_version (requires 18+)"
        fi
    else
        print_error "Node.js not installed"
    fi
    
    # npm version
    if command -v npm &> /dev/null; then
        local npm_version=$(npm --version)
        print_success "npm version: $npm_version"
    else
        print_error "npm not installed"
    fi
    
    # AWS CLI
    if command -v aws &> /dev/null; then
        local aws_version=$(aws --version 2>&1 | cut -d' ' -f1)
        print_success "AWS CLI: $aws_version"
    else
        print_error "AWS CLI not installed"
    fi
    
    # CDK CLI
    if command -v cdk &> /dev/null; then
        local cdk_version=$(cdk --version)
        print_success "CDK CLI: $cdk_version"
    else
        print_error "CDK CLI not installed (run: npm install -g aws-cdk)"
    fi
    
    # Git
    if command -v git &> /dev/null; then
        local git_version=$(git --version)
        print_success "Git: $git_version"
    else
        print_error "Git not installed"
    fi
}

# Check AWS configuration
check_aws_configuration() {
    print_header "AWS Configuration"
    
    # AWS credentials
    if aws sts get-caller-identity &> /dev/null; then
        local account_id=$(aws sts get-caller-identity --query Account --output text)
        local user_arn=$(aws sts get-caller-identity --query Arn --output text)
        print_success "AWS credentials configured"
        print_info "Account ID: $account_id"
        print_info "User ARN: $user_arn"
    else
        print_error "AWS credentials not configured or invalid"
    fi
    
    # AWS region
    local aws_region=$(aws configure get region 2>/dev/null || echo "not-set")
    if [[ "$aws_region" != "not-set" ]]; then
        print_success "AWS region: $aws_region"
    else
        print_warning "AWS region not set in configuration"
    fi
    
    # Check AWS permissions (basic test)
    if aws s3 ls &> /dev/null; then
        print_success "S3 access permissions verified"
    else
        print_error "S3 access denied - check IAM permissions"
    fi
    
    if aws lambda list-functions --max-items 1 &> /dev/null; then
        print_success "Lambda access permissions verified"
    else
        print_error "Lambda access denied - check IAM permissions"
    fi
    
    if aws ses describe-configuration-sets --max-items 1 &> /dev/null; then
        print_success "SES access permissions verified"
    else
        print_error "SES access denied - check IAM permissions"
    fi
}

# Check project structure
check_project_structure() {
    print_header "Project Structure"
    
    # Root files
    local required_files=(
        "package.json"
        "tsconfig.json"
        "vitest.config.ts"
        "README.md"
    )
    
    for file in "${required_files[@]}"; do
        if [[ -f "$file" ]]; then
            print_success "Found: $file"
        else
            print_error "Missing: $file"
        fi
    done
    
    # Required directories
    local required_dirs=(
        "src"
        "infrastructure"
        "scripts"
        "docs"
    )
    
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$dir" ]]; then
            print_success "Found directory: $dir"
        else
            print_error "Missing directory: $dir"
        fi
    done
    
    # Infrastructure files
    if [[ -f "infrastructure/package.json" ]]; then
        print_success "Infrastructure package.json found"
    else
        print_error "Infrastructure package.json missing"
    fi
    
    if [[ -f "infrastructure/cdk.json" ]]; then
        print_success "CDK configuration found"
    else
        print_error "CDK configuration missing"
    fi
}

# Check dependencies
check_dependencies() {
    print_header "Dependencies"
    
    # Check if node_modules exist
    if [[ -d "node_modules" ]]; then
        print_success "Root node_modules found"
    else
        print_warning "Root node_modules not found - run 'npm install'"
    fi
    
    if [[ -d "infrastructure/node_modules" ]]; then
        print_success "Infrastructure node_modules found"
    else
        print_warning "Infrastructure node_modules not found - run 'npm install' in infrastructure/"
    fi
    
    # Check package-lock.json
    if [[ -f "package-lock.json" ]]; then
        print_success "Root package-lock.json found"
    else
        print_warning "Root package-lock.json missing"
    fi
    
    if [[ -f "infrastructure/package-lock.json" ]]; then
        print_success "Infrastructure package-lock.json found"
    else
        print_warning "Infrastructure package-lock.json missing"
    fi
}

# Check git status
check_git_status() {
    print_header "Git Repository Status"
    
    # Check if in git repo
    if git rev-parse --git-dir &> /dev/null; then
        print_success "Git repository detected"
        
        # Check current branch
        local current_branch=$(git branch --show-current)
        print_info "Current branch: $current_branch"
        
        # Check for uncommitted changes
        if git diff-index --quiet HEAD -- 2>/dev/null; then
            print_success "Working directory is clean"
        else
            print_warning "Working directory has uncommitted changes"
            print_info "Modified files:"
            git diff --name-only
        fi
        
        # Check for untracked files
        local untracked=$(git ls-files --others --exclude-standard)
        if [[ -z "$untracked" ]]; then
            print_success "No untracked files"
        else
            print_warning "Untracked files present:"
            echo "$untracked"
        fi
        
        # Check if remote exists
        if git remote -v | grep -q origin; then
            print_success "Git remote 'origin' configured"
        else
            print_warning "Git remote 'origin' not configured"
        fi
        
    else
        print_error "Not in a git repository"
    fi
}

# Check build status
check_build_status() {
    print_header "Build Status"
    
    # Check if TypeScript compiles
    if npm run build --silent &> /dev/null; then
        print_success "TypeScript compilation successful"
    else
        print_error "TypeScript compilation failed"
    fi
    
    # Check if infrastructure builds
    if (cd infrastructure && npm run build --silent) &> /dev/null; then
        print_success "Infrastructure build successful"
    else
        print_error "Infrastructure build failed"
    fi
    
    # Check for compiled output
    if [[ -d "dist" ]]; then
        print_success "Build output directory exists"
    else
        print_warning "Build output directory not found"
    fi
}

# Check tests
check_tests() {
    print_header "Test Status"
    
    # Run unit tests
    if npm test --silent &> /dev/null; then
        print_success "Unit tests pass"
    else
        print_error "Unit tests fail"
    fi
    
    # Check test coverage
    if [[ -d "coverage" ]]; then
        print_success "Test coverage reports available"
    else
        print_warning "Test coverage reports not found"
    fi
    
    # Check for integration tests
    if npm run test:integration --silent &> /dev/null 2>&1; then
        print_success "Integration tests available and pass"
    else
        print_warning "Integration tests not available or failing"
    fi
}

# Check security
check_security() {
    print_header "Security Checks"
    
    # Check for npm audit issues
    local audit_output=$(npm audit --audit-level=moderate --json 2>/dev/null || echo '{"vulnerabilities": {}}')
    local vuln_count=$(echo "$audit_output" | grep -o '"vulnerabilities":{[^}]*}' | grep -o '"[^"]*":[0-9]*' | wc -l)
    
    if [[ $vuln_count -eq 0 ]]; then
        print_success "No npm security vulnerabilities found"
    else
        print_warning "npm security vulnerabilities detected - run 'npm audit' for details"
    fi
    
    # Check for sensitive files
    local sensitive_patterns=(".env" "*.key" "*.pem" "credentials" "secrets")
    local found_sensitive=false
    
    for pattern in "${sensitive_patterns[@]}"; do
        if find . -name "$pattern" -not -path "./node_modules/*" | head -1 | grep -q .; then
            print_warning "Potentially sensitive files found matching: $pattern"
            found_sensitive=true
        fi
    done
    
    if [[ $found_sensitive == false ]]; then
        print_success "No obvious sensitive files in repository"
    fi
}

# Check environment-specific configuration
check_environment_config() {
    print_header "Environment Configuration"
    
    # Check for environment config files
    local env_configs=(
        "infrastructure/config/environments/development.json"
        "infrastructure/config/environments/production.json"
    )
    
    for config in "${env_configs[@]}"; do
        if [[ -f "$config" ]]; then
            print_success "Found: $config"
        else
            print_error "Missing: $config"
        fi
    done
    
    # Check Parameter Store setup guide
    if [[ -f "PARAMETER_STORE_SETUP.md" ]]; then
        print_success "Parameter Store setup guide available"
    else
        print_warning "Parameter Store setup guide missing"
    fi
}

# Print summary
print_summary() {
    echo
    echo "======================================"
    echo "Pre-deployment Check Summary"
    echo "======================================"
    echo
    
    echo -e "${GREEN}Checks passed: $CHECKS_PASSED${NC}"
    echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
    echo -e "${RED}Checks failed: $CHECKS_FAILED${NC}"
    echo
    
    if [[ $CHECKS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}✅ System is ready for deployment!${NC}"
        echo
        echo "Recommended next steps:"
        echo "1. Run: ./scripts/deploy.sh --environment development"
        echo "2. Test the deployment"
        echo "3. Deploy to production when ready"
        exit 0
    else
        echo -e "${RED}❌ System is NOT ready for deployment${NC}"
        echo
        echo "Please fix the failed checks before deploying."
        echo "Run this script again after addressing the issues."
        exit 1
    fi
}

# Main function
main() {
    echo "🔍 Report Builder Pre-deployment Check"
    echo "======================================"
    
    check_system_requirements
    check_aws_configuration
    check_project_structure
    check_dependencies
    check_git_status
    check_build_status
    check_tests
    check_security
    check_environment_config
    print_summary
}

# Run main function
main "$@"