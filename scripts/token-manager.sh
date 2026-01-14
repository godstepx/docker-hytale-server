#!/usr/bin/env bash
# =============================================================================
# Token Manager - Persistent Server Authentication
# =============================================================================
# Manages OAuth tokens and game sessions for the Hytale server.
# 
# This script handles the complete authentication flow:
# 1. Device Authorization Flow (interactive, first-time setup)
# 2. Token refresh using stored refresh tokens
# 3. Game session creation for server startup
#
# The tokens are stored in $AUTH_CACHE (default: /data/.auth)
# After first auth, the server can restart without re-authorization
# for up to 30 days (refresh token lifetime).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=log-utils.sh
source "${SCRIPT_DIR}/log-utils.sh"

# Configuration
readonly DATA_DIR="${DATA_DIR:-/data}"
readonly AUTH_CACHE="${DATA_DIR}/.auth"
readonly TOKEN_FILE="${AUTH_CACHE}/server-tokens.json"
readonly OAUTH_TOKEN_FILE="${AUTH_CACHE}/.oauth-tokens.json"

# OAuth endpoints
readonly OAUTH_DEVICE_URL="https://oauth.accounts.hytale.com/oauth2/device/auth"
readonly OAUTH_TOKEN_URL="https://oauth.accounts.hytale.com/oauth2/token"
readonly PROFILES_URL="https://account-data.hytale.com/my-account/get-profiles"
readonly SESSION_URL="https://sessions.hytale.com/game-session/new"
readonly CLIENT_ID="hytale-server"
readonly SCOPES="openid offline auth:server"

# =============================================================================
# Token Storage Functions
# =============================================================================

# Check if we have stored OAuth tokens (from CLI or previous auth)
has_oauth_tokens() {
    if [[ -f "$OAUTH_TOKEN_FILE" ]]; then
        local refresh_token
        refresh_token=$(jq -r '.refresh_token // empty' "$OAUTH_TOKEN_FILE" 2>/dev/null)
        [[ -n "$refresh_token" ]]
        return $?
    fi
    return 1
}

# Get stored OAuth tokens
get_oauth_tokens() {
    if [[ -f "$OAUTH_TOKEN_FILE" ]]; then
        cat "$OAUTH_TOKEN_FILE"
    else
        echo "{}"
    fi
}

# Save OAuth tokens
save_oauth_tokens() {
    local access_token="$1"
    local refresh_token="$2"
    local expires_in="${3:-3600}"
    
    mkdir -p "$AUTH_CACHE"
    
    local expires_at
    expires_at=$(date -d "+${expires_in} seconds" -Iseconds 2>/dev/null || date -v+${expires_in}S -Iseconds 2>/dev/null || echo "")
    
    jq -n \
        --arg at "$access_token" \
        --arg rt "$refresh_token" \
        --arg ea "$expires_at" \
        '{access_token: $at, refresh_token: $rt, expires_at: $ea}' > "$OAUTH_TOKEN_FILE"
    
    chmod 600 "$OAUTH_TOKEN_FILE"
    log_info "OAuth tokens saved"
}

# Check if we have valid game session tokens
has_session_tokens() {
    if [[ -f "$TOKEN_FILE" ]]; then
        local session_token expires_at
        session_token=$(jq -r '.session_token // empty' "$TOKEN_FILE" 2>/dev/null)
        expires_at=$(jq -r '.expires_at // empty' "$TOKEN_FILE" 2>/dev/null)
        
        if [[ -n "$session_token" && -n "$expires_at" ]]; then
            # Check if not expired (with 5 minute buffer)
            local expires_epoch now_epoch
            expires_epoch=$(date -d "$expires_at" +%s 2>/dev/null || echo 0)
            now_epoch=$(date +%s)
            
            if (( expires_epoch > now_epoch + 300 )); then
                return 0
            fi
        fi
    fi
    return 1
}

