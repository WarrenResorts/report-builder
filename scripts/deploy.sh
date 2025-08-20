#!/bin/bash

# Report Builder Deployment Script
# This script automates the deployment process for different environments

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
SKIP_TESTS=false
SKIP_BUILD=false
VERBOSE=false
DRY_RUN=false

# Print colored output
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

# Print usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy the Report Builder application to AWS

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (development|production) [REQUIRED]
    -r, --region REGION             AWS region (default: us-east-1)
    -s, --skip-tests               Skip running tests before deployment
    -b, --skip-build               Skip building the application
    -v, --verbose                  Enable verbose output
    -d, --dry-run                  Show what would be deployed without executing
    -h, --help                     Show this help message

EXAMPLES:
    $0 --environment development
    $0 -e production -r us-west-2
    $0 -e development --skip-tests --verbose
    $0 -e production --dry-run

ENVIRONMENT VARIABLES:
    AWS_PROFILE                    AWS profile to use for deployment
    AWS_ACCESS_KEY_ID             AWS access key (if not using profile)
    AWS_SECRET_ACCESS_KEY         AWS secret key (if not using profile)
    SES_DOMAIN_NAME               Override SES domain (auto-set by script)

PREREQUISITES:
    - AWS CLI configured with appropriate permissions
    - Node.js 18+ installed
    - CDK CLI installed (npm install -g aws-cdk)
    - Git repository is clean (no uncommitted changes)

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -r|--region)
                AWS_REGION="$2"
                shift 2
                ;;
            -s|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -b|--skip-build)
                SKIP_BUILD=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
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

    # Validate required arguments
    if [[ -z "$ENVIRONMENT" ]]; then
        print_error "Environment is required. Use -e or --environment."
        usage
        exit 1
    fi

    if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "production" ]]; then
        print_error "Environment must be 'development' or 'production'"
        exit 1
    fi
}

# Check if all prerequisites are met
check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check if we're in the right directory
    if [[ ! -f "package.json" || ! -d "infrastructure" ]]; then
        print_error "Must be run from the project root directory"
        exit 1
    fi

    # Check Node.js version
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi

    local node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $node_version -lt 18 ]]; then
        print_error "Node.js 18+ is required (current: $(node --version))"
        exit 1
    fi

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        exit 1
    fi

    # Check CDK CLI
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK CLI is not installed. Run: npm install -g aws-cdk"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured or invalid"
        exit 1
    fi

    # Check git status (only warn if not clean)
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        print_warning "Git repository has uncommitted changes"
        if [[ "$ENVIRONMENT" == "production" ]]; then
            print_error "Production deployments require a clean git repository"
            exit 1
        fi
    fi

    print_success "Prerequisites check passed"
}

# Install dependencies
install_dependencies() {
    if [[ "$SKIP_BUILD" == true ]]; then
        print_info "Skipping dependency installation (--skip-build)"
        return
    fi

    print_info "Installing dependencies..."
    
    # Install root dependencies
    npm ci
    
    # Install infrastructure dependencies
    cd infrastructure
    npm ci
    cd ..
    
    print_success "Dependencies installed"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_info "Skipping tests (--skip-tests)"
        return
    fi

    print_info "Running tests..."
    
    # Run unit tests
    npm test
    
    # Run integration tests if available
    if npm run test:integration --silent 2>/dev/null; then
        print_info "Running integration tests..."
        npm run test:integration
    else
        print_warning "Integration tests not available or configured"
    fi
    
    print_success "All tests passed"
}

# Build the application
build_application() {
    if [[ "$SKIP_BUILD" == true ]]; then
        print_info "Skipping build (--skip-build)"
        return
    fi

    print_info "Building application..."
    
    # Build main application
    npm run build
    
    # Build infrastructure
    cd infrastructure
    npm run build
    cd ..
    
    print_success "Application built successfully"
}

