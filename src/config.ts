/**
 * Centralized Configuration Module
 * All environment variables with defaults in one place.
 * Import this module instead of using process.env directly.
 */

import { resolve } from "path";

// =============================================================================
// Helper Functions
// =============================================================================

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.toLowerCase();
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1" || value === "yes";
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if an environment variable is explicitly set (not relying on default)
 */
export function isEnvSet(key: string): boolean {
  return process.env[key] !== undefined;
}

// =============================================================================
// Path Configuration
// =============================================================================

export const DATA_DIR = getEnv("DATA_DIR", "/data");
export const SERVER_DIR = resolve(DATA_DIR, "server");

// CLI directories: bundled (read-only, in image) and user (writable, in volume)
export const BUNDLED_CLI_DIR = getEnv("BUNDLED_CLI_DIR", "/opt/hytale/cli");
export const USER_CLI_DIR = resolve(DATA_DIR, ".hytale-cli");

export const AUTH_CACHE = resolve(DATA_DIR, ".auth");
export const LOG_DIR = resolve(DATA_DIR, "logs");

// File paths
export const SERVER_JAR = resolve(SERVER_DIR, "HytaleServer.jar");
export const ASSETS_FILE = resolve(DATA_DIR, "Assets.zip");
export const VERSION_FILE = resolve(DATA_DIR, ".version");
export const AOT_CACHE = resolve(SERVER_DIR, "HytaleServer.aot");

// =============================================================================
// Download Configuration
// =============================================================================

export const DOWNLOAD_MODE = getEnv("DOWNLOAD_MODE", "auto");
export const HYTALE_CLI_URL = getEnv(
  "HYTALE_CLI_URL",
  "https://downloader.hytale.com/hytale-downloader.zip"
);
export const LAUNCHER_PATH = getEnv("LAUNCHER_PATH", "");
export const HYTALE_PATCHLINE = getEnv("HYTALE_PATCHLINE", "release");
export const DOWNLOAD_MAX_RETRIES = getEnvInt("DOWNLOAD_MAX_RETRIES", 5);
export const DOWNLOAD_INITIAL_BACKOFF = getEnvInt("DOWNLOAD_INITIAL_BACKOFF", 2);

// Download behavior flags
export const FORCE_DOWNLOAD = getEnvBool("FORCE_DOWNLOAD", false);
export const CHECK_UPDATES = getEnvBool("CHECK_UPDATES", true);
export const SKIP_CLI_UPDATE_CHECK = getEnvBool("SKIP_CLI_UPDATE_CHECK", false);

// =============================================================================
// Java Configuration
// =============================================================================

export const JAVA_XMS = getEnv("JAVA_XMS", "1G");
export const JAVA_XMX = getEnv("JAVA_XMX", "4G");
export const JAVA_OPTS = getEnv("JAVA_OPTS", "");
export const ENABLE_AOT_CACHE = getEnvBool("ENABLE_AOT_CACHE", true);

// =============================================================================
// Server Configuration
// =============================================================================

export const SERVER_PORT = getEnv("SERVER_PORT", "5520");
export const BIND_ADDRESS = getEnv("BIND_ADDRESS", "0.0.0.0");
export const AUTH_MODE = getEnv("AUTH_MODE", "authenticated");

// Server feature flags
export const DISABLE_SENTRY = getEnvBool("DISABLE_SENTRY", false);
export const ACCEPT_EARLY_PLUGINS = getEnvBool("ACCEPT_EARLY_PLUGINS", false);
export const ALLOW_OP = getEnvBool("ALLOW_OP", false);

// Advanced server options
export const TRANSPORT_TYPE = getEnv("TRANSPORT_TYPE", "");
export const BOOT_COMMANDS = getEnv("BOOT_COMMANDS", "");
export const ADDITIONAL_MODS_DIR = getEnv("ADDITIONAL_MODS_DIR", "");
export const ADDITIONAL_PLUGINS_DIR = getEnv("ADDITIONAL_PLUGINS_DIR", "");
export const SERVER_LOG_LEVEL = getEnv("SERVER_LOG_LEVEL", "");
export const HYTALE_OWNER_NAME = getEnv("HYTALE_OWNER_NAME", "");

// =============================================================================
// Mod Installation (CurseForge)
// =============================================================================