# Validate OAuth tokens by attempting to fetch profiles
# Returns 0 if tokens are valid, 1 if expired/invalid
validate_oauth_tokens() {
    if ! has_oauth_tokens; then
        return 1
    fi
    
    log_info "Validating stored OAuth tokens..."
    
    local stored_tokens access_token
    stored_tokens=$(get_oauth_tokens)
    access_token=$(echo "$stored_tokens" | jq -r '.access_token // empty')
    
    # If no access token, try to refresh first
    if [[ -z "$access_token" ]]; then
        access_token=$(refresh_oauth_tokens 2>/dev/null) || return 1
    fi
    
    # Try to fetch profiles as a validation check
    local response http_code
    response=$(curl -sS -w "\n%{http_code}" -X GET "$PROFILES_URL" \
        -H "Authorization: Bearer ${access_token}" 2>&1)
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')
    
    case "$http_code" in
        200)
            log_info "OAuth tokens are valid"
            return 0
            ;;
        401|403)
            log_warn "OAuth tokens rejected (HTTP $http_code) - tokens may be expired or revoked"
            return 1
            ;;
        *)
            log_warn "Unexpected response validating tokens (HTTP $http_code)"
            # Don't fail on network errors, only auth errors
            if [[ "$http_code" =~ ^[45] ]]; then
                return 1
            fi
            return 0
            ;;
    esac
}

# Clear all stored tokens (for recovery from invalid state)
clear_tokens() {
    log_info "Clearing stored tokens..."
    rm -f "$TOKEN_FILE" "$OAUTH_TOKEN_FILE"
    log_info "Tokens cleared"
}

# Get stored session tokens
get_session_tokens() {
    if [[ -f "$TOKEN_FILE" ]]; then
        cat "$TOKEN_FILE"
    else
        echo "{}"
    fi
}

# Save game session tokens
save_session_tokens() {
    local session_token="$1"
    local identity_token="$2"
    local profile_uuid="$3"
    local expires_at="$4"
    
    mkdir -p "$AUTH_CACHE"
    
    jq -n \
        --arg st "$session_token" \
        --arg it "$identity_token" \
        --arg pu "$profile_uuid" \
        --arg ea "$expires_at" \
        '{session_token: $st, identity_token: $it, profile_uuid: $pu, expires_at: $ea}' > "$TOKEN_FILE"
    
    chmod 600 "$TOKEN_FILE"
    log_info "Session tokens saved (expires: $expires_at)"
}

# =============================================================================
# OAuth Token Refresh
# =============================================================================