# Bootstrap CDK (if needed)
bootstrap_cdk() {
    print_info "Checking CDK bootstrap status..."
    
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would check CDK bootstrap for account $account_id in region $AWS_REGION"
        return
    fi
    
    # Check if already bootstrapped
    if aws cloudformation describe-stacks \
        --stack-name CDKToolkit \
        --region "$AWS_REGION" &>/dev/null; then
        print_success "CDK already bootstrapped"
    else
        print_info "Bootstrapping CDK for account $account_id in region $AWS_REGION..."
        cd infrastructure
        cdk bootstrap "aws://$account_id/$AWS_REGION"
        cd ..
        print_success "CDK bootstrap completed"
    fi
}

# Deploy infrastructure
deploy_infrastructure() {
    print_info "Deploying infrastructure to $ENVIRONMENT environment..."
    
    cd infrastructure
    
    # Check if SES_DOMAIN_NAME is set externally
    if [[ -z "$SES_DOMAIN_NAME" ]]; then
        print_error "SES_DOMAIN_NAME environment variable must be set for deployment"
        print_info "Example: SES_DOMAIN_NAME=your-domain.com ./scripts/deploy.sh -e development"
        cd ..
        exit 1
    fi
    
    print_info "Using SES domain: $SES_DOMAIN_NAME"
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would deploy with: SES_DOMAIN_NAME=$SES_DOMAIN_NAME cdk deploy --context environment=$ENVIRONMENT"
        cdk diff --context environment="$ENVIRONMENT" || true
        cd ..
        return
    fi
    
    local deploy_args="--context environment=$ENVIRONMENT"
    
    if [[ "$VERBOSE" == true ]]; then
        deploy_args="$deploy_args --verbose"
    fi
    
    # Always require approval for production
    if [[ "$ENVIRONMENT" == "production" ]]; then
        deploy_args="$deploy_args --require-approval broadening"
    else
        deploy_args="$deploy_args --require-approval never"
    fi
    
    cdk deploy $deploy_args
    
    cd ..
    print_success "Infrastructure deployment completed"
}

# Verify deployment
verify_deployment() {
    print_info "Verifying deployment..."
    
    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would verify deployment status"
        return
    fi
    
    local stack_name="report-builder-$ENVIRONMENT"
    
    # Check stack status
    local stack_status=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [[ "$stack_status" == "CREATE_COMPLETE" || "$stack_status" == "UPDATE_COMPLETE" ]]; then
        print_success "Stack $stack_name is in $stack_status state"
    else
        print_error "Stack $stack_name is in unexpected state: $stack_status"
        exit 1
    fi
    
    # Get stack outputs
    print_info "Stack outputs:"
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs' \
        --output table 2>/dev/null || print_warning "No stack outputs available"
}

# Print deployment summary
print_summary() {
    echo
    print_success "🚀 Deployment completed successfully!"
    echo
    echo "Environment: $ENVIRONMENT"
    echo "Region: $AWS_REGION"
    echo "Timestamp: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
    
    if [[ "$DRY_RUN" == true ]]; then
        echo "Mode: DRY RUN (no changes made)"
    fi
    
    echo
    print_info "Next steps:"
    echo "1. Verify the application is working as expected"
    echo "2. Check CloudWatch logs for any issues"
    echo "3. Test email processing functionality"
    echo "4. Monitor costs in AWS Cost Explorer"
}

# Main deployment function
main() {
    echo "🏗️  Report Builder Deployment Script"
    echo "======================================"
    echo
    
    parse_args "$@"
    
    print_info "Starting deployment to $ENVIRONMENT environment..."
    echo "Region: $AWS_REGION"
    echo "Dry run: $DRY_RUN"
    echo "Skip tests: $SKIP_TESTS"
    echo "Skip build: $SKIP_BUILD"
    echo "Verbose: $VERBOSE"
    echo
    
    check_prerequisites
    install_dependencies
    run_tests
    build_application
    bootstrap_cdk
    deploy_infrastructure
    verify_deployment
    print_summary
}

# Run main function with all arguments
main "$@"