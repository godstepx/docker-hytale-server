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
readonly PGID_FILE="${DATA_DIR}/server.pid.pgid"

# Server process PID and tracking
SERVER_PID=""
SERVER_PGID=""
TOKENS_LOADED=false

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
    
    # Find the Java process directly
    local java_pid
    java_pid=$(pgrep -f "HytaleServer.jar" 2>/dev/null | head -n1) || true
    
    # Prefer killing by PGID if available (kills entire pipeline)
    if [[ -n "$SERVER_PGID" && "$SERVER_PGID" != "0" ]]; then
        log_info "Stopping server gracefully (PGID: $SERVER_PGID, Java PID: $java_pid)..."
        kill -TERM -"$SERVER_PGID" 2>/dev/null || true
        
        # Wait for graceful shutdown (max 30 seconds)
        local timeout=30
        local count=0
        while pgrep -f "HytaleServer.jar" >/dev/null 2>&1 && [[ $count -lt $timeout ]]; do
            sleep 1
            ((count++))
        done
        
        # Force kill if still running
        if pgrep -f "HytaleServer.jar" >/dev/null 2>&1; then
            log_warn "Server did not stop gracefully, forcing..."
            kill -KILL -"$SERVER_PGID" 2>/dev/null || true
            pkill -KILL -f "HytaleServer.jar" 2>/dev/null || true
        fi
    elif [[ -n "$java_pid" ]]; then
        log_info "Stopping server gracefully (Java PID: $java_pid)..."
        kill -TERM "$java_pid" 2>/dev/null || true
        
        # Wait for graceful shutdown (max 30 seconds)
        local timeout=30
        local count=0
        while pgrep -f "HytaleServer.jar" >/dev/null 2>&1 && [[ $count -lt $timeout ]]; do
            sleep 1
            ((count++))
        done
        
        # Force kill if still running
        if pgrep -f "HytaleServer.jar" >/dev/null 2>&1; then
            log_warn "Server did not stop gracefully, forcing..."
            pkill -KILL -f "HytaleServer.jar" 2>/dev/null || true
        fi
    fi
    
    rm -f "$PID_FILE" "$PGID_FILE"
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
# Token Management
# =============================================================================

# Try to acquire session tokens from stored OAuth tokens
acquire_session_tokens() {
    log_info "Checking stored tokens..."
    
    # Skip if tokens already provided via environment
    if [[ -n "${HYTALE_SERVER_SESSION_TOKEN:-}" ]]; then
        log_info "[TOKEN] Using session tokens from environment variables"
        TOKENS_LOADED=true
        return 0
    fi
    
    # First validate existing OAuth tokens actually work
    # This catches expired/revoked tokens early instead of failing silently
    if "${SCRIPT_DIR}/token-manager.sh" status 2>/dev/null | grep -q "Refresh token: Present"; then
        log_info "[TOKEN] Found stored OAuth tokens, validating..."
        if ! "${SCRIPT_DIR}/token-manager.sh" validate &>/dev/null; then
            log_warn "[TOKEN] Stored OAuth tokens are invalid or expired, clearing..."
            "${SCRIPT_DIR}/token-manager.sh" clear &>/dev/null || true
            log_info "[TOKEN] Invalid tokens cleared - device authorization will be required"
            TOKENS_LOADED=false
            return 1
        fi
        log_info "[TOKEN] OAuth tokens validated successfully"
    fi
    
    # Check if token-manager can acquire tokens
    log_info "[TOKEN] Attempting to load stored credentials..."
    if "${SCRIPT_DIR}/token-manager.sh" acquire > /dev/null 2>&1; then
        log_info "[TOKEN] Tokens loaded from stored credentials"
        
        # Source the exported tokens
        if eval "$("${SCRIPT_DIR}/token-manager.sh" export 2>/dev/null)"; then
            log_info "[TOKEN] Session token: ${HYTALE_SERVER_SESSION_TOKEN:0:20}..."
            TOKENS_LOADED=true
            return 0
        fi
    fi
    
    # No stored credentials - start device auth flow if auto-auth is enabled
    # This prevents the server from starting without tokens and immediately crashing
    if [[ "${AUTO_AUTH_DEVICE_ON_START:-false}" == "true" ]]; then
        log_info "[TOKEN] No stored credentials - starting device auth flow before server start..."
        if "${SCRIPT_DIR}/token-manager.sh" auth; then
            log_info "[TOKEN] Device auth completed! Loading acquired tokens..."
            if eval "$("${SCRIPT_DIR}/token-manager.sh" export 2>/dev/null)"; then
                log_info "[TOKEN] Session token: ${HYTALE_SERVER_SESSION_TOKEN:0:20}..."
                TOKENS_LOADED=true
                return 0
            fi
        else
            log_warn "[TOKEN] Device auth flow failed or timed out"
        fi
    else
        log_info "[TOKEN] No stored credentials found - device authorization will be required"
    fi
    
    TOKENS_LOADED=false
    return 1
}

