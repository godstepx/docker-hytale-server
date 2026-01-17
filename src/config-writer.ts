#!/usr/bin/env bun
/**
 * Config Writer Module
 *
 * Generates or patches config.json and whitelist.json at container startup.
 *
 * Behavior:
 * - If HYTALE_CONFIG_JSON / WHITELIST_JSON is set: use as full override
 * - If file doesn't exist: create with defaults
 * - If file exists: patch only the fields that have explicit env vars set
 */

import { existsSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { logInfo, logDebug, logWarn } from "./log-utils.ts";
import {
  DATA_DIR,
  DRY_RUN,
  isEnvSet,
  // config.json env vars
  HYTALE_CONFIG_JSON,
  SERVER_NAME,
  SERVER_MOTD,
  SERVER_PASSWORD,
  MAX_PLAYERS,
  MAX_VIEW_RADIUS,
  LOCAL_COMPRESSION_ENABLED,
  DEFAULT_WORLD,
  DEFAULT_GAME_MODE,
  DISPLAY_TMP_TAGS_IN_STRINGS,
  PLAYER_STORAGE_TYPE,
  // whitelist.json env vars
  WHITELIST_ENABLED,
  WHITELIST_LIST,
  WHITELIST_JSON,
} from "./config.ts";

// File paths
const CONFIG_FILE = resolve(DATA_DIR, "config.json");
const WHITELIST_FILE = resolve(DATA_DIR, "whitelist.json");

// =============================================================================
// Types
// =============================================================================

interface HytaleConfig {
  Version: number;
  ServerName: string;
  MOTD: string;
  Password: string;
  MaxPlayers: number;
  MaxViewRadius: number;
  LocalCompressionEnabled: boolean;
  Defaults: {
    World: string;
    GameMode: string;
  };
  ConnectionTimeouts: {
    JoinTimeouts: Record<string, unknown>;
  };
  RateLimit: Record<string, unknown>;
  Modules: Record<string, unknown>;
  LogLevels: Record<string, unknown>;
  Mods: Record<string, unknown>;
  DisplayTmpTagsInStrings: boolean;
  PlayerStorage: {
    Type: string;
  };
  [key: string]: unknown; // Allow additional fields
}

interface WhitelistConfig {
  enabled: boolean;
  list: string[];
}

const CONFIG_ENV_KEYS = [
  "HYTALE_CONFIG_JSON",
  "SERVER_NAME",
  "SERVER_MOTD",
  "SERVER_PASSWORD",
  "MAX_PLAYERS",
  "MAX_VIEW_RADIUS",
  "LOCAL_COMPRESSION_ENABLED",
  "DEFAULT_WORLD",
  "DEFAULT_GAME_MODE",
  "DISPLAY_TMP_TAGS_IN_STRINGS",
  "PLAYER_STORAGE_TYPE",
];

const WHITELIST_ENV_KEYS = ["WHITELIST_JSON", "WHITELIST_ENABLED", "WHITELIST_LIST"];

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse JSON safely with error handling
 */
function safeParseJson<T>(json: string, description: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    logWarn(`Failed to parse ${description}: ${error}`);
    return null;
  }
}

/**
 * Read existing JSON file safely
 */
function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file with pretty formatting
 */
function writeJsonFile(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2);
  if (DRY_RUN) {
    logInfo(`[DRY_RUN] Would write to ${filePath}:`);
    logDebug(content);
    return;
  }
  writeFileSync(filePath, content, "utf-8");
}

function hasEnvVars(keys: string[]): boolean {
  return keys.some((key) => isEnvSet(key));
}

function applyIfSet(
  envKey: string,
  label: string,
  apply: () => void,
  patchedFields: string[]
): void {
  if (!isEnvSet(envKey)) return;
  apply();
  patchedFields.push(label);
}

// =============================================================================
// Default Configurations
// =============================================================================

/**
 * Get default config.json structure
 * Matches the format from test-data/config.json
 */
function getDefaultConfig(): HytaleConfig {
  return {
    Version: 3,
    ServerName: SERVER_NAME,
    MOTD: SERVER_MOTD,
    Password: SERVER_PASSWORD,
    MaxPlayers: MAX_PLAYERS,
    MaxViewRadius: MAX_VIEW_RADIUS,
    LocalCompressionEnabled: LOCAL_COMPRESSION_ENABLED,
    Defaults: {
      World: DEFAULT_WORLD,
      GameMode: DEFAULT_GAME_MODE,
    },
    ConnectionTimeouts: {
      JoinTimeouts: {},
    },
    RateLimit: {},
    Modules: {},
    LogLevels: {},
    Mods: {},
    DisplayTmpTagsInStrings: DISPLAY_TMP_TAGS_IN_STRINGS,
    PlayerStorage: {
      Type: PLAYER_STORAGE_TYPE,
    },
  };
}

/**
 * Get default whitelist.json structure
 */
function getDefaultWhitelist(): WhitelistConfig {
  return {
    enabled: WHITELIST_ENABLED,
    list: WHITELIST_LIST,
  };
}

// =============================================================================
// Config Writers
// =============================================================================

/**
 * Check if any config.json env vars are explicitly set
 */
function hasConfigEnvVars(): boolean {
  return hasEnvVars(CONFIG_ENV_KEYS);
}

/**
 * Check if any whitelist env vars are explicitly set
 */
function hasWhitelistEnvVars(): boolean {
  return hasEnvVars(WHITELIST_ENV_KEYS);
}

/**
 * Write or patch config.json
 */
