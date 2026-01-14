#!/usr/bin/env bash
# =============================================================================
# Token Manager Unit Tests
# =============================================================================
# Tests the token validation and error handling logic
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN_MANAGER="${SCRIPT_DIR}/../scripts/token-manager.sh"
TEST_DATA_DIR=$(mktemp -d)
PASSED=0
FAILED=0

# Cleanup on exit
trap 'rm -rf "$TEST_DATA_DIR"' EXIT

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# =============================================================================
# Test Utilities
# =============================================================================

pass() {
    echo -e "  ${GREEN}PASS${NC}"
    ((PASSED++))
}

fail() {
    echo -e "  ${RED}FAIL${NC}: $1"
    ((FAILED++))
}

# =============================================================================
# Tests
# =============================================================================

test_script_exists() {
    echo "Test: token-manager.sh exists and is executable"
    
    if [[ -x "$TOKEN_MANAGER" ]]; then
        pass
    else
        fail "token-manager.sh not found or not executable"
    fi
}

test_usage_shows_validate() {
    echo "Test: Usage shows validate command"
    
    local output
    output=$("$TOKEN_MANAGER" 2>&1) || true
    
    if [[ "$output" == *"validate"* ]]; then
        pass
    else
        fail "validate command not in usage"
    fi
}

test_clear_without_tokens() {
    echo "Test: Clear works even without existing tokens"
    
    export DATA_DIR="$TEST_DATA_DIR/empty"
    mkdir -p "$DATA_DIR"
    
    if "$TOKEN_MANAGER" clear &>/dev/null; then
        pass
    else
        fail "clear command failed"
    fi
}

test_check_without_tokens() {
    echo "Test: Check returns failure without tokens"
    
    export DATA_DIR="$TEST_DATA_DIR/no-tokens"
    mkdir -p "$DATA_DIR"
    
    if ! "$TOKEN_MANAGER" check &>/dev/null; then
        pass
    else
        fail "check should fail without tokens"
    fi
}

test_status_without_tokens() {
    echo "Test: Status works without tokens"
    
    export DATA_DIR="$TEST_DATA_DIR/status-test"
    mkdir -p "$DATA_DIR"
    
    local output
    if output=$("$TOKEN_MANAGER" status 2>&1); then
        if [[ "$output" == *"No OAuth tokens stored"* ]]; then
            pass
        else
            fail "Expected 'No OAuth tokens stored' message"
        fi
    else
        fail "status command failed"
    fi
}

test_validate_without_tokens() {
    echo "Test: Validate returns failure without stored tokens"
    
    export DATA_DIR="$TEST_DATA_DIR/validate-no-tokens"
    mkdir -p "$DATA_DIR"
    
    if ! "$TOKEN_MANAGER" validate &>/dev/null; then
        pass
    else
        fail "validate should fail without tokens"
    fi
}

test_validate_with_invalid_token() {
    echo "Test: Validate returns failure with invalid token file"
    
    export DATA_DIR="$TEST_DATA_DIR/validate-invalid"
    mkdir -p "$DATA_DIR/.auth"
    
    # Create invalid token file
    echo '{"refresh_token":"invalid_token_12345","access_token":"bad_access"}' > "$DATA_DIR/.auth/.oauth-tokens.json"
    
    # This should fail because the token is invalid
    if ! "$TOKEN_MANAGER" validate &>/dev/null; then
        pass
    else
        fail "validate should fail with invalid tokens"
    fi
}

test_acquire_without_tokens() {
    echo "Test: Acquire returns failure without OAuth tokens"
    
    export DATA_DIR="$TEST_DATA_DIR/acquire-no-tokens"
    mkdir -p "$DATA_DIR"
    
    if ! "$TOKEN_MANAGER" acquire &>/dev/null; then
        pass
    else
        fail "acquire should fail without tokens"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=============================================="
    echo "Token Manager Unit Tests"
    echo "=============================================="
    echo ""
    
    test_script_exists
    test_usage_shows_validate
    test_clear_without_tokens
    test_check_without_tokens
    test_status_without_tokens
    test_validate_without_tokens
    test_validate_with_invalid_token
    test_acquire_without_tokens
    
    echo ""
    echo "=============================================="
    echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
    echo "=============================================="
    
    if [[ $FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
