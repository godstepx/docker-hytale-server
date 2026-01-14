#!/usr/bin/env bash
# =============================================================================
# Download Adapter - Hytale Server Files Management
# =============================================================================
# Handles obtaining server files via multiple methods:
#   1. MANUAL: User provides files via volume mount (no auth needed)
#   2. CLI: Official Hytale Downloader CLI with OAuth2 (recommended)
#   3. LAUNCHER_PATH: Copy from local Hytale launcher installation
#
# Environment Variables:
#   DOWNLOAD_MODE: manual|cli|auto (default: auto)
#   HYTALE_CLI_URL: Override CLI download URL
#   LAUNCHER_PATH: Path to local Hytale launcher installation
#
# Usage: download.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=log-utils.sh
source "${SCRIPT_DIR}/log-utils.sh"

# Configuration
readonly DATA_DIR="${DATA_DIR:-/data}"
readonly CLI_DIR="${DATA_DIR}/.hytale-cli"
readonly AUTH_CACHE="${DATA_DIR}/.auth"
readonly SERVER_DIR="${DATA_DIR}/server"
readonly ASSETS_FILE="${DATA_DIR}/Assets.zip"
readonly VERSION_FILE="${DATA_DIR}/.version"

# Download mode: manual, cli, auto
readonly DOWNLOAD_MODE="${DOWNLOAD_MODE:-auto}"

# Hytale CLI download URL (Linux & Windows)
readonly CLI_DOWNLOAD_URL="${HYTALE_CLI_URL:-https://downloader.hytale.com/hytale-downloader.zip}"

# Launcher installation paths (for copying files)
readonly LAUNCHER_PATH="${LAUNCHER_PATH:-}"

# Download settings
readonly MAX_RETRIES="${DOWNLOAD_MAX_RETRIES:-5}"
readonly INITIAL_BACKOFF="${DOWNLOAD_INITIAL_BACKOFF:-2}"
readonly PATCHLINE="${HYTALE_PATCHLINE:-release}"
CLI_LAST_ERROR=""

# =============================================================================
# Helper Functions
# =============================================================================

calculate_backoff() {
    local attempt="$1"
    local base_backoff=$((INITIAL_BACKOFF * (2 ** (attempt - 1))))
    local jitter=$((RANDOM % 5))
    echo $((base_backoff + jitter))
}

# =============================================================================
# CLI Management
# =============================================================================

