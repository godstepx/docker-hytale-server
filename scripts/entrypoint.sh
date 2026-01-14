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
# Fix Volume Permissions (runs as root, then drops privileges)
# =============================================================================

fix_permissions() {
    if [[ "$(id -u)" == "0" ]]; then
        log_info "Fixing volume permissions..."
        chown -R hytale:hytale /data 2>/dev/null || true
        chown -R hytale:hytale /opt/hytale 2>/dev/null || true
        
        # Create a persistent machine UUID for potential future use
        local uuid_file="/data/.machine-uuid"
        if [[ ! -f "$uuid_file" ]]; then
            log_info "Generating persistent machine UUID..."
            cat /proc/sys/kernel/random/uuid > "$uuid_file"
            chmod 644 "$uuid_file"
            chown hytale:hytale "$uuid_file"
        fi
        
        log_info "Dropping privileges to hytale user..."
        exec su-exec hytale "$0" "$@"
    fi
}

# Fix permissions and re-exec as hytale user
fix_permissions "$@"

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
readonly VERSION_FILE="${DATA_DIR}/.version"
readonly SERVER_LOG_DIR="${SERVER_DIR}/logs"
readonly AUTO_AUTH_DEVICE_ON_START="${AUTO_AUTH_DEVICE_ON_START:-true}"
readonly AUTO_AUTH_TRIGGER_DELAY="${AUTO_AUTH_TRIGGER_DELAY:-5}"

# Server process PID
SERVER_PID=""

# =============================================================================
# Version Info
# =============================================================================

load_version_info() {
    if [[ -f "$VERSION_FILE" ]]; then
        local version
        version=$(jq -r '.version // "unknown"' "$VERSION_FILE" 2>/dev/null || echo "unknown")
        export HYTALE_VERSION="$version"
    fi
}

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
    
    # Check if AOT cache is valid and enabled
    if [[ -f "$AOT_CACHE" && "${ENABLE_AOT:-true}" == "true" ]]; then
        log_info "Using AOT cache for faster startup"
        args+=("-XX:AOTCache=$AOT_CACHE")
        # Suppress AOT mismatch errors from causing confusion if they occur
        args+=("-Xlog:aot=error")
    else
        log_info "AOT cache disabled or not found."
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
    
    # Pre-configured session tokens (for hosting providers or persistent auth)
    # These can be obtained via the OAuth2 device flow and Game Session API
    if [[ -n "${HYTALE_SERVER_SESSION_TOKEN:-}" ]]; then
        args+=("--session-token" "$HYTALE_SERVER_SESSION_TOKEN")
        log_info "Using pre-configured session token"
    fi
    if [[ -n "${HYTALE_SERVER_IDENTITY_TOKEN:-}" ]]; then
        args+=("--identity-token" "$HYTALE_SERVER_IDENTITY_TOKEN")
    fi
    if [[ -n "${HYTALE_OWNER_UUID:-}" ]]; then
        args+=("--owner-uuid" "$HYTALE_OWNER_UUID")
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
    
    # Create a log file that the monitor can read
    local SERVER_OUTPUT_LOG="${LOG_DIR}/server-output.log"
    : > "$SERVER_OUTPUT_LOG"  # Truncate/create the log file
    
    # We use a helper process to keep the pipe open
    # Server output is written to both stdout and log file for monitoring
    tail -f "$INPUT_PIPE" | java $java_args 2>&1 | tee -a "$SERVER_OUTPUT_LOG" &
    SERVER_PID=$!
    
    echo "$SERVER_PID" > "$PID_FILE"
        log_info "Server started with PID: $SERVER_PID"

    # Background monitor for auth requirements and persistence
    (
        local auth_triggered=false
        local persistence_set=false
        local auth_trigger_time
        auth_trigger_time=$(date +%s)
        local startup_auth_sent=false
        local server_booted=false
        
        # The log file we're monitoring (created by tee above)
        local SERVER_OUTPUT_LOG="${LOG_DIR}/server-output.log"
        
        # Give server time to start producing output
        sleep 5

        find_latest_log() {
            # Prefer our known log file first
            if [[ -f "$SERVER_OUTPUT_LOG" ]]; then
                echo "$SERVER_OUTPUT_LOG"
                return 0
            fi
            
            local candidates=(
                "$LOG_DIR"
                "$SERVER_LOG_DIR"
                "$DATA_DIR"
                "$SERVER_DIR"
            )
            for dir in "${candidates[@]}"; do
                if [[ -d "$dir" ]]; then
                    local latest
                    latest=$(find "$dir" -maxdepth 2 -type f \( -name "*.log" -o -name "*.txt" \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)
                    if [[ -n "$latest" ]]; then
                        echo "$latest"
                        return 0
                    fi
                fi
            done
            return 1
        }
        
        while true; do
            # Check if server is still running
            if ! kill -0 "$SERVER_PID" 2>/dev/null; then
                break
            fi
            
            # Look for auth requirement in recent stdout (captured via logs)
            local latest_log
            latest_log=$(find_latest_log)
            
            if [[ -n "$latest_log" ]]; then
                # Check if server has finished booting
                if [[ "$server_booted" == "false" ]] && grep -q "Server Booted" "$latest_log" 2>/dev/null; then
                    server_booted=true
                    log_info "Server boot detected."
                fi
                
                # Trigger auth if needed (only once, and only after server boot)
                if [[ "$auth_triggered" == "false" && "$server_booted" == "true" ]] && grep -Eq "Server session token not available|No server tokens configured" "$latest_log" 2>/dev/null; then
                    log_info "Server requires authentication. Auto-triggering /auth login device..."
                    sleep 1  # Small delay to ensure server is ready for commands
                    echo "/auth login device" > "$INPUT_PIPE"
                    auth_triggered=true
                    auth_trigger_time=$(date +%s)
                fi
                
                # Log info about persistence limitation in Docker
                if [[ "$persistence_set" == "false" ]] && grep -Eq "Authentication successful" "$latest_log" 2>/dev/null; then
                    log_info "Auth successful!"
                    log_warn "Note: Encrypted credential storage is not available in Docker containers."
                    log_warn "Credentials will be stored in memory only and lost on restart."
                    log_warn "For persistent auth, use HYTALE_SERVER_SESSION_TOKEN and HYTALE_SERVER_IDENTITY_TOKEN environment variables."
                    persistence_set=true
                fi
            fi
            
            # Startup fallback: if server booted but no auth triggered yet
            if [[ "$AUTO_AUTH_DEVICE_ON_START" == "true" && "$auth_triggered" == "false" && "$startup_auth_sent" == "false" && "$server_booted" == "true" ]]; then
                local now
                now=$(date +%s)
                if (( now - auth_trigger_time >= AUTO_AUTH_TRIGGER_DELAY )); then
                    log_info "Startup auth fallback: triggering /auth login device..."
                    sleep 1
                    echo "/auth login device" > "$INPUT_PIPE"
                    startup_auth_sent=true
                    auth_triggered=true
                    auth_trigger_time=$now
                fi
            fi

            sleep 2
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
    load_version_info
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