# =============================================================================
# Background Token Refresh Loop
# =============================================================================
# The session and OAuth tokens expire after ~1 hour. This background process
# monitors token expiry and refreshes them proactively to prevent player
# connection issues. If refresh fails, the server restarts to trigger new auth.

start_token_refresh_loop() {
    (
        local TOKEN_CHECK_INTERVAL=300  # Check every 5 minutes
        local REFRESH_BUFFER=600        # Refresh 10 minutes before expiry
        
        log_info "[TOKEN_REFRESH] Background token refresh started (check every ${TOKEN_CHECK_INTERVAL}s)"
        
        # Wait for server to be fully started
        sleep 30
        
        while true; do
            # Check if server is still running
            if ! pgrep -f "HytaleServer.jar" >/dev/null 2>&1; then
                log_info "[TOKEN_REFRESH] Server stopped, exiting refresh loop"
                break
            fi
            
            # Check token expiry
            local expires_at=""
            if [[ -f "${AUTH_CACHE:-/data/.auth}/server-tokens.json" ]]; then
                expires_at=$(jq -r '.expires_at // empty' "${AUTH_CACHE:-/data/.auth}/server-tokens.json" 2>/dev/null)
            fi
            
            if [[ -n "$expires_at" ]]; then
                local expires_epoch now_epoch time_left
                expires_epoch=$(date -d "$expires_at" +%s 2>/dev/null || echo 0)
                now_epoch=$(date +%s)
                time_left=$((expires_epoch - now_epoch))
                
                if (( time_left <= REFRESH_BUFFER )); then
                    log_info "[TOKEN_REFRESH] Token expires in ${time_left}s, refreshing..."
                    
                    # Try to refresh tokens
                    if "${SCRIPT_DIR}/token-manager.sh" acquire >/dev/null 2>&1; then
                        log_info "[TOKEN_REFRESH] Tokens refreshed successfully"
                        
                        # Check if the new tokens are valid
                        local new_expires_at
                        new_expires_at=$(jq -r '.expires_at // empty' "${AUTH_CACHE:-/data/.auth}/server-tokens.json" 2>/dev/null)
                        local new_expires_epoch
                        new_expires_epoch=$(date -d "$new_expires_at" +%s 2>/dev/null || echo 0)
                        
                        if (( new_expires_epoch > now_epoch + REFRESH_BUFFER )); then
                            log_info "[TOKEN_REFRESH] New token expires at: $new_expires_at"
                        else
                            log_warn "[TOKEN_REFRESH] Token refresh returned near-expiry token, forcing server restart"
                            trigger_server_restart
                            break
                        fi
                    else
                        log_error "[TOKEN_REFRESH] Failed to refresh tokens!"
                        log_info "[TOKEN_REFRESH] Triggering server restart for re-authentication..."
                        trigger_server_restart
                        break
                    fi
                else
                    local hours=$((time_left / 3600))
                    local mins=$(((time_left % 3600) / 60))
                    log_debug "[TOKEN_REFRESH] Token valid for ${hours}h ${mins}m"
                fi
            fi
            
            sleep "$TOKEN_CHECK_INTERVAL"
        done
    ) &
}

