#!/bin/bash
# Test script for docker-hytale-server options

IMAGE="ghcr.io/godstepx/docker-hytale-server:latest"
PASS=0
FAIL=0

run_test() {
    local name="$1"
    shift
    echo ""
    echo "=== TEST: $name ==="
    if docker run --rm "$@" $IMAGE; then
        echo "✓ PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "✗ FAIL: $name (exit code: $?)"
        FAIL=$((FAIL + 1))
    fi
}

echo "Testing docker-hytale-server options"
echo "====================================="

# Basic dry run
run_test "Basic DRY_RUN" -e DRY_RUN=true

# Log levels
run_test "LOG_LEVEL=DEBUG" -e DRY_RUN=true -e CONTAINER_LOG_LEVEL=DEBUG
run_test "LOG_LEVEL=WARN" -e DRY_RUN=true -e CONTAINER_LOG_LEVEL=WARN
run_test "LOG_LEVEL=ERROR" -e DRY_RUN=true -e CONTAINER_LOG_LEVEL=ERROR

# Download modes
run_test "MODE=manual" -e DRY_RUN=true -e DOWNLOAD_MODE=manual
run_test "MODE=cli" -e DRY_RUN=true -e DOWNLOAD_MODE=cli
run_test "MODE=launcher" -e DRY_RUN=true -e DOWNLOAD_MODE=launcher

# Server options
run_test "AUTH_MODE=offline" -e DRY_RUN=true -e AUTH_MODE=offline
run_test "DISABLE_SENTRY=true" -e DRY_RUN=true -e DISABLE_SENTRY=true
run_test "ALLOW_OP=true" -e DRY_RUN=true -e ALLOW_OP=true
run_test "ENABLE_BACKUPS=true" -e DRY_RUN=true -e ENABLE_BACKUPS=true

# Java options
run_test "Custom JVM memory" -e DRY_RUN=true -e JAVA_XMS=2G -e JAVA_XMX=8G
run_test "Custom JAVA_OPTS" -e DRY_RUN=true -e JAVA_OPTS="-Dfoo=bar"

# Network options
run_test "Custom port" -e DRY_RUN=true -e SERVER_PORT=5521 -e BIND_ADDRESS=127.0.0.1

# CLI options
run_test "SKIP_CLI_UPDATE_CHECK" -e DRY_RUN=true -e SKIP_CLI_UPDATE_CHECK=true
run_test "CHECK_UPDATES" -e DRY_RUN=true -e CHECK_UPDATES=true

# Verify bundled CLI exists
echo ""
echo "=== TEST: Bundled CLI exists ==="
if docker run --rm --entrypoint /bin/sh $IMAGE -c "ls -la /opt/hytale/cli/ && ls /opt/hytale/cli/hytale-downloader-* >/dev/null 2>&1"; then
    echo "✓ PASS: Bundled CLI exists"
    PASS=$((PASS + 1))
else
    echo "✗ FAIL: Bundled CLI missing"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "====================================="
echo "Results: $PASS passed, $FAIL failed"
echo "====================================="

exit $FAIL
