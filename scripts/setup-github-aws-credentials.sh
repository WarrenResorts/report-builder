#!/bin/bash

# GitHub Actions AWS IAM Setup Script
# Creates an IAM user with necessary permissions for GitHub Actions deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IAM_USER_NAME="github-actions-report-builder"
POLICY_NAME="GitHubActionsReportBuilderPolicy"

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

print_info "Setting up GitHub Actions AWS credentials for Report Builder..."

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &>/dev/null; then
    print_error "AWS CLI is not configured or you don't have permissions."
    print_info "Please run 'aws configure' first or ensure your AWS credentials are set up."
    exit 1
fi

# Get current AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
REGION=$(aws configure get region || echo "us-east-1")

print_info "AWS Account ID: $ACCOUNT_ID"
print_info "AWS Region: $REGION"

# Create IAM policy document
POLICY_DOCUMENT=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "iam:*",
                "lambda:*",
                "s3:*",
                "ses:*",
                "events:*",
                "ssm:*",
                "kms:*",
                "logs:*",
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "sts:AssumeRole"
            ],
            "Resource": "arn:aws:iam::$ACCOUNT_ID:role/cdk-*"
        }
    ]
}
EOF
)

# Create IAM policy
print_info "Creating IAM policy: $POLICY_NAME"
POLICY_ARN="arn:aws:iam::$ACCOUNT_ID:policy/$POLICY_NAME"

if aws iam get-policy --policy-arn "$POLICY_ARN" &>/dev/null; then
    print_warning "Policy $POLICY_NAME already exists. Updating..."
    aws iam create-policy-version \
        --policy-arn "$POLICY_ARN" \
        --policy-document "$POLICY_DOCUMENT" \
        --set-as-default
else
    aws iam create-policy \
        --policy-name "$POLICY_NAME" \
        --policy-document "$POLICY_DOCUMENT" \
        --description "Permissions for GitHub Actions to deploy Report Builder infrastructure"
fi

print_success "IAM policy created/updated: $POLICY_ARN"

# Create IAM user
print_info "Creating IAM user: $IAM_USER_NAME"
if aws iam get-user --user-name "$IAM_USER_NAME" &>/dev/null; then
    print_warning "User $IAM_USER_NAME already exists."
else
    aws iam create-user \
        --user-name "$IAM_USER_NAME" \
        --tags Key=Purpose,Value=GitHubActions Key=Project,Value=ReportBuilder
    print_success "IAM user created: $IAM_USER_NAME"
fi

# Attach policy to user
print_info "Attaching policy to user..."
aws iam attach-user-policy \
    --user-name "$IAM_USER_NAME" \
    --policy-arn "$POLICY_ARN"

print_success "Policy attached to user."

# Create access keys
print_info "Creating access keys for GitHub Actions..."
if aws iam list-access-keys --user-name "$IAM_USER_NAME" --query 'AccessKeyMetadata[0].AccessKeyId' --output text | grep -q "AKIA"; then
    print_warning "Access keys already exist for user $IAM_USER_NAME"
    print_info "If you need new keys, delete the existing ones first:"
    print_info "aws iam list-access-keys --user-name $IAM_USER_NAME"
    print_info "aws iam delete-access-key --user-name $IAM_USER_NAME --access-key-id <OLD_KEY_ID>"
else
    CREDENTIALS=$(aws iam create-access-key --user-name "$IAM_USER_NAME")
    ACCESS_KEY_ID=$(echo "$CREDENTIALS" | jq -r '.AccessKey.AccessKeyId')
    SECRET_ACCESS_KEY=$(echo "$CREDENTIALS" | jq -r '.AccessKey.SecretAccessKey')

    print_success "Access keys created successfully!"
    echo
    print_info "🔐 GitHub Repository Secrets to Add:"
    echo "=================================="
    echo "AWS_ACCESS_KEY_ID: $ACCESS_KEY_ID"
    echo "AWS_SECRET_ACCESS_KEY: $SECRET_ACCESS_KEY"
    echo "=================================="
    echo
    print_warning "⚠️  IMPORTANT: Copy these credentials now - they won't be shown again!"
    echo
    print_info "Add these to your GitHub repository:"
    print_info "1. Go to: https://github.com/YOUR-ORG/report-builder/settings/secrets/actions"
    print_info "2. Click 'New repository secret'"
    print_info "3. Add AWS_ACCESS_KEY_ID with value: $ACCESS_KEY_ID"
    print_info "4. Add AWS_SECRET_ACCESS_KEY with value: $SECRET_ACCESS_KEY"
fi

echo
print_success "✅ GitHub Actions AWS setup complete!"
print_info "Next steps:"
print_info "1. Add the AWS credentials to GitHub repository secrets"
print_info "2. Push a commit to trigger GitHub Actions"
print_info "3. Verify deployment works on your PR"