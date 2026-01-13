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

// =============================================================================
// Path Configuration
// =============================================================================

export const DATA_DIR = getEnv("DATA_DIR", "/data");
export const SERVER_DIR = resolve(DATA_DIR, "server");
export const CLI_DIR = resolve(DATA_DIR, ".hytale-cli");
export const AUTH_CACHE = resolve(DATA_DIR, ".auth");
export const LOG_DIR = resolve(DATA_DIR, "logs");

// File paths
export const SERVER_JAR = resolve(SERVER_DIR, "HytaleServer.jar");
export const ASSETS_FILE = resolve(DATA_DIR, "Assets.zip");
export const VERSION_FILE = resolve(DATA_DIR, ".version");
export const PID_FILE = resolve(DATA_DIR, "server.pid");
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
export const CHECK_UPDATES = getEnvBool("CHECK_UPDATES", false);
export const SKIP_CLI_UPDATE_CHECK = getEnvBool("SKIP_CLI_UPDATE_CHECK", false);

// =============================================================================
// Java Configuration
// =============================================================================

export const JAVA_XMS = getEnv("JAVA_XMS", "1G");
export const JAVA_XMX = getEnv("JAVA_XMX", "4G");
export const JAVA_OPTS = getEnv("JAVA_OPTS", "");

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

// =============================================================================
// Backup Configuration
// =============================================================================

export const ENABLE_BACKUPS = getEnvBool("ENABLE_BACKUPS", false);
export const BACKUP_DIR = getEnv("BACKUP_DIR", resolve(DATA_DIR, "backups"));
export const BACKUP_FREQUENCY = getEnv("BACKUP_FREQUENCY", "30");

// =============================================================================
// Logging Configuration
// =============================================================================

export const LOG_LEVEL = getEnv("LOG_LEVEL", "INFO").toUpperCase();
export const HYTALE_VERSION = getEnv("HYTALE_VERSION", "unknown");

// =============================================================================
// Runtime Configuration
// =============================================================================

export const DRY_RUN = getEnvBool("DRY_RUN", false);
export const TZ = getEnv("TZ", "UTC");