function writeConfigJson(): void {
  const fileExists = existsSync(CONFIG_FILE);

  // Full JSON override takes priority
  if (HYTALE_CONFIG_JSON) {
    const parsed = safeParseJson<HytaleConfig>(HYTALE_CONFIG_JSON, "HYTALE_CONFIG_JSON");
    if (parsed) {
      writeJsonFile(CONFIG_FILE, parsed);
      logInfo("Using config.json from HYTALE_CONFIG_JSON override");
      return;
    }
    logWarn("HYTALE_CONFIG_JSON invalid, ignoring");
  }

  // File doesn't exist: create with defaults (includes any env vars)
  if (!fileExists) {
    writeJsonFile(CONFIG_FILE, getDefaultConfig());
    logInfo("Created config.json");
    return;
  }

  // File exists but no env vars to patch: skip
  if (!hasConfigEnvVars()) {
    logDebug("config.json exists, no env vars set, skipping");
    return;
  }

  // File exists: patch only explicitly set fields
  const existing = readJsonFile<HytaleConfig>(CONFIG_FILE);
  if (!existing) {
    logWarn("Failed to read existing config.json, creating new one");
    writeJsonFile(CONFIG_FILE, getDefaultConfig());
    return;
  }

  // Patch only fields that have explicit env vars
  const patched = { ...existing };
  const patchedFields: string[] = [];

  applyIfSet("SERVER_NAME", "ServerName", () => {
    patched.ServerName = SERVER_NAME;
  }, patchedFields);

  applyIfSet("SERVER_MOTD", "MOTD", () => {
    patched.MOTD = SERVER_MOTD;
  }, patchedFields);

  applyIfSet("SERVER_PASSWORD", "Password", () => {
    patched.Password = SERVER_PASSWORD;
  }, patchedFields);

  applyIfSet("MAX_PLAYERS", "MaxPlayers", () => {
    patched.MaxPlayers = MAX_PLAYERS;
  }, patchedFields);

  applyIfSet("MAX_VIEW_RADIUS", "MaxViewRadius", () => {
    patched.MaxViewRadius = MAX_VIEW_RADIUS;
  }, patchedFields);

  applyIfSet("LOCAL_COMPRESSION_ENABLED", "LocalCompressionEnabled", () => {
    patched.LocalCompressionEnabled = LOCAL_COMPRESSION_ENABLED;
  }, patchedFields);

  applyIfSet("DEFAULT_WORLD", "Defaults.World", () => {
    patched.Defaults = { ...patched.Defaults, World: DEFAULT_WORLD };
  }, patchedFields);

  applyIfSet("DEFAULT_GAME_MODE", "Defaults.GameMode", () => {
    patched.Defaults = { ...patched.Defaults, GameMode: DEFAULT_GAME_MODE };
  }, patchedFields);

  applyIfSet("DISPLAY_TMP_TAGS_IN_STRINGS", "DisplayTmpTagsInStrings", () => {
    patched.DisplayTmpTagsInStrings = DISPLAY_TMP_TAGS_IN_STRINGS;
  }, patchedFields);
  
  applyIfSet("PLAYER_STORAGE_TYPE", "PlayerStorage.Type", () => {
    patched.PlayerStorage = { ...patched.PlayerStorage, Type: PLAYER_STORAGE_TYPE };
  }, patchedFields);

  if (patchedFields.length > 0) {
    writeJsonFile(CONFIG_FILE, patched);
    logInfo(`Patched config.json: ${patchedFields.join(", ")}`);
  }
}

/**
 * Write or patch whitelist.json
 */
function writeWhitelistJson(): void {
  const fileExists = existsSync(WHITELIST_FILE);

  // Full JSON override takes priority
  if (WHITELIST_JSON) {
    const parsed = safeParseJson<WhitelistConfig>(WHITELIST_JSON, "WHITELIST_JSON");
    if (parsed) {
      writeJsonFile(WHITELIST_FILE, parsed);
      logInfo("Using whitelist.json from WHITELIST_JSON override");
      return;
    }
    logWarn("WHITELIST_JSON invalid, ignoring");
  }

  // File doesn't exist: create with defaults (includes any env vars)
  if (!fileExists) {
    writeJsonFile(WHITELIST_FILE, getDefaultWhitelist());
    logInfo("Created whitelist.json");
    return;
  }

  // File exists but no env vars to patch: skip
  if (!hasWhitelistEnvVars()) {
    logDebug("whitelist.json exists, no env vars set, skipping");
    return;
  }

  // File exists: patch only explicitly set fields
  const existing = readJsonFile<WhitelistConfig>(WHITELIST_FILE);
  if (!existing) {
    logWarn("Failed to read existing whitelist.json, creating new one");
    writeJsonFile(WHITELIST_FILE, getDefaultWhitelist());
    return;
  }

  // Patch only fields that have explicit env vars
  const patched = { ...existing };
  const patchedFields: string[] = [];

  applyIfSet("WHITELIST_ENABLED", "enabled", () => {
    patched.enabled = WHITELIST_ENABLED;
  }, patchedFields);
  applyIfSet("WHITELIST_LIST", "list", () => {
    patched.list = WHITELIST_LIST;
  }, patchedFields);

  if (patchedFields.length > 0) {
    writeJsonFile(WHITELIST_FILE, patched);
    logInfo(`Patched whitelist.json: ${patchedFields.join(", ")}`);
  }
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Write config files based on environment variables
 * Called during container startup before server launch
 */
export async function writeConfigFiles(): Promise<void> {
  logInfo("Checking config files...");

  writeConfigJson();
  writeWhitelistJson();
}
