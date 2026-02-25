#!/bin/bash

# Pre-Push Quality Check Script
# Runs all quality checks before pushing code

# set -euo pipefail  # Temporarily disabled to debug hanging issue

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Running Pre-Push Quality Checks${NC}"
echo "========================================"

# Track results
CHECKS_PASSED=0
CHECKS_FAILED=0

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((CHECKS_PASSED++))
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((CHECKS_FAILED++))
}

print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# 1. TypeScript Compilation
print_header "TypeScript Compilation"
if npm run build --silent; then
    print_success "TypeScript compilation passed"
else
    print_error "TypeScript compilation failed"
fi

# 2. Linting (allow warnings, fail on errors)
print_header "ESLint Check"
echo "DEBUG: About to run lint check..."
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT_CODE=$?
echo "DEBUG: Lint check completed with exit code $LINT_EXIT_CODE"
if [[ $LINT_EXIT_CODE -eq 0 ]]; then
    # Check if there are any errors (not just warnings)
    # Look for the pattern like "(0 errors" vs "(1 errors" or more
    if echo "$LINT_OUTPUT" | grep -q "([1-9][0-9]* errors"; then
        print_error "ESLint found errors"
    else
        print_success "ESLint check passed (warnings are acceptable)"
    fi
else
    print_error "ESLint check failed"
fi

# 3. Code Formatting
print_header "Prettier Formatting Check"
if npm run format:check --silent; then
    print_success "Prettier formatting check passed"
else
    print_error "Prettier formatting check failed"
fi

# 4. Unit Tests with Coverage
print_header "Unit Tests & Coverage"
if npm test --silent; then
    print_success "Unit tests and coverage passed"
else
    print_error "Unit tests or coverage failed"
fi

# 5. Integration Tests (if available)
print_header "Integration Tests"
if npm run test:integration --silent 2>/dev/null; then
    print_success "Integration tests passed"
else
    print_error "Integration tests failed or not available"
fi

# 6. Infrastructure Build
print_header "Infrastructure Build"
if (cd infrastructure && npm run build --silent 2>/dev/null); then
    print_success "Infrastructure build passed"
else
    print_error "Infrastructure build failed"
fi

# Summary
echo
echo "========================================"
echo "Pre-Push Check Summary"
echo "========================================"
echo
echo -e "${GREEN}Checks passed: $CHECKS_PASSED${NC}"
echo -e "${RED}Checks failed: $CHECKS_FAILED${NC}"
echo

if [[ $CHECKS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✅ All checks passed! Safe to push.${NC}"
    exit 0
else
    echo -e "${RED}❌ Some checks failed! DO NOT PUSH.${NC}"
    echo "Fix the failed checks before pushing."
    exit 1
fi
