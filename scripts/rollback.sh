#!/bin/bash

# Report Builder Rollback Script
# Rollback to a previous deployment version

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT=""
AWS_REGION="us-east-1"
TARGET_VERSION=""
DRY_RUN=false
FORCE=false

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

Rollback the Report Builder application to a previous version

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (development|production) [REQUIRED]
    -v, --version VERSION           Target version to rollback to [REQUIRED]
    -r, --region REGION             AWS region (default: us-east-1)
    -d, --dry-run                   Show what would be rolled back without executing
    -f, --force                     Force rollback without confirmation
    -h, --help                      Show this help message

EXAMPLES:
    $0 --environment development --version v1.2.3
    $0 -e production -v latest-stable --dry-run
    $0 -e development -v previous --force

VERSION OPTIONS:
    v1.2.3                          Specific version tag
    latest-stable                   Latest stable release
    previous                        Previous deployment
    <commit-hash>                   Specific commit hash

SAFETY FEATURES:
    - Production rollbacks require confirmation unless --force is used
    - Dry-run mode shows changes without executing
    - Backup current deployment before rollback
    - Validation checks before and after rollback

EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -v|--version)
                TARGET_VERSION="$2"
                shift 2
                ;;
            -r|--region)
                AWS_REGION="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -f|--force)
                FORCE=true
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

    if [[ -z "$ENVIRONMENT" ]]; then
        print_error "Environment is required"
        usage
        exit 1
    fi

    if [[ -z "$TARGET_VERSION" ]]; then
        print_error "Target version is required"
        usage
        exit 1
    fi

    if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "production" ]]; then
        print_error "Environment must be 'development' or 'production'"
        exit 1
    fi
}

check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check if we're in the right directory
    if [[ ! -f "package.json" || ! -d "infrastructure" ]]; then
        print_error "Must be run from the project root directory"
        exit 1
    fi

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        exit 1
    fi

    # Check CDK CLI
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK CLI is not installed"
        exit 1
    fi

    # Check git
    if ! command -v git &> /dev/null; then
        print_error "Git is not installed"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured"
        exit 1
    fi

    print_success "Prerequisites check passed"
}

get_current_deployment() {
    print_info "Getting current deployment information..."
    
    local stack_name="report-builder-$ENVIRONMENT"
    
    if aws cloudformation describe-stacks --stack-name "$stack_name" --region "$AWS_REGION" &>/dev/null; then
        local current_version=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --region "$AWS_REGION" \
            --query 'Stacks[0].Tags[?Key==`Version`].Value' \
            --output text 2>/dev/null || echo "unknown")
            
        local stack_status=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --region "$AWS_REGION" \
            --query 'Stacks[0].StackStatus' \
            --output text)
            
        print_info "Current deployment:"
        print_info "  Version: $current_version"
        print_info "  Status: $stack_status"
        print_info "  Stack: $stack_name"
        
        if [[ "$stack_status" != "CREATE_COMPLETE" && "$stack_status" != "UPDATE_COMPLETE" ]]; then
            print_warning "Stack is not in a stable state: $stack_status"
        fi
    else
        print_error "No deployment found for environment: $ENVIRONMENT"
        exit 1
    fi
}

resolve_target_version() {
    print_info "Resolving target version: $TARGET_VERSION"
    
    case "$TARGET_VERSION" in
        "previous")
            # Get previous git tag
            local previous_tag=$(git tag --sort=-version:refname | head -2 | tail -1)
            if [[ -n "$previous_tag" ]]; then
                TARGET_VERSION="$previous_tag"
                print_info "Previous version resolved to: $TARGET_VERSION"
            else
                print_error "No previous version found"
                exit 1
            fi
            ;;
        "latest-stable")
            # Get latest stable tag (not pre-release)
            local latest_stable=$(git tag --sort=-version:refname | grep -v -E '(alpha|beta|rc)' | head -1)
            if [[ -n "$latest_stable" ]]; then
                TARGET_VERSION="$latest_stable"
                print_info "Latest stable version resolved to: $TARGET_VERSION"
            else
                print_error "No stable version found"
                exit 1
            fi
            ;;
        v*)
            # Validate version tag exists
            if git tag | grep -q "^$TARGET_VERSION$"; then
                print_info "Version tag validated: $TARGET_VERSION"
            else
                print_error "Version tag not found: $TARGET_VERSION"
                print_info "Available tags:"
                git tag --sort=-version:refname | head -10
                exit 1
            fi
            ;;
        *)
            # Assume it's a commit hash
            if git rev-parse --verify "$TARGET_VERSION" &>/dev/null; then
                print_info "Commit hash validated: $TARGET_VERSION"
            else
                print_error "Invalid version/commit: $TARGET_VERSION"
                exit 1
            fi
            ;;
    esac
}