# Trigger server restart (used by token refresh loop)
trigger_server_restart() {
    local pgid
    pgid=$(cat "${PGID_FILE:-/data/server.pid.pgid}" 2>/dev/null | tr -d '-') || true
    
    if [[ -n "$pgid" && "$pgid" != "0" ]]; then
        log_info "[TOKEN_REFRESH] Killing process group PGID=$pgid..."
        kill -TERM -"$pgid" 2>/dev/null || true
        sleep 2
        kill -KILL -"$pgid" 2>/dev/null || true
    else
        log_info "[TOKEN_REFRESH] Killing Java process..."
        pkill -TERM -f "HytaleServer.jar" 2>/dev/null || true
        sleep 2
        pkill -KILL -f "HytaleServer.jar" 2>/dev/null || true
    fi
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
    # Note: Java accepts formats like 1G, 4G, 512M - NOT 1GB, 4GB, 512MB
    # We auto-fix common mistake of using GB/MB instead of G/M
    local xms="${JAVA_XMS:-1G}"
    local xmx="${JAVA_XMX:-4G}"
    
    # Strip trailing 'B' from memory values (e.g., 4GB -> 4G, 512MB -> 512M)
    xms="${xms%B}"
    xmx="${xmx%B}"
    
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
    
    # Start server with proper process tracking
    cd "$DATA_DIR"
    
    # Start the pipeline in a way we can kill all processes
    # Use setsid to create a new session and process group
    setsid bash -c "tail -f '$INPUT_PIPE' | java $java_args 2>&1 | tee -a '$SERVER_OUTPUT_LOG'" &
    SERVER_PID=$!
    
    # Give the setsid'd process time to spawn children
    sleep 2
    
    # Get the PGID - with setsid, the new session leader's PID equals its PGID
    # First try to find the actual Java process
    local java_pid
    java_pid=$(pgrep -f "HytaleServer.jar" 2>/dev/null | head -n1) || true
    
    if [[ -n "$java_pid" ]]; then
        SERVER_PGID=$(ps -o pgid= -p "$java_pid" 2>/dev/null | tr -d ' ') || true
        log_info "Found Java process PID: $java_pid, PGID: $SERVER_PGID"
    fi
    
    # Fallback: the setsid process itself becomes the session leader
    if [[ -z "$SERVER_PGID" ]]; then
        SERVER_PGID=$SERVER_PID
        log_info "Using setsid PID as PGID: $SERVER_PGID"
    fi
    
    # Save PID and PGID files
    echo "$SERVER_PID" > "$PID_FILE"
    echo "$SERVER_PGID" > "$PGID_FILE"
    
    log_info "Server started with PID: $SERVER_PID, PGID: $SERVER_PGID"
    log_info "[TOKEN] Tokens loaded before start: $TOKENS_LOADED"

    # Export TOKENS_LOADED for subshell access
    export TOKENS_LOADED

    # Background monitor for auth requirements and persistence
    (
        local auth_triggered=false
        local persistence_set=false
        local auth_trigger_time
        auth_trigger_time=$(date +%s)
        local startup_auth_sent=false
        local server_booted=false
        local tokens_preloaded="${TOKENS_LOADED:-false}"
        
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
                # We use our own device auth flow to capture and store tokens
                if [[ "$auth_triggered" == "false" && "$server_booted" == "true" ]] && grep -Eq "Server session token not available|No server tokens configured" "$latest_log" 2>/dev/null; then
                    log_info "Server requires authentication."
                    log_info "Starting device authorization flow (tokens will be saved for future restarts)..."
                    auth_triggered=true
                    auth_trigger_time=$(date +%s)
                    
                    # Run our device auth flow in a subshell
                    # This will poll for user authorization and save tokens
                    (
                        if "${SCRIPT_DIR}/token-manager.sh" auth; then
                            log_info "Authentication complete! Tokens saved."
                            log_info "[RESTART] Restarting server to apply new tokens..."
                            
                            # Kill the entire process group using negative PGID
                            local pgid
                            pgid=$(cat "/data/server.pid.pgid" 2>/dev/null | tr -d '-')
                            if [[ -n "$pgid" && "$pgid" != "0" ]]; then
                                log_info "[RESTART] Killing process group PGID=$pgid..."
                                kill -TERM -"$pgid" 2>/dev/null || true
                                sleep 1
                                # Force kill if still running
                                kill -KILL -"$pgid" 2>/dev/null || true
                            else
                                # Fallback: kill by PID
                                local pid
                                pid=$(cat "/data/server.pid" 2>/dev/null)
                                if [[ -n "$pid" ]]; then
                                    log_info "[RESTART] Fallback: killing PID=$pid..."
                                    kill -TERM "$pid" 2>/dev/null || true
                                fi
                                # Last resort: pkill
                                pkill -TERM -f "HytaleServer.jar" 2>/dev/null || true
                            fi
                        else
                            log_error "Authentication failed. Please try again."
                        fi
                    ) &
                fi
                
                # Check if server is now authenticated (either via our flow or manual)
                if [[ "$persistence_set" == "false" ]] && grep -Eq "Authentication successful" "$latest_log" 2>/dev/null; then
                    log_info "Server authenticated successfully!"
                    persistence_set=true
                fi
            fi
            
            # Startup fallback: if server booted but no auth triggered yet
            # Skip if tokens were loaded before startup
            if [[ "$tokens_preloaded" == "true" ]]; then
                # Tokens were loaded before start, no auth flow needed
                auth_triggered=true
                startup_auth_sent=true
            fi
            
            if [[ "$AUTO_AUTH_DEVICE_ON_START" == "true" && "$auth_triggered" == "false" && "$startup_auth_sent" == "false" && "$server_booted" == "true" ]]; then
                local now
                now=$(date +%s)
                if (( now - auth_trigger_time >= AUTO_AUTH_TRIGGER_DELAY )); then
                    log_info "Startup auth fallback: triggering device auth flow..."
                    startup_auth_sent=true
                    auth_triggered=true
                    auth_trigger_time=$now
                    
                    # Run our device auth flow
                    (
                        if "${SCRIPT_DIR}/token-manager.sh" auth; then
                            log_info "Authentication complete! Tokens saved."
                            log_info "[RESTART] Restarting server to apply new tokens..."
                            
                            # Kill the entire process group using negative PGID
                            local pgid
                            pgid=$(cat "/data/server.pid.pgid" 2>/dev/null | tr -d '-')
                            if [[ -n "$pgid" && "$pgid" != "0" ]]; then
                                log_info "[RESTART] Killing process group PGID=$pgid..."
                                kill -TERM -"$pgid" 2>/dev/null || true
                                sleep 1
                                kill -KILL -"$pgid" 2>/dev/null || true
                            else
                                local pid
                                pid=$(cat "/data/server.pid" 2>/dev/null)
                                if [[ -n "$pid" ]]; then
                                    log_info "[RESTART] Fallback: killing PID=$pid..."
                                    kill -TERM "$pid" 2>/dev/null || true
                                fi
                                pkill -TERM -f "HytaleServer.jar" 2>/dev/null || true
                            fi
                        fi
                    ) &
                fi
            fi

            sleep 2
        done
    ) &
    
    # Start background token refresh loop
    # This refreshes tokens before they expire to keep the server running long-term
    start_token_refresh_loop
    
    # With setsid, the original process exits immediately while children continue
    # We need to wait for the actual Java process to exit
    log_info "Waiting for server process (PGID: $SERVER_PGID)..."
    
    # Poll for Java process - when it exits, we should exit too
    while true; do
        local java_pid
        java_pid=$(pgrep -f "HytaleServer.jar" 2>/dev/null | head -n1) || true
        
        if [[ -z "$java_pid" ]]; then
            # Java is gone - check if it was a clean exit or crash
            sleep 1
            # Double check
            java_pid=$(pgrep -f "HytaleServer.jar" 2>/dev/null | head -n1) || true
            if [[ -z "$java_pid" ]]; then
                log_info "Server process has exited."
                break
            fi
        fi
        
        sleep 5
    done
    
    local exit_code=0
    rm -f "$PID_FILE" "$PGID_FILE"
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
    
    # Phase 2: Try to acquire session tokens from stored OAuth credentials
    # This enables persistent auth across restarts without re-authorization
    acquire_session_tokens || true
    
    # Phase 3: Generate configuration (optional - Hytale uses its own config)
    # generate_configuration
    
    # Phase 4: Start server
    start_server
}

main "$@"