detect_cli_binary() {
    # Try platform-specific binary names
    local candidates=(
        "${CLI_DIR}/hytale-downloader-linux-amd64"
        "${CLI_DIR}/hytale-downloader-linux-arm64"
        "${CLI_DIR}/hytale-downloader"
    )
    
    for candidate in "${candidates[@]}"; do
        if [[ -f "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done
    
    # Return empty string but success (caller checks output)
    echo ""
    return 0
}

download_cli() {
    log_debug "Downloading Hytale CLI..."
    
    mkdir -p "$CLI_DIR"
    local temp_zip
    temp_zip=$(mktemp)
    
    local attempt=1
    while [[ $attempt -le $MAX_RETRIES ]]; do
        log_debug "Download attempt $attempt/$MAX_RETRIES..."
        
        if curl -fsSL -o "$temp_zip" "$CLI_DOWNLOAD_URL"; then
            log_debug "Extracting CLI..."
            unzip -o -q "$temp_zip" -d "$CLI_DIR"
            
            # Make all potential binaries executable
            chmod +x "${CLI_DIR}"/hytale-downloader* 2>/dev/null || true
            
            rm -f "$temp_zip"
            
            # Verify we can find the binary
            local binary
            binary=$(detect_cli_binary)
            if [[ -n "$binary" ]]; then
                log_debug "CLI ready: $(basename "$binary")"
                return 0
            else
                die "CLI extracted but no executable found in $CLI_DIR"
            fi
        fi
        
        local backoff
        backoff=$(calculate_backoff "$attempt")
        log_warn "Download failed, retrying in ${backoff}s..."
        sleep "$backoff"
        ((attempt++))
    done
    
    rm -f "$temp_zip"
    die "Failed to download Hytale CLI after $MAX_RETRIES attempts"
}

get_cli_binary() {
    local binary
    binary=$(detect_cli_binary)
    if [[ -z "$binary" ]]; then
        die "CLI binary not found. Run download first."
    fi
    echo "$binary"
}

ensure_cli() {
    local binary
    binary=$(detect_cli_binary)
    
    if [[ -z "$binary" ]]; then
        download_cli
    else
        log_debug "CLI already present at $binary"
        
        # Optional: Check for CLI updates
        if [[ "${SKIP_CLI_UPDATE_CHECK:-false}" != "true" ]]; then
            log_debug "Checking for CLI updates..."
            HOME="$AUTH_CACHE" XDG_CONFIG_HOME="$AUTH_CACHE" "$binary" -check-update 2>/dev/null || true
        fi
    fi
}

# Run CLI and return its stdout with auth cache applied
run_cli_command() {
    local cli_bin="$1"
    shift
    HOME="$AUTH_CACHE" XDG_CONFIG_HOME="$AUTH_CACHE" "$cli_bin" "$@"
}

# =============================================================================
# Server Files Check
# =============================================================================

check_existing_files() {
    local server_jar="${SERVER_DIR}/HytaleServer.jar"
    
    if [[ -f "$server_jar" && -f "$ASSETS_FILE" ]]; then
        log_info "Server files already exist"
        
        if [[ "${FORCE_DOWNLOAD:-false}" == "true" ]]; then
            log_info "FORCE_DOWNLOAD=true, re-downloading..."
            return 1
        fi
        
        if [[ "${CHECK_UPDATES:-true}" == "true" ]]; then
            local cli_bin
            cli_bin=$(detect_cli_binary)
            if [[ -n "$cli_bin" ]]; then
                log_info "Checking for updates..."
                local current_version
                # Use timeout to prevent hanging on network issues
                current_version=$(timeout 10s run_cli_command "$cli_bin" -print-version 2>/dev/null || echo "unknown")
                if [[ "$current_version" != "unknown" ]]; then
                    log_info "Latest version available: $current_version"
                else
                    log_warn "Could not check for updates (timeout or network issue)"
                fi
                # TODO: Compare with installed version
            fi
        fi
        
        return 0
    fi
    
    return 1
}

# =============================================================================
# Download with Device Authorization
# =============================================================================

run_cli_download() {
    local cli_bin="$1"
    shift

    local log_file
    log_file=$(mktemp)
    CLI_LAST_ERROR=""

    if "$cli_bin" "$@" 2>&1 | tee "$log_file"; then
        rm -f "$log_file"
        return 0
    fi

    if grep -qi "oauth.accounts.hytale.com" "$log_file" || grep -qi "authenticate" "$log_file"; then
        local auth_url
        auth_url=$(grep -oE "https://oauth.accounts.hytale.com[^[:space:]]*" "$log_file" | head -n 1)
        if [[ -n "$auth_url" ]]; then
            echo "$auth_url" > "${DATA_DIR}/AUTH_LINK.url"
            log_info "Auth URL exported to ${DATA_DIR}/AUTH_LINK.url"
        fi
        rm -f "$log_file"
        return 10
    fi

    CLI_LAST_ERROR=$(grep -m1 -E "context deadline exceeded|Client.Timeout|error fetching manifest|could not get signed URL" "$log_file" | sed 's/^[[:space:]]*//')
    if [[ -z "$CLI_LAST_ERROR" ]]; then
        CLI_LAST_ERROR=$(tail -n 5 "$log_file" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')
    fi

    rm -f "$log_file"
    return 1
}

download_server_files() {
    log_info "Starting server file download..."
    
    # Ensure auth cache directory exists
    mkdir -p "$AUTH_CACHE"
    
    # Set HOME to auth cache so CLI stores tokens there
    export HOME="$AUTH_CACHE"
    export XDG_CONFIG_HOME="$AUTH_CACHE"
    
    local download_args=(
        "-download-path" "${DATA_DIR}/game.zip"
    )
    
    # Add patchline if not release
    if [[ "$PATCHLINE" != "release" ]]; then
        download_args+=("-patchline" "$PATCHLINE")
    fi
    
    log_info "Downloading server files (first run may require OAuth)..."
    
    # Get CLI binary path
    local cli_bin
    cli_bin=$(get_cli_binary)
    
    local attempt=1
    local success=false
    local auth_needed=false
    local last_error=""

    while [[ $attempt -le $MAX_RETRIES ]]; do
        log_debug "Download attempt $attempt/$MAX_RETRIES..."
        if run_cli_download "$cli_bin" "${download_args[@]}"; then
            success=true
            break
        fi

        local result=$?
        if [[ $result -eq 10 ]]; then
            auth_needed=true
            break
        fi
        last_error="$CLI_LAST_ERROR"
        if [[ $attempt -ge $MAX_RETRIES ]]; then
            break
        fi

        local backoff
        backoff=$(calculate_backoff "$attempt")
        log_warn "Download attempt ${attempt} failed${last_error:+: ${last_error}}. Retrying in ${backoff}s..."
        sleep "$backoff"
        ((attempt++))
    done

    if [[ "$auth_needed" == "true" ]]; then
        die "Authentication required. Open the URL in ${DATA_DIR}/AUTH_LINK.url, complete login, and restart the container."
    fi

    if [[ "$success" == "false" ]]; then
        local error_message="Failed to download Hytale server files after $MAX_RETRIES attempts."
        if [[ -n "$last_error" ]]; then
            error_message+=" Last error: ${last_error}."
        fi
        error_message+=" Check your network connectivity or use LAUNCHER_PATH / DOWNLOAD_MODE=manual to supply files."
        die "$error_message"
    fi

    # If successful, clear any old auth link file
    if [[ -f "${DATA_DIR}/AUTH_LINK.url" ]]; then
        printf "" > "${DATA_DIR}/AUTH_LINK.url" 2>/dev/null || true
    fi
    
    log_info "Download complete, extracting..."
    
    # Extract the downloaded archive
    local game_zip="${DATA_DIR}/game.zip"
    if [[ -f "$game_zip" ]]; then
        unzip -o -q "$game_zip" -d "$DATA_DIR"
        rm -f "$game_zip"
        
        # Move files to expected locations
        if [[ -d "${DATA_DIR}/Server" ]]; then
            log_info "Moving Server files from ${DATA_DIR}/Server to ${SERVER_DIR}..."
            # Move contents, not the directory itself, to avoid nesting
            cp -r "${DATA_DIR}/Server"/. "$SERVER_DIR"/
            rm -rf "${DATA_DIR}/Server"
        fi
        if [[ -f "${DATA_DIR}/Assets.zip" ]]; then
            # Already in the right place
            true
        fi
        
        save_version_info "cli"
        log_info "Server files ready!"
    else
        die "Expected game.zip not found after download"
    fi
}

# =============================================================================
# Version Tracking
# =============================================================================

save_version_info() {
    local source="$1"
    local version="unknown"
    
    local cli_bin
    cli_bin=$(detect_cli_binary)
    if [[ -n "$cli_bin" ]]; then
        version=$(run_cli_command "$cli_bin" -print-version 2>/dev/null || echo "unknown")
    fi
    
    cat > "$VERSION_FILE" <<EOF
{
  "version": "$version",
  "source": "$source",
  "patchline": "$PATCHLINE",
  "downloaded_at": "$(date -Iseconds)"
}
EOF
    log_info "Version info saved: $version ($source)"
}

get_installed_version() {
    if [[ -f "$VERSION_FILE" ]]; then
        jq -r '.version // "unknown"' "$VERSION_FILE" 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

# =============================================================================
# Manual Mode - User Provides Files
# =============================================================================

show_manual_instructions() {
    log_separator
    log_error "Server files not found!"
    log_separator
    log_info ""
    log_info "Please provide server files using one of these methods:"
    log_info ""
    log_info "Option 1: Copy from your Hytale Launcher installation"
    log_info "  Source locations:"
    log_info "    Windows: %appdata%\\Hytale\\install\\release\\package\\game\\latest"
    log_info "    Linux:   \$XDG_DATA_HOME/Hytale/install/release/package/game/latest"
    log_info "    MacOS:   ~/Application Support/Hytale/install/release/package/game/latest"
    log_info ""
    log_info "  Copy 'Server/' folder and 'Assets.zip' to your data volume:"
    log_info "    docker cp ./Server hytale-server:/data/server"
    log_info "    docker cp ./Assets.zip hytale-server:/data/Assets.zip"
    log_info ""
    log_info "Option 2: Use Hytale Downloader CLI"
    log_info "  Set HYTALE_CLI_URL environment variable to the CLI download URL"
    log_info "  (Get URL from: https://support.hytale.com/hc/en-us/articles/Hytale-Server-Manual)"
    log_info ""
    log_info "Option 3: Mount launcher directory directly"
    log_info "  docker run -v /path/to/Hytale/install/release/package/game/latest:/launcher:ro \\"
    log_info "             -e LAUNCHER_PATH=/launcher \\"
    log_info "             -v hytale-data:/data ..."
    log_info ""
    log_separator
}

# =============================================================================
# Launcher Copy Mode
# =============================================================================

copy_from_launcher() {
    if [[ -z "$LAUNCHER_PATH" ]]; then
        return 1
    fi
    
    log_info "Copying server files from launcher: $LAUNCHER_PATH"
    
    local launcher_server="${LAUNCHER_PATH}/Server"
    local launcher_assets="${LAUNCHER_PATH}/Assets.zip"
    
    if [[ ! -d "$launcher_server" ]]; then
        log_error "Server directory not found at: $launcher_server"
        return 1
    fi
    
    if [[ ! -f "$launcher_assets" ]]; then
        log_error "Assets.zip not found at: $launcher_assets"
        return 1
    fi
    
    # Ensure server dir exists and is empty
    rm -rf "$SERVER_DIR"
    mkdir -p "$SERVER_DIR"
    
    log_info "Copying Server files..."
    cp -r "$launcher_server"/. "$SERVER_DIR"/
    
    log_info "Copying Assets.zip..."
    cp "$launcher_assets" "$ASSETS_FILE"
    
    save_version_info "launcher"
    log_info "Server files copied successfully!"
    return 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Mode is already logged in entrypoint.sh, skip here
    log_debug "Download mode: $DOWNLOAD_MODE"
    
    # DRY_RUN mode
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log_info "[DRY_RUN] Would obtain Hytale server files"
        log_info "[DRY_RUN] Download mode: $DOWNLOAD_MODE"
        log_info "[DRY_RUN] CLI URL: ${CLI_DOWNLOAD_URL:-<not set>}"
        log_info "[DRY_RUN] Launcher path: ${LAUNCHER_PATH:-<not set>}"
        log_info "[DRY_RUN] Patchline: $PATCHLINE"
        log_info "[DRY_RUN] Server dir: $SERVER_DIR"
        log_info "[DRY_RUN] Assets: $ASSETS_FILE"
        return 0
    fi
    
    # Ensure directories exist
    mkdir -p "$DATA_DIR" "$SERVER_DIR"
    
    # Check if files already exist
    if check_existing_files; then
        log_info "Using existing server files (version: $(get_installed_version))"
        return 0
    fi
    
    # Determine how to obtain files based on mode
    case "$DOWNLOAD_MODE" in
        manual)
            show_manual_instructions
            die "Server files must be provided manually. See instructions above."
            ;;
        
        launcher)
            if copy_from_launcher; then
                log_info "Server files ready!"
                return 0
            else
                die "Failed to copy from launcher. Check LAUNCHER_PATH."
            fi
            ;;
        
        cli)
            if [[ -z "$CLI_DOWNLOAD_URL" ]]; then
                log_error "HYTALE_CLI_URL not set!"
                log_info "Get the CLI download URL from the official Hytale Server Manual:"
                log_info "https://support.hytale.com/hc/en-us/articles/Hytale-Server-Manual"
                die "Set HYTALE_CLI_URL environment variable and try again."
            fi
            ensure_cli
            download_server_files
            ;;
        
        auto|*)
            # Auto mode: Try methods in order of preference
            log_debug "Auto-detecting download method..."
            
            # 1. Try launcher path if set
            if [[ -n "$LAUNCHER_PATH" ]]; then
                log_info "Trying launcher copy..."
                if copy_from_launcher; then
                    log_info "Server files ready!"
                    return 0
                fi
                log_warn "Launcher copy failed, trying next method..."
            fi
            
            # 2. Try CLI if URL is set
            if [[ -n "$CLI_DOWNLOAD_URL" ]]; then
                log_debug "Using CLI download..."
                ensure_cli
                download_server_files
                log_info "Server files ready!"
                return 0
            fi
            
            # 3. No automatic method available - show instructions
            show_manual_instructions
            die "No automatic download method available. See instructions above."
            ;;
    esac
    
    log_info "Server files ready!"
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