confirm_rollback() {
    if [[ "$FORCE" == true ]]; then
        print_info "Forcing rollback without confirmation"
        return
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "Dry run mode - no confirmation needed"
        return
    fi
    
    echo
    print_warning "⚠️  ROLLBACK CONFIRMATION ⚠️"
    echo
    echo "Environment: $ENVIRONMENT"
    echo "Target Version: $TARGET_VERSION"
    echo "AWS Region: $AWS_REGION"
    echo
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        echo -e "${RED}WARNING: This is a PRODUCTION rollback!${NC}"
        echo
    fi
    
    read -p "Are you sure you want to proceed? (type 'yes' to confirm): " confirmation
    
    if [[ "$confirmation" != "yes" ]]; then
        print_info "Rollback cancelled"
        exit 0
    fi
    
    print_success "Rollback confirmed"
}

backup_current_state() {
    print_info "Creating backup of current state..."
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would create backup"
        return
    fi
    
    local backup_dir="backups/$(date +%Y%m%d_%H%M%S)_${ENVIRONMENT}"
    mkdir -p "$backup_dir"
    
    # Save current git state
    git rev-parse HEAD > "$backup_dir/current_commit.txt"
    git branch --show-current > "$backup_dir/current_branch.txt"
    
    # Export current stack template
    local stack_name="report-builder-$ENVIRONMENT"
    aws cloudformation get-template \
        --stack-name "$stack_name" \
        --region "$AWS_REGION" \
        > "$backup_dir/current_template.json" 2>/dev/null || true
    
    # Save stack parameters
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].Parameters' \
        > "$backup_dir/current_parameters.json" 2>/dev/null || true
    
    print_success "Backup created: $backup_dir"
}

checkout_target_version() {
    print_info "Checking out target version: $TARGET_VERSION"
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would checkout: $TARGET_VERSION"
        return
    fi
    
    # Stash any uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        print_info "Stashing uncommitted changes..."
        git stash push -m "Rollback script stash $(date)"
    fi
    
    # Checkout target version
    git checkout "$TARGET_VERSION"
    
    print_success "Checked out version: $TARGET_VERSION"
}

deploy_rollback() {
    print_info "Deploying rollback version..."
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would deploy rollback"
        print_info "[DRY RUN] Command: ./scripts/deploy.sh -e $ENVIRONMENT -r $AWS_REGION --skip-tests"
        return
    fi
    
    # Install dependencies for the target version
    print_info "Installing dependencies for target version..."
    npm ci
    cd infrastructure
    npm ci
    cd ..
    
    # Deploy using the main deployment script
    if [[ -x "./scripts/deploy.sh" ]]; then
        ./scripts/deploy.sh \
            --environment "$ENVIRONMENT" \
            --region "$AWS_REGION" \
            --skip-tests
    else
        print_error "Deployment script not found or not executable"
        exit 1
    fi
    
    print_success "Rollback deployment completed"
}

verify_rollback() {
    print_info "Verifying rollback..."
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would verify rollback"
        return
    fi
    
    local stack_name="report-builder-$ENVIRONMENT"
    
    # Check stack status
    local stack_status=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)
    
    if [[ "$stack_status" == "CREATE_COMPLETE" || "$stack_status" == "UPDATE_COMPLETE" ]]; then
        print_success "Stack is healthy: $stack_status"
    else
        print_error "Stack rollback may have failed: $stack_status"
        exit 1
    fi
    
    # TODO: Add application-specific health checks here
    # - Test email processing endpoint
    # - Check CloudWatch metrics
    # - Verify file processing functionality
    
    print_success "Rollback verification completed"
}

print_rollback_summary() {
    echo
    print_success "🔄 Rollback completed successfully!"
    echo
    echo "Environment: $ENVIRONMENT"
    echo "Rolled back to: $TARGET_VERSION"
    echo "Region: $AWS_REGION"
    echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
    
    if [[ "$DRY_RUN" == true ]]; then
        echo "Mode: DRY RUN (no changes made)"
    fi
    
    echo
    print_info "Post-rollback checklist:"
    echo "1. Verify application functionality"
    echo "2. Check CloudWatch logs for errors"
    echo "3. Monitor key metrics"
    echo "4. Notify stakeholders of rollback"
    echo "5. Plan forward fix if needed"
}

main() {
    echo "🔄 Report Builder Rollback Script"
    echo "=================================="
    echo
    
    parse_args "$@"
    check_prerequisites
    get_current_deployment
    resolve_target_version
    confirm_rollback
    backup_current_state
    checkout_target_version
    deploy_rollback
    verify_rollback
    print_rollback_summary
}

main "$@"