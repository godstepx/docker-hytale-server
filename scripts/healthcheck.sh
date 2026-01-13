#!/usr/bin/env bash
# =============================================================================
# Health Check Script
# =============================================================================
# Verifies the Hytale server is running and healthy.
# Used by Docker HEALTHCHECK directive.
#
# Exit codes:
#   0 - Healthy
#   1 - Unhealthy
# =============================================================================

set -euo pipefail

readonly DATA_DIR="${DATA_DIR:-/data}"
readonly PID_FILE="${DATA_DIR}/server.pid"
readonly SERVER_PORT="${SERVER_PORT:-5520}"

# Check if Java process is running
check_process() {
    if pgrep -f "java.*HytaleServer" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

# Check if UDP port is listening
check_port() {
    # Use ss if available, fallback to netstat
    if command -v ss > /dev/null 2>&1; then
        if ss -uln | grep -q ":${SERVER_PORT} "; then
            return 0
        fi
    elif command -v netstat > /dev/null 2>&1; then
        if netstat -uln | grep -q ":${SERVER_PORT} "; then
            return 0
        fi
    else
        # If neither available, just check process
        return 0
    fi
    
    return 1
}

# Check PID file if it exists
check_pidfile() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        return 1
    fi
    
    # No PID file, check process directly
    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Check process is running
    if ! check_process; then
        echo "UNHEALTHY: Java process not running"
        exit 1
    fi
    
    # Check PID file
    if ! check_pidfile; then
        echo "UNHEALTHY: PID file exists but process not running"
        exit 1
    fi
    
    # Check port (optional, may fail during startup)
    if ! check_port; then
        echo "UNHEALTHY: UDP port not listening"
        exit 1
    fi
    
    echo "HEALTHY"
    exit 0
}

main "$@"
