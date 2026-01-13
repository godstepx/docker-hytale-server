#!/usr/bin/env bash
# =============================================================================
# Config Generator Unit Tests
# =============================================================================
# Tests the generate-config.sh script with various configurations.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_TMP_DIR=$(mktemp -d)
PASSED=0
FAILED=0

# Cleanup on exit
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# =============================================================================
# Test Utilities
# =============================================================================

setup_test() {
    local test_name="$1"
    echo "Running: $test_name"
    
    # Create test directories
    export TEMPLATE_DIR="${TEST_TMP_DIR}/templates"
    export CONFIG_OUTPUT="${TEST_TMP_DIR}/output/config.json"
    mkdir -p "$TEMPLATE_DIR" "$(dirname "$CONFIG_OUTPUT")"
    
    # Copy template
    cp "${SCRIPT_DIR}/../templates/server-config.template.json" "$TEMPLATE_DIR/"
    
    # Clear environment
    unset SERVER_NAME MAX_PLAYERS VIEW_DISTANCE DIFFICULTY MOTD SEED
    unset HYTALE_STRICT_CONFIG
    export DRY_RUN=false
}

assert_json_value() {
    local json_path="$1"
    local expected="$2"
    local actual
    
    actual=$(jq -r "$json_path" "$CONFIG_OUTPUT")
    
    if [[ "$actual" == "$expected" ]]; then
        return 0
    else
        echo "  FAIL: $json_path"
        echo "    Expected: $expected"
        echo "    Actual: $actual"
        return 1
    fi
}

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

test_default_values() {
    setup_test "Default values"
    
    "${SCRIPT_DIR}/../scripts/generate-config.sh"
    
    if assert_json_value ".server.name" "Hytale Server" && \
       assert_json_value ".server.maxPlayers" "20" && \
       assert_json_value ".server.viewDistance" "10"; then
        pass
    else
        fail "Default values not applied correctly"
    fi
}

test_custom_server_name() {
    setup_test "Custom server name"
    
    export SERVER_NAME="My Custom Server"
    "${SCRIPT_DIR}/../scripts/generate-config.sh"
    
    if assert_json_value ".server.name" "My Custom Server"; then
        pass
    else
        fail "Custom server name not applied"
    fi
}

test_numeric_values() {
    setup_test "Numeric values"
    
    export MAX_PLAYERS=50
    export VIEW_DISTANCE=16
    "${SCRIPT_DIR}/../scripts/generate-config.sh"
    
    if assert_json_value ".server.maxPlayers" "50" && \
       assert_json_value ".server.viewDistance" "16"; then
        pass
    else
        fail "Numeric values not applied correctly"
    fi
}

test_special_characters_in_motd() {
    setup_test "Special characters in MOTD"
    
    export MOTD='Welcome! "Quotes" & <special> chars'
    "${SCRIPT_DIR}/../scripts/generate-config.sh"
    
    if assert_json_value ".server.motd" 'Welcome! "Quotes" & <special> chars'; then
        pass
    else
        fail "Special characters not handled correctly"
    fi
}

test_boolean_values() {
    setup_test "Boolean values"
    
    export ENABLE_PVP=false
    "${SCRIPT_DIR}/../scripts/generate-config.sh"
    
    if assert_json_value ".server.pvp" "false"; then
        pass
    else
        fail "Boolean values not applied correctly"
    fi
}

test_dry_run_mode() {
    setup_test "Dry run mode"
    
    export DRY_RUN=true
    export SERVER_NAME="Test Server"
    
    output=$("${SCRIPT_DIR}/../scripts/generate-config.sh" 2>&1)
    
    if [[ "$output" == *"[DRY_RUN]"* ]] && [[ ! -f "$CONFIG_OUTPUT" ]]; then
        pass
    else
        fail "Dry run mode should not create files"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=============================================="
    echo "Config Generator Unit Tests"
    echo "=============================================="
    echo ""
    
    test_default_values
    test_custom_server_name
    test_numeric_values
    test_special_characters_in_motd
    test_boolean_values
    test_dry_run_mode
    
    echo ""
    echo "=============================================="
    echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
    echo "=============================================="
    
    if [[ $FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