export const MOD_INSTALL_MODE = getEnv("MOD_INSTALL_MODE", "off");
export const CURSEFORGE_MOD_LIST = getEnv("CURSEFORGE_MOD_LIST", "");
export const CURSEFORGE_API_KEY = getEnv("CURSEFORGE_API_KEY", "");
export const CURSEFORGE_GAME_VERSION = getEnv("CURSEFORGE_GAME_VERSION", "Early Access");
export const CURSEFORGE_MODS_DIR = getEnv(
  "CURSEFORGE_MODS_DIR",
  resolve(DATA_DIR, "curseforge-mods")
);

// =============================================================================
// Config File Generation (config.json / whitelist.json)
// =============================================================================

// Full JSON override (highest priority) - use entire JSON string as config
export const HYTALE_CONFIG_JSON = getEnv("HYTALE_CONFIG_JSON", "");

// Individual config.json fields
export const SERVER_NAME = getEnv("SERVER_NAME", "Hytale Server");
export const SERVER_MOTD = getEnv("SERVER_MOTD", "");
export const SERVER_PASSWORD = getEnv("SERVER_PASSWORD", "");
export const MAX_PLAYERS = getEnvInt("MAX_PLAYERS", 100);
export const MAX_VIEW_RADIUS = getEnvInt("MAX_VIEW_RADIUS", 32);
export const LOCAL_COMPRESSION_ENABLED = getEnvBool("LOCAL_COMPRESSION_ENABLED", false);
export const DEFAULT_WORLD = getEnv("DEFAULT_WORLD", "default");
export const DEFAULT_GAME_MODE = getEnv("DEFAULT_GAME_MODE", "Adventure");
export const DISPLAY_TMP_TAGS_IN_STRINGS = getEnvBool("DISPLAY_TMP_TAGS_IN_STRINGS", false);
export const PLAYER_STORAGE_TYPE = getEnv("PLAYER_STORAGE_TYPE", "Hytale");

// Whitelist configuration
export const WHITELIST_ENABLED = getEnvBool("WHITELIST_ENABLED", false);
export const WHITELIST_LIST = getEnv("WHITELIST_LIST", ""); // Comma-separated player UUIDs
export const WHITELIST_JSON = getEnv("WHITELIST_JSON", ""); // Full JSON override

// =============================================================================
// Backup Configuration
// =============================================================================

export const ENABLE_BACKUPS = getEnvBool("ENABLE_BACKUPS", false);
export const BACKUP_DIR = getEnv("BACKUP_DIR", resolve(DATA_DIR, "backups"));
export const BACKUP_FREQUENCY = getEnv("BACKUP_FREQUENCY", "30");
export const BACKUP_MAX_COUNT = getEnv("BACKUP_MAX_COUNT", "5");

// =============================================================================
// Logging Configuration
// =============================================================================

export const CONTAINER_LOG_LEVEL = getEnv("CONTAINER_LOG_LEVEL", "INFO").toUpperCase();

// =============================================================================
// Runtime Configuration
// =============================================================================

export const DRY_RUN = getEnvBool("DRY_RUN", false);
export const TZ = getEnv("TZ", "UTC");

// =============================================================================
// Token Configuration
// =============================================================================

// Token file path
export const OAUTH_TOKEN_FILE = resolve(AUTH_CACHE, ".oauth-tokens.json");

// Environment variable overrides (for hosting providers)
// These bypass OAuth flow entirely - tokens managed externally
export const HYTALE_SERVER_SESSION_TOKEN = getEnv("HYTALE_SERVER_SESSION_TOKEN", "");
export const HYTALE_SERVER_IDENTITY_TOKEN = getEnv("HYTALE_SERVER_IDENTITY_TOKEN", "");
export const HYTALE_OWNER_UUID = getEnv("HYTALE_OWNER_UUID", "");

// Behavior
export const AUTO_AUTH_ON_START = getEnvBool("AUTO_AUTH_ON_START", true);

// Background OAuth refresh settings
// Refresh interval: how often to check if tokens need refresh (default: 24 hours)
export const OAUTH_REFRESH_CHECK_INTERVAL = getEnvInt("OAUTH_REFRESH_CHECK_INTERVAL", 86400000);
// Threshold: refresh when token has this many days left (default: 7 days)
export const OAUTH_REFRESH_THRESHOLD_DAYS = getEnvInt("OAUTH_REFRESH_THRESHOLD_DAYS", 7);

// =============================================================================
// Log Management
// =============================================================================

// Log retention: delete Hytale server logs older than this many days (0 = disable cleanup)
export const LOG_RETENTION_DAYS = getEnvInt("LOG_RETENTION_DAYS", 7);