refresh_oauth_tokens() {
    log_info "Refreshing OAuth tokens..."
    
    local refresh_token
    refresh_token=$(jq -r '.refresh_token // empty' "$OAUTH_TOKEN_FILE" 2>/dev/null)
    
    if [[ -z "$refresh_token" ]]; then
        log_error "No refresh token available"
        return 1
    fi
    
    local response http_code
    response=$(curl -sS -w "\n%{http_code}" -X POST "$OAUTH_TOKEN_URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "client_id=${CLIENT_ID}" \
        -d "grant_type=refresh_token" \
        -d "refresh_token=${refresh_token}" 2>&1)
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')
    
    # Handle HTTP 401/403 by clearing tokens - they're invalid/revoked
    if [[ "$http_code" == "401" || "$http_code" == "403" ]]; then
        log_warn "Token refresh rejected (HTTP $http_code) - clearing invalid tokens"
        log_warn "This may be due to: expired refresh token (30+ days), revoked access, or hardware ID mismatch"
        rm -f "$OAUTH_TOKEN_FILE" "$TOKEN_FILE"
        return 1
    fi
    
    local error
    error=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
    
    if [[ -n "$error" ]]; then
        log_error "Token refresh failed: $error"
        log_error "Response: $response"
        # Clear tokens on specific OAuth errors that indicate invalid tokens
        if [[ "$error" == "invalid_grant" || "$error" == "unauthorized_client" ]]; then
            log_warn "Clearing invalid tokens..."
            rm -f "$OAUTH_TOKEN_FILE" "$TOKEN_FILE"
        fi
        return 1
    fi
    
    local access_token new_refresh_token expires_in
    access_token=$(echo "$response" | jq -r '.access_token // empty')
    new_refresh_token=$(echo "$response" | jq -r '.refresh_token // empty')
    expires_in=$(echo "$response" | jq -r '.expires_in // 3600')
    
    if [[ -z "$access_token" ]]; then
        log_error "No access token in refresh response"
        return 1
    fi
    
    # Use new refresh token if provided, otherwise keep old one
    if [[ -z "$new_refresh_token" ]]; then
        new_refresh_token="$refresh_token"
    fi
    
    save_oauth_tokens "$access_token" "$new_refresh_token" "$expires_in"
    echo "$access_token"
}

# =============================================================================
# Game Session Management
# =============================================================================

get_game_profiles() {
    local access_token="$1"
    
    local response
    response=$(curl -sS -X GET "$PROFILES_URL" \
        -H "Authorization: Bearer ${access_token}" 2>&1)
    
    echo "$response"
}

create_game_session() {
    local access_token="$1"
    local profile_uuid="$2"
    
    log_info "Creating game session for profile: $profile_uuid"
    
    local response
    response=$(curl -sS -X POST "$SESSION_URL" \
        -H "Authorization: Bearer ${access_token}" \
        -H "Content-Type: application/json" \
        -d "{\"uuid\": \"${profile_uuid}\"}" 2>&1)
    
    local error
    error=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
    
    if [[ -n "$error" ]]; then
        log_error "Failed to create game session: $error"
        return 1
    fi
    
    local session_token identity_token expires_at
    session_token=$(echo "$response" | jq -r '.sessionToken // empty')
    identity_token=$(echo "$response" | jq -r '.identityToken // empty')
    expires_at=$(echo "$response" | jq -r '.expiresAt // empty')
    
    if [[ -z "$session_token" || -z "$identity_token" ]]; then
        log_error "Invalid session response: $response"
        return 1
    fi
    
    save_session_tokens "$session_token" "$identity_token" "$profile_uuid" "$expires_at"
    echo "$response"
}

# =============================================================================
# Main Token Acquisition Flow
# =============================================================================

# Try to get valid session tokens, creating new ones if needed
acquire_session_tokens() {
    # First check if we already have valid session tokens
    if has_session_tokens; then
        log_info "Using existing valid session tokens"
        get_session_tokens
        return 0
    fi
    
    log_info "No valid session tokens, attempting to create new ones..."
    
    # Check if we have OAuth tokens to work with
    if ! has_oauth_tokens; then
        log_warn "No OAuth tokens found. Device authorization required."
        return 1
    fi
    
    # Get or refresh access token
    local access_token
    local stored_tokens
    stored_tokens=$(get_oauth_tokens)
    access_token=$(echo "$stored_tokens" | jq -r '.access_token // empty')
    
    local expires_at
    expires_at=$(echo "$stored_tokens" | jq -r '.expires_at // empty')
    
    # Check if access token is expired
    if [[ -n "$expires_at" ]]; then
        local expires_epoch now_epoch
        expires_epoch=$(date -d "$expires_at" +%s 2>/dev/null || echo 0)
        now_epoch=$(date +%s)
        
        if (( expires_epoch <= now_epoch + 60 )); then
            log_info "Access token expired, refreshing..."
            access_token=$(refresh_oauth_tokens) || return 1
        fi
    fi
    
    if [[ -z "$access_token" ]]; then
        log_info "No access token, refreshing from refresh token..."
        access_token=$(refresh_oauth_tokens) || return 1
    fi
    
    # Get profiles
    log_info "Fetching game profiles..."
    local profiles_response
    profiles_response=$(get_game_profiles "$access_token")
    
    local profile_uuid profile_name
    profile_uuid=$(echo "$profiles_response" | jq -r '.profiles[0].uuid // empty')
    profile_name=$(echo "$profiles_response" | jq -r '.profiles[0].username // empty')
    
    if [[ -z "$profile_uuid" ]]; then
        log_error "No game profiles found"
        log_error "Response: $profiles_response"
        return 1
    fi
    
    log_info "Found profile: $profile_name ($profile_uuid)"
    
    # Create game session
    create_game_session "$access_token" "$profile_uuid" || return 1
    
    return 0
}

# Export tokens as environment variables (for server startup)
export_tokens() {
    if has_session_tokens; then
        local tokens
        tokens=$(get_session_tokens)
        
        export HYTALE_SERVER_SESSION_TOKEN
        export HYTALE_SERVER_IDENTITY_TOKEN
        export HYTALE_OWNER_UUID
        
        HYTALE_SERVER_SESSION_TOKEN=$(echo "$tokens" | jq -r '.session_token')
        HYTALE_SERVER_IDENTITY_TOKEN=$(echo "$tokens" | jq -r '.identity_token')
        HYTALE_OWNER_UUID=$(echo "$tokens" | jq -r '.profile_uuid')
        
        return 0
    fi
    return 1
}

# =============================================================================
# Device Authorization Flow
# =============================================================================

# Start device authorization and return device code info
start_device_auth() {
    log_info "Starting device authorization flow..."
    
    local response
    response=$(curl -sS -X POST "$OAUTH_DEVICE_URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "client_id=${CLIENT_ID}" \
        -d "scope=${SCOPES}" 2>&1)
    
    local error
    error=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
    
    if [[ -n "$error" ]]; then
        log_error "Device auth failed: $error"
        return 1
    fi
    
    echo "$response"
}

# Poll for token after user authorizes
poll_for_token() {
    local device_code="$1"
    local interval="${2:-5}"
    local expires_in="${3:-900}"
    
    local deadline=$(($(date +%s) + expires_in))
    
    while (( $(date +%s) < deadline )); do
        sleep "$interval"
        
        local response
        response=$(curl -sS -X POST "$OAUTH_TOKEN_URL" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "client_id=${CLIENT_ID}" \
            -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
            -d "device_code=${device_code}" 2>&1)
        
        local error
        error=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
        
        case "$error" in
            "authorization_pending")
                # User hasn't authorized yet, keep polling
                continue
                ;;
            "slow_down")
                # Increase interval
                interval=$((interval + 5))
                continue
                ;;
            "expired_token")
                log_error "Device code expired"
                return 1
                ;;
            "access_denied")
                log_error "User denied authorization"
                return 1
                ;;
            "")
                # Success! We have tokens
                local access_token refresh_token token_expires_in
                access_token=$(echo "$response" | jq -r '.access_token // empty')
                refresh_token=$(echo "$response" | jq -r '.refresh_token // empty')
                token_expires_in=$(echo "$response" | jq -r '.expires_in // 3600')
                
                if [[ -n "$access_token" && -n "$refresh_token" ]]; then
                    save_oauth_tokens "$access_token" "$refresh_token" "$token_expires_in"
                    log_info "Authorization successful!"
                    echo "$access_token"
                    return 0
                else
                    log_error "Invalid token response"
                    return 1
                fi
                ;;
            *)
                log_error "Token error: $error"
                return 1
                ;;
        esac
    done
    
    log_error "Device authorization timed out"
    return 1
}

