#!/usr/bin/env bash
# =============================================================================
# Hytale Server Entrypoint
# =============================================================================
# Main entrypoint script that orchestrates:
# 1. Server binary download via official Hytale CLI
# 2. Configuration generation
# 3. Server startup with proper signal handling
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=log-utils.sh
source "${SCRIPT_DIR}/log-utils.sh"

# =============================================================================
# Configuration
# =============================================================================

readonly DATA_DIR="${DATA_DIR:-/data}"
readonly SERVER_DIR="${DATA_DIR}/server"
readonly SERVER_JAR="${SERVER_DIR}/HytaleServer.jar"
readonly ASSETS_FILE="${DATA_DIR}/Assets.zip"
readonly CONFIG_FILE="${DATA_DIR}/config.json"
readonly PID_FILE="${DATA_DIR}/server.pid"
readonly LOG_DIR="${DATA_DIR}/logs"
readonly AOT_CACHE="${SERVER_DIR}/HytaleServer.aot"
readonly INPUT_PIPE="${DATA_DIR}/server.input"
readonly SERVER_AUTH_LINK="${DATA_DIR}/SERVER_AUTH.url"

# Server process PID
SERVER_PID=""

# =============================================================================
# Signal Handlers
# =============================================================================

cleanup() {
    log_info "Received shutdown signal..."
    
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        log_info "Stopping server gracefully (PID: $SERVER_PID)..."
        kill -SIGTERM "$SERVER_PID" 2>/dev/null || true
        
        # Wait for graceful shutdown (max 30 seconds)
        local timeout=30
        local count=0
        while kill -0 "$SERVER_PID" 2>/dev/null && [[ $count -lt $timeout ]]; do
            sleep 1
            ((count++))
        done
        
        # Force kill if still running
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            log_warn "Server did not stop gracefully, forcing..."
            kill -SIGKILL "$SERVER_PID" 2>/dev/null || true
        fi
    fi
    
    rm -f "$PID_FILE"
    log_info "Shutdown complete"
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

# =============================================================================
# Download
# =============================================================================

download_server() {
    log_info "Checking server files..."
    "${SCRIPT_DIR}/download.sh"
}

# =============================================================================
# Configuration
# =============================================================================

generate_configuration() {
    log_info "Generating server configuration..."
    
    export CONFIG_OUTPUT="$CONFIG_FILE"
    "${SCRIPT_DIR}/generate-config.sh"
}

# =============================================================================
# Server Startup
# =============================================================================

build_java_args() {
    local args=()
    
    # Memory settings
    local xms="${JAVA_XMS:-1G}"
    local xmx="${JAVA_XMX:-4G}"
    args+=("-Xms${xms}" "-Xmx${xmx}")
    
    # Use AOT cache if available (faster startup)
    if [[ -f "$AOT_CACHE" ]]; then
        log_info "Using AOT cache for faster startup"
        args+=("-XX:AOTCache=${AOT_CACHE}")
    fi
    
    # Recommended JVM flags for game servers
    args+=(
        "-XX:+UseG1GC"
        "-XX:+ParallelRefProcEnabled"
        "-XX:MaxGCPauseMillis=200"
        "-XX:+UnlockExperimentalVMOptions"
        "-XX:+DisableExplicitGC"
        "-XX:+AlwaysPreTouch"
        "-XX:G1NewSizePercent=30"
        "-XX:G1MaxNewSizePercent=40"
        "-XX:G1HeapRegionSize=8M"
        "-XX:G1ReservePercent=20"
        "-XX:G1HeapWastePercent=5"
        "-XX:G1MixedGCCountTarget=4"
        "-XX:InitiatingHeapOccupancyPercent=15"
        "-XX:G1MixedGCLiveThresholdPercent=90"
        "-XX:G1RSetUpdatingPauseTimePercent=5"
        "-XX:SurvivorRatio=32"
        "-XX:+PerfDisableSharedMem"
        "-XX:MaxTenuringThreshold=1"
    )
    
    # Extra JVM options from environment
    if [[ -n "${JAVA_OPTS:-}" ]]; then
        # shellcheck disable=SC2206
        args+=($JAVA_OPTS)
    fi
    
    # JAR file
    args+=("-jar" "$SERVER_JAR")
    
    # Hytale server arguments
    args+=("--assets" "$ASSETS_FILE")
    
    # Bind address
    local bind_addr="${BIND_ADDRESS:-0.0.0.0}"
    local port="${SERVER_PORT:-5520}"
    args+=("--bind" "${bind_addr}:${port}")
    
    # Auth mode
    local auth_mode="${AUTH_MODE:-authenticated}"
    args+=("--auth-mode" "$auth_mode")
    
    # Disable sentry in dev mode
    if [[ "${DISABLE_SENTRY:-false}" == "true" ]]; then
        args+=("--disable-sentry")
    fi
    
    # Accept early plugins (unsupported)
    if [[ "${ACCEPT_EARLY_PLUGINS:-false}" == "true" ]]; then
        log_warn "Early plugins enabled - this is unsupported and may cause stability issues"
        args+=("--accept-early-plugins")
    fi
    
    # Allow operator commands
    if [[ "${ALLOW_OP:-false}" == "true" ]]; then
        args+=("--allow-op")
    fi
    
    # Backups
    if [[ "${ENABLE_BACKUPS:-false}" == "true" ]]; then
        args+=("--backup")
        args+=("--backup-dir" "${BACKUP_DIR:-/data/backups}")
        args+=("--backup-frequency" "${BACKUP_FREQUENCY:-30}")
        log_info "Backups enabled: every ${BACKUP_FREQUENCY:-30} minutes to ${BACKUP_DIR:-/data/backups}"
    fi
    
    echo "${args[@]}"
}

start_server() {
    log_info "Starting Hytale server..."
    
    if [[ ! -f "$SERVER_JAR" ]]; then
        die "Server JAR not found: $SERVER_JAR"
    fi
    
    if [[ ! -f "$ASSETS_FILE" ]]; then
        die "Assets file not found: $ASSETS_FILE"
    fi
    
    mkdir -p "$LOG_DIR"
    
    local java_args
    java_args=$(build_java_args)
    
    log_info "Java command: java $java_args"
    
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log_info "[DRY_RUN] Would start server with: java $java_args"
        log_info "[DRY_RUN] Entrypoint complete, exiting."
        exit 0
    fi
    
    # Create input pipe if it doesn't exist
    if [[ ! -p "$INPUT_PIPE" ]]; then
        mkfifo "$INPUT_PIPE"
        chown hytale:hytale "$INPUT_PIPE"
        chmod 660 "$INPUT_PIPE"
    fi

    # Start server in background with input from pipe
    cd "$DATA_DIR"
    
    # We use a helper process to keep the pipe open
    tail -f "$INPUT_PIPE" | java $java_args &
    SERVER_PID=$!
    
    echo "$SERVER_PID" > "$PID_FILE"
    log_info "Server started with PID: $SERVER_PID"

    # Trigger auto-auth if required
    # This is a basic implementation that waits a bit and sends the command
    (
        sleep 10
        # Check if we should try to login
        if [[ "${AUTO_AUTH:-true}" == "true" ]]; then
            log_info "Auto-triggering server authentication..."
            echo "/auth login device" > "$INPUT_PIPE"
        fi
    ) &

    # Capture auth link from logs in the background
    (
        local auth_found=false
        while [[ "$auth_found" == "false" ]]; do
            # Look for the most recent log file
            local latest_log
            latest_log=$(ls -t "${LOG_DIR}"/*.log 2>/dev/null | head -n 1)
            
            if [[ -n "$latest_log" ]]; then
                local url
                url=$(grep -oE "https://oauth.accounts.hytale.com[^\s]*" "$latest_log" | tail -n 1)
                if [[ -n "$url" ]]; then
                    echo "$url" > "$SERVER_AUTH_LINK"
                    log_info "Server Auth URL captured to $SERVER_AUTH_LINK"
                    auth_found=true
                fi
            fi
            sleep 5
        done
    ) &
    
    # Wait for server process
    wait "$SERVER_PID"
    local exit_code=$?
    
    rm -f "$PID_FILE"
    log_info "Server exited with code: $exit_code"
    exit $exit_code
}

# =============================================================================
# Main
# =============================================================================

main() {
    log_banner
    
    # Setup directories
    mkdir -p "$DATA_DIR" "$SERVER_DIR" "$LOG_DIR"
    
    # Phase 1: Download server files (via Hytale CLI)
    download_server
    
    # Phase 2: Generate configuration (optional - Hytale uses its own config)
    # generate_configuration
    
    # Phase 3: Start server
    start_server
}

main "$@"
