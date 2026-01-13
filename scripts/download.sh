#!/usr/bin/env bash
# =============================================================================
# Download Adapter - Hytale Downloader CLI Integration
# =============================================================================
# Handles downloading server files using the official Hytale Downloader CLI
# with OAuth2 Device Authorization flow.
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
readonly CLI_BINARY="${CLI_DIR}/hytale-downloader"
readonly AUTH_CACHE="${DATA_DIR}/.auth"
readonly SERVER_DIR="${DATA_DIR}/server"
readonly ASSETS_FILE="${DATA_DIR}/Assets.zip"

# Hytale CLI download URL (Linux)
readonly CLI_DOWNLOAD_URL="${HYTALE_CLI_URL:-https://support.hytale.com/hc/en-us/article_attachments/hytale-downloader.zip}"

# Download settings
readonly MAX_RETRIES="${DOWNLOAD_MAX_RETRIES:-5}"
readonly INITIAL_BACKOFF="${DOWNLOAD_INITIAL_BACKOFF:-2}"
readonly PATCHLINE="${HYTALE_PATCHLINE:-release}"

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

download_cli() {
    log_info "Downloading Hytale Downloader CLI..."
    
    mkdir -p "$CLI_DIR"
    local temp_zip
    temp_zip=$(mktemp)
    
    local attempt=1
    while [[ $attempt -le $MAX_RETRIES ]]; do
        log_info "Download attempt $attempt/$MAX_RETRIES..."
        
        if curl -fsSL -o "$temp_zip" "$CLI_DOWNLOAD_URL"; then
            log_info "Extracting CLI..."
            unzip -o -q "$temp_zip" -d "$CLI_DIR"
            chmod +x "${CLI_DIR}/hytale-downloader" 2>/dev/null || true
            rm -f "$temp_zip"
            log_info "CLI downloaded successfully"
            return 0
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

ensure_cli() {
    if [[ ! -x "$CLI_BINARY" ]]; then
        download_cli
    else
        log_debug "CLI already present at $CLI_BINARY"
        
        # Optional: Check for CLI updates
        if [[ "${SKIP_CLI_UPDATE_CHECK:-false}" != "true" ]]; then
            log_debug "Checking for CLI updates..."
            "$CLI_BINARY" -check-update 2>/dev/null || true
        fi
    fi
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
            log_info "Checking for updates..."
            local current_version
            current_version=$("$CLI_BINARY" -print-version 2>/dev/null || echo "unknown")
            log_info "Latest version available: $current_version"
            # TODO: Compare with installed version
        fi
        
        return 0
    fi
    
    return 1
}

# =============================================================================
# Download with Device Authorization
# =============================================================================

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
    
    log_separator
    log_info "Running Hytale Downloader..."
    log_info "If this is your first time, you will need to authorize:"
    log_separator
    
    # Run the CLI - it will handle auth interactively
    if ! "$CLI_BINARY" "${download_args[@]}"; then
        die "Hytale Downloader failed. Please check the output above."
    fi
    
    log_info "Download complete, extracting..."
    
    # Extract the downloaded archive
    local game_zip="${DATA_DIR}/game.zip"
    if [[ -f "$game_zip" ]]; then
        unzip -o -q "$game_zip" -d "$DATA_DIR"
        rm -f "$game_zip"
        
        # Move files to expected locations
        if [[ -d "${DATA_DIR}/Server" ]]; then
            mv "${DATA_DIR}/Server" "$SERVER_DIR"
        fi
        if [[ -f "${DATA_DIR}/Assets.zip" ]]; then
            # Already in the right place
            true
        fi
        
        log_info "Server files ready!"
    else
        die "Expected game.zip not found after download"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    log_info "Hytale Server File Manager"
    log_info "=========================="
    
    # DRY_RUN mode
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log_info "[DRY_RUN] Would download Hytale server files"
        log_info "[DRY_RUN] CLI URL: $CLI_DOWNLOAD_URL"
        log_info "[DRY_RUN] Patchline: $PATCHLINE"
        log_info "[DRY_RUN] Server dir: $SERVER_DIR"
        log_info "[DRY_RUN] Assets: $ASSETS_FILE"
        return 0
    fi
    
    # Ensure directories exist
    mkdir -p "$DATA_DIR" "$SERVER_DIR"
    
    # Check if files already exist
    if check_existing_files; then
        log_info "Using existing server files"
        return 0
    fi
    
    # Download CLI if needed
    ensure_cli
    
    # Download server files
    download_server_files
    
    log_info "Server files ready!"
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