# Full interactive device auth flow
device_auth_flow() {
    local device_response
    device_response=$(start_device_auth) || return 1
    
    local device_code user_code verification_uri verification_uri_complete interval expires_in
    device_code=$(echo "$device_response" | jq -r '.device_code')
    user_code=$(echo "$device_response" | jq -r '.user_code')
    verification_uri=$(echo "$device_response" | jq -r '.verification_uri')
    verification_uri_complete=$(echo "$device_response" | jq -r '.verification_uri_complete')
    interval=$(echo "$device_response" | jq -r '.interval // 5')
    expires_in=$(echo "$device_response" | jq -r '.expires_in // 900')
    
    echo ""
    echo "==================================================================="
    echo "DEVICE AUTHORIZATION"
    echo "==================================================================="
    echo "Visit: $verification_uri"
    echo "Enter code: $user_code"
    echo "Or visit: $verification_uri_complete"
    echo "==================================================================="
    echo "Waiting for authorization (expires in ${expires_in} seconds)..."
    echo ""
    
    # Save URL for easy access
    echo "$verification_uri_complete" > "${DATA_DIR}/AUTH_LINK.url"
    
    # Poll for token
    local access_token
    access_token=$(poll_for_token "$device_code" "$interval" "$expires_in") || return 1
    
    # Now create a game session
    acquire_session_tokens || return 1
    
    return 0
}

