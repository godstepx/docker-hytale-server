#!/usr/bin/env bash
# =============================================================================
# Configuration Generator
# =============================================================================
# Generates server configuration from environment variables using a JSON
# template. Supports strict mode for validation.
#
# Usage: generate-config.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=log-utils.sh
source "${SCRIPT_DIR}/log-utils.sh"

# Paths
readonly TEMPLATE_DIR="${TEMPLATE_DIR:-/opt/hytale/templates}"
readonly TEMPLATE_FILE="${TEMPLATE_DIR}/server-config.template.json"
readonly OUTPUT_FILE="${CONFIG_OUTPUT:-/data/config.json}"

# =============================================================================
# Configuration Mapping
# =============================================================================

# Maps environment variables to JSON paths
# Format: ENV_VAR:json.path:type:default
# Types: string, number, boolean
readonly -a CONFIG_MAPPINGS=(
    "SERVER_NAME:.server.name:string:Hytale Server"
    "MAX_PLAYERS:.server.maxPlayers:number:20"
    "VIEW_DISTANCE:.server.viewDistance:number:10"
    "DIFFICULTY:.server.difficulty:string:normal"
    "MOTD:.server.motd:string:A Hytale Server"
    "SEED:.world.seed:string:"
    "WORLD_NAME:.world.name:string:world"
    "ENABLE_PVP:.server.pvp:boolean:true"
    "SPAWN_PROTECTION:.server.spawnProtection:number:16"
    "TICK_RATE:.server.tickRate:number:20"
    "NETWORK_PORT:.network.port:number:5520"
    "NETWORK_COMPRESSION:.network.compression:boolean:true"
)

# Track unknown environment variables
declare -a UNKNOWN_VARS=()

# =============================================================================
# Functions
# =============================================================================

# Check if template exists
check_template() {
    if [[ ! -f "$TEMPLATE_FILE" ]]; then
        die "Template file not found: $TEMPLATE_FILE"
    fi
}

# Get value from environment or use default
get_config_value() {
    local env_var="$1"
    local default="$2"
    
    local value="${!env_var:-$default}"
    echo "$value"
}

# Build jq filter from mappings
build_jq_filter() {
    local filter=""
    
    for mapping in "${CONFIG_MAPPINGS[@]}"; do
        IFS=':' read -r env_var json_path value_type default <<< "$mapping"
        
        local value
        value=$(get_config_value "$env_var" "$default")
        
        # Skip empty values (unless they have a default)
        if [[ -z "$value" && -z "$default" ]]; then
            continue
        fi
        
        # Build jq expression based on type
        case "$value_type" in
            number)
                if [[ "$value" =~ ^[0-9]+$ ]]; then
                    filter+=" | ${json_path} = ${value}"
                else
                    log_warn "Invalid number for $env_var: $value, using default: $default"
                    filter+=" | ${json_path} = ${default:-0}"
                fi
                ;;
            boolean)
                local bool_val="false"
                if [[ "${value,,}" == "true" || "$value" == "1" ]]; then
                    bool_val="true"
                fi
                filter+=" | ${json_path} = ${bool_val}"
                ;;
            string)
                # Escape special characters for jq
                local escaped_value
                escaped_value=$(printf '%s' "$value" | jq -Rs '.')
                filter+=" | ${json_path} = ${escaped_value}"
                ;;
        esac
        
        log_debug "Set $json_path = $value"
    done
    
    # Remove leading " | "
    echo "${filter# | }"
}

# Check for unknown HYTALE_ environment variables
check_unknown_vars() {
    local known_vars=""
    for mapping in "${CONFIG_MAPPINGS[@]}"; do
        IFS=':' read -r env_var _ _ _ <<< "$mapping"
        known_vars+="$env_var "
    done
    
    # Add known non-config vars
    known_vars+="HYTALE_VERSION HYTALE_STRICT_CONFIG "
    known_vars+="DOWNLOAD_MODE SERVER_URL ASSETS_URL SERVER_SHA256 ASSETS_SHA256 "
    known_vars+="JAVA_XMS JAVA_XMX JAVA_OPTS DRY_RUN TZ LOG_LEVEL "
    
    # Check all HYTALE_ and known config vars
    while IFS='=' read -r name _; do
        # Check if this is a config-related var we should validate
        if [[ "$name" == HYTALE_* ]] || [[ " ${CONFIG_MAPPINGS[*]} " =~ " ${name}:" ]]; then
            if [[ ! " $known_vars " =~ " $name " ]]; then
                UNKNOWN_VARS+=("$name")
            fi
        fi
    done < <(env)
    
    if [[ ${#UNKNOWN_VARS[@]} -gt 0 ]]; then
        if [[ "${HYTALE_STRICT_CONFIG:-false}" == "true" ]]; then
            log_error "Unknown configuration variables (strict mode enabled):"
            for var in "${UNKNOWN_VARS[@]}"; do
                log_error "  - $var"
            done
            die "Configuration validation failed"
        else
            log_warn "Unknown configuration variables (will be ignored):"
            for var in "${UNKNOWN_VARS[@]}"; do
                log_warn "  - $var"
            done
        fi
    fi
}

# Generate configuration file
generate_config() {
    log_info "Generating server configuration..."
    
    check_template
    check_unknown_vars
    
    local jq_filter
    jq_filter=$(build_jq_filter)
    
    if [[ -z "$jq_filter" ]]; then
        log_info "No configuration overrides, using template defaults"
        cp "$TEMPLATE_FILE" "$OUTPUT_FILE"
    else
        log_debug "Applying jq filter: $jq_filter"
        jq "$jq_filter" "$TEMPLATE_FILE" > "$OUTPUT_FILE"
    fi
    
    log_info "Configuration written to: $OUTPUT_FILE"
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Dry run mode
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log_info "[DRY_RUN] Would generate configuration:"
        log_info "[DRY_RUN] Template: $TEMPLATE_FILE"
        log_info "[DRY_RUN] Output: $OUTPUT_FILE"
        
        local jq_filter
        jq_filter=$(build_jq_filter)
        log_info "[DRY_RUN] jq filter: $jq_filter"
        return 0
    fi
    
    # Ensure output directory exists
    mkdir -p "$(dirname "$OUTPUT_FILE")"
    
    generate_config
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
