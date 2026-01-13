#!/usr/bin/env bash
# =============================================================================
# Integration Tests
# =============================================================================
# Tests the Docker container in DRY_RUN mode to verify setup without 
# requiring actual server downloads.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/gamml/hytale-server}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
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

test_image_builds() {
    echo "Test: Image builds successfully"
    
    cd "${SCRIPT_DIR}/.."
    if docker build -t "${IMAGE_NAME}:test" . > /dev/null 2>&1; then
        pass
    else
        fail "Docker build failed"
        return 1
    fi
}

test_dry_run_mode() {
    echo "Test: DRY_RUN mode works"
    
    local output
    output=$(docker run --rm \
        -e DRY_RUN=true \
        -e DOWNLOAD_MODE=auto \
        "${IMAGE_NAME}:test" 2>&1) || true
    
    if [[ "$output" == *"[DRY_RUN]"* ]]; then
        pass
    else
        fail "DRY_RUN mode not detected in output"
        echo "Output: $output"
    fi
}

test_download_modes() {
    echo "Test: Download mode handling works"
    
    local output
    output=$(docker run --rm \
        -e DRY_RUN=true \
        -e DOWNLOAD_MODE=auto \
        "${IMAGE_NAME}:test" 2>&1) || true
    
    if [[ "$output" == *"[DRY_RUN]"* ]] && [[ "$output" == *"download"* ]]; then
        pass
    else
        fail "Download mode not working correctly"
        echo "Output: $output"
    fi
}

test_config_generation() {
    echo "Test: Configuration generation works in DRY_RUN"
    
    mkdir -p "${TEST_DATA_DIR}/data"
    
    local output
    output=$(docker run --rm \
        -v "${TEST_DATA_DIR}/data:/data" \
        -e DRY_RUN=true \
        -e DOWNLOAD_MODE=auto \
        -e SERVER_NAME="Test Server" \
        -e MAX_PLAYERS=50 \
        "${IMAGE_NAME}:test" 2>&1) || true
    
    # In DRY_RUN mode, we just check output
    if [[ "$output" == *"[DRY_RUN]"* ]]; then
        pass
    else
        fail "DRY_RUN output not found"
    fi
}

test_non_root_user() {
    echo "Test: Container runs as non-root"
    
    local user
    user=$(docker run --rm \
        --entrypoint id \
        "${IMAGE_NAME}:test" 2>&1)
    
    if [[ "$user" == *"uid=1000"* ]]; then
        pass
    else
        fail "Container should run as uid=1000"
        echo "User: $user"
    fi
}

test_binaries_exist() {
    echo "Test: All binaries exist and are executable"
    
    local binaries="entrypoint download generate-config healthcheck"
    local all_exist=true
    
    for binary in $binaries; do
        if ! docker run --rm \
            --entrypoint test \
            "${IMAGE_NAME}:test" -x "/opt/hytale/bin/$binary" 2>/dev/null; then
            echo "  Missing or not executable: $binary"
            all_exist=false
        fi
    done
    
    if $all_exist; then
        pass
    else
        fail "Some binaries are missing or not executable"
    fi
}

test_template_exists() {
    echo "Test: Config template exists"
    
    if docker run --rm \
        --entrypoint test \
        "${IMAGE_NAME}:test" -f "/opt/hytale/templates/server-config.template.json" 2>/dev/null; then
        pass
    else
        fail "Config template not found"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo "=============================================="
    echo "Integration Tests (TypeScript/Bun)"
    echo "=============================================="
    echo ""
    
    test_image_builds || exit 1
    test_dry_run_mode
    test_download_modes
    test_config_generation
    test_non_root_user
    test_binaries_exist
    test_template_exists
    
    echo ""
    echo "=============================================="
    echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
    echo "=============================================="
    
    # Cleanup test image
    docker rmi "${IMAGE_NAME}:test" > /dev/null 2>&1 || true
    
    if [[ $FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
