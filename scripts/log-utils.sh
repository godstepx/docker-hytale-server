#!/usr/bin/env bash
# =============================================================================
# Logging Utilities
# =============================================================================
# Provides structured logging with levels and secret masking
# Source this file in other scripts: source /opt/hytale/scripts/log-utils.sh
# =============================================================================

set -euo pipefail

# Log levels
readonly LOG_LEVEL_DEBUG=0
readonly LOG_LEVEL_INFO=1
readonly LOG_LEVEL_WARN=2
readonly LOG_LEVEL_ERROR=3

# Default log level (can be overridden via LOG_LEVEL env var)
CURRENT_LOG_LEVEL="${LOG_LEVEL:-$LOG_LEVEL_INFO}"

# ANSI colors (disabled if not a TTY)
if [[ -t 1 ]]; then
    readonly COLOR_RESET='\033[0m'
    readonly COLOR_DEBUG='\033[0;36m'  # Cyan
    readonly COLOR_INFO='\033[0;32m'   # Green
    readonly COLOR_WARN='\033[0;33m'   # Yellow
    readonly COLOR_ERROR='\033[0;31m'  # Red
else
    readonly COLOR_RESET=''
    readonly COLOR_DEBUG=''
    readonly COLOR_INFO=''
    readonly COLOR_WARN=''
    readonly COLOR_ERROR=''
fi

# Secrets to mask (populated by mask_secret function)
declare -a SECRETS_TO_MASK=()

# =============================================================================
# Core Logging Functions
# =============================================================================

_log() {
    local level="$1"
    local level_num="$2"
    local color="$3"
    local message="$4"
    
    # Skip if below current log level
    if [[ $level_num -lt $CURRENT_LOG_LEVEL ]]; then
        return 0
    fi
    
    # Mask secrets in message
    local masked_message="$message"
    for secret in "${SECRETS_TO_MASK[@]:-}"; do
        if [[ -n "$secret" ]]; then
            masked_message="${masked_message//$secret/***MASKED***}"
        fi
    done
    
    # Format: [TIMESTAMP] [LEVEL] message
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    printf '%b[%s] [%-5s] %s%b\n' \
        "$color" \
        "$timestamp" \
        "$level" \
        "$masked_message" \
        "$COLOR_RESET" >&2
}

log_debug() {
    _log "DEBUG" "$LOG_LEVEL_DEBUG" "$COLOR_DEBUG" "$*"
}

log_info() {
    _log "INFO" "$LOG_LEVEL_INFO" "$COLOR_INFO" "$*"
}

log_warn() {
    _log "WARN" "$LOG_LEVEL_WARN" "$COLOR_WARN" "$*"
}

log_error() {
    _log "ERROR" "$LOG_LEVEL_ERROR" "$COLOR_ERROR" "$*"
}

# =============================================================================
# Secret Masking
# =============================================================================

# Register a secret to be masked in all log output
mask_secret() {
    local secret="$1"
    if [[ -n "$secret" ]]; then
        SECRETS_TO_MASK+=("$secret")
    fi
}

# =============================================================================
# Utility Functions
# =============================================================================

# Log and exit with error
die() {
    log_error "$*"
    exit 1
}

# Log command execution (for debugging)
log_cmd() {
    log_debug "Executing: $*"
    "$@"
}

# Print a separator line
log_separator() {
    log_info "============================================================"
}

# Print startup banner
log_banner() {
    local version="${HYTALE_VERSION:-unknown}"
    log_separator
    log_info "Hytale Dedicated Server - Docker Container"
    log_info "Version: $version"
    log_info "Mode: ${DOWNLOAD_MODE:-direct_url}"
    log_separator
}