# =============================================================================
# CLI Interface
# =============================================================================

case "${1:-}" in
    check)
        if has_session_tokens; then
            echo "Valid session tokens found"
            get_session_tokens | jq .
            exit 0
        else
            echo "No valid session tokens"
            exit 1
        fi
        ;;
    acquire)
        if acquire_session_tokens; then
            echo "Session tokens acquired successfully"
            get_session_tokens | jq .
            exit 0
        else
            echo "Failed to acquire session tokens"
            exit 1
        fi
        ;;
    auth)
        # Interactive device auth flow
        if device_auth_flow; then
            echo "Authentication complete!"
            get_session_tokens | jq .
            exit 0
        else
            echo "Authentication failed"
            exit 1
        fi
        ;;
    export)
        if export_tokens; then
            echo "export HYTALE_SERVER_SESSION_TOKEN='${HYTALE_SERVER_SESSION_TOKEN}'"
            echo "export HYTALE_SERVER_IDENTITY_TOKEN='${HYTALE_SERVER_IDENTITY_TOKEN}'"
            echo "export HYTALE_OWNER_UUID='${HYTALE_OWNER_UUID}'"
            exit 0
        else
            echo "No tokens to export"
            exit 1
        fi
        ;;
    refresh)
        if refresh_oauth_tokens > /dev/null; then
            echo "OAuth tokens refreshed"
            exit 0
        else
            echo "Failed to refresh tokens"
            exit 1
        fi
        ;;
    validate)
        if validate_oauth_tokens; then
            echo "OAuth tokens are valid"
            exit 0
        else
            echo "OAuth tokens are invalid or expired"
            exit 1
        fi
        ;;
    clear)
        clear_tokens
        echo "Tokens cleared"
        exit 0
        ;;
    status)
        echo "=== OAuth Tokens ==="
        if has_oauth_tokens; then
            echo "Refresh token: Present"
            oauth_tokens=$(get_oauth_tokens)
            echo "Access token expires: $(echo "$oauth_tokens" | jq -r '.expires_at // "unknown"')"
        else
            echo "No OAuth tokens stored"
        fi
        echo ""
        echo "=== Session Tokens ==="
        if has_session_tokens; then
            session_tokens=$(get_session_tokens)
            echo "Profile: $(echo "$session_tokens" | jq -r '.profile_uuid // "unknown"')"
            echo "Session expires: $(echo "$session_tokens" | jq -r '.expires_at // "unknown"')"
        else
            echo "No valid session tokens"
        fi
        exit 0
        ;;
    *)
        echo "Usage: $0 {check|acquire|auth|export|refresh|validate|status|clear}"
        echo ""
        echo "Commands:"
        echo "  check    - Check if valid session tokens exist"
        echo "  acquire  - Get or create session tokens (uses stored OAuth tokens)"
        echo "  auth     - Interactive device authorization flow"
        echo "  export   - Output tokens as shell export commands"
        echo "  refresh  - Refresh OAuth tokens using refresh token"
        echo "  validate - Validate stored OAuth tokens against Hytale API"
        echo "  status   - Show current token status"
        echo "  clear    - Delete all stored tokens"
        exit 1
        ;;
esac
