#!/usr/bin/env bun
/**
 * Hytale Server Setup Module
 *
 * Provides:
 * - Server file download via official Hytale CLI
 * - Java command argument building (including session tokens)
 * - File validation
 *
 * This module is imported by entrypoint.ts for the main server flow.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname } from "path";
import { logInfo, logWarn, fatal } from "./log-utils.ts";
import { prepareServerFiles } from "./download.ts";
import { getModDir } from "./mod-installer/index.ts";
import type { SessionTokens } from "./token-manager.ts";
import {
  DATA_DIR,
  SERVER_DIR,
  SERVER_JAR,
  DATA_SERVER_JAR,
  ASSETS_FILE,
  LOG_DIR,
  AOT_CACHE,
  JAVA_XMS,
  JAVA_XMX,
  JAVA_OPTS,
  ENABLE_AOT_CACHE,
  ENABLE_JVM_TUNING,
  JVM_GC,
  BIND_ADDRESS,
  SERVER_PORT,
  AUTH_MODE,
  DISABLE_SENTRY,
  ACCEPT_EARLY_PLUGINS,
  ALLOW_OP,
  ENABLE_BACKUPS,
  BACKUP_DIR,
  BACKUP_FREQUENCY,
  BACKUP_MAX_COUNT,
  TRANSPORT_TYPE,
  BOOT_COMMANDS,
  ADDITIONAL_MODS_DIR,
  ADDITIONAL_PLUGINS_DIR,
  SERVER_LOG_LEVEL,
  HYTALE_OWNER_NAME,
  BARE_MODE,
  CLIENT_PID,
  DISABLE_ASSET_COMPARE,
  DISABLE_CPB_BUILD,
  DISABLE_FILE_WATCHER,
  EVENT_DEBUG,
  FORCE_NETWORK_FLUSH,
  GENERATE_SCHEMA,
  MIGRATE_WORLDS,
  MIGRATIONS,
  PREFAB_CACHE,
  SHUTDOWN_AFTER_VALIDATE,
  SINGLEPLAYER,
  UNIVERSE_PATH,
  VALIDATE_ASSETS,
  VALIDATE_PREFABS,
  VALIDATE_WORLD_GEN,
  SHOW_VERSION,
  WORLD_GEN,
  HYTALE_SERVER_SESSION_TOKEN,
  HYTALE_SERVER_IDENTITY_TOKEN,
  HYTALE_OWNER_UUID,
} from "./config.ts";

/**
 * Download server files by calling the download module
 */
export async function downloadServer(): Promise<void> {
  try {
    await prepareServerFiles();
  } catch (error) {
    fatal("Server file download failed", error);
  }
}

/**
 * Copy the server JAR to a read-only location for integrity
 */
export function ensureReadOnlyServerJar(): void {
  if (!existsSync(DATA_SERVER_JAR)) {
    fatal(`Server JAR not found in data directory: ${DATA_SERVER_JAR}`);
  }

  try {
    mkdirSync(dirname(SERVER_JAR), { recursive: true });
    if (existsSync(SERVER_JAR)) {
      unlinkSync(SERVER_JAR);
    }
    copyFileSync(DATA_SERVER_JAR, SERVER_JAR);
    chmodSync(SERVER_JAR, 0o444);
    logInfo(`Prepared read-only server JAR at ${SERVER_JAR}`);
  } catch (error) {
    fatal(`Failed to prepare read-only server JAR: ${error}`);
  }
}

/**
 * Build Java arguments for server startup
 * @param sessionTokens - Optional session tokens to pass to server
 */
export function buildJavaArgs(sessionTokens: SessionTokens | null): string[] {
  const args: string[] = [];
  const addFlag = (flag: string, enabled: boolean): void => {
    if (enabled) args.push(flag);
  };
  const addArg = (flag: string, value: string): void => {
    if (value) args.push(flag, value);
  };

  // Memory settings
  args.push(`-Xms${JAVA_XMS}`, `-Xmx${JAVA_XMX}`);

  if (ENABLE_AOT_CACHE && existsSync(AOT_CACHE)) {
    logInfo("Using AOT cache for faster startup");
    args.push(`-XX:AOTCache=${AOT_CACHE}`);
  }

  const gcMode = JVM_GC.toLowerCase();
  if (ENABLE_JVM_TUNING) {
    switch (gcMode) {
      case "zgc":
        args.push(
          "-XX:+UseZGC",
          "-XX:+AlwaysPreTouch",
          "-XX:+DisableExplicitGC",
          "-XX:+PerfDisableSharedMem",
          "-XX:ReservedCodeCacheSize=256M",
          "-XX:+UseCodeCacheFlushing",
          "-XX:SoftMaxHeapSize=75%"
        );
        break;
      case "shenandoah":
        args.push(
          "-XX:+UnlockExperimentalVMOptions",
          "-XX:+UseShenandoahGC",
          "-XX:ShenandoahGCMode=generational",
          "-XX:+AlwaysPreTouch",
          "-XX:+DisableExplicitGC",
          "-XX:+PerfDisableSharedMem",
          "-XX:ReservedCodeCacheSize=256M",
          "-XX:+UseCodeCacheFlushing"
        );
        break;
      case "g1-extended":
      case "g1":
      default: {
        // ==========================================================================
        // G1GC Configuration for Game Servers
        // Optimized for low-latency game server workloads with predictable pause times.
        // Based on Aikar's flags (widely used for Minecraft servers) adapted for Hytale.
        // Reference: https://docs.papermc.io/paper/aikars-flags
        // ==========================================================================
        const g1Flags = [
          // Use G1 Garbage Collector - best for large heaps with low pause time requirements
          "-XX:+UseG1GC",
          // Process references in parallel during GC (reduces pause times)
          "-XX:+ParallelRefProcEnabled",
          // Target max GC pause of 200ms - balances throughput vs latency
          "-XX:MaxGCPauseMillis=200",
          // Required for some G1 tuning flags below
          "-XX:+UnlockExperimentalVMOptions",
          // Ignore System.gc() calls - prevents plugins/mods from triggering full GC
          "-XX:+DisableExplicitGC",
          // Pre-touch heap on startup - trades slower start for consistent runtime
          "-XX:+AlwaysPreTouch",
          // 30-40% young gen sizing reduces minor GC frequency
          "-XX:G1NewSizePercent=30",
          "-XX:G1MaxNewSizePercent=40",
          // 8MB heap regions - good balance for 4-16GB heaps
          "-XX:G1HeapRegionSize=8M",
          // Reserve 20% for emergency evacuation - prevents full GC under load
          "-XX:G1ReservePercent=20",
          // Allow 5% wasted space to reduce GC frequency
          "-XX:G1HeapWastePercent=5",
          // Process old gen in 4 cycles (smoother performance)
          "-XX:G1MixedGCCountTarget=4",
          // Start concurrent marking at 15% heap (aggressive but reduces pauses)
          "-XX:InitiatingHeapOccupancyPercent=15",
          // Only collect regions with <90% live data
          "-XX:G1MixedGCLiveThresholdPercent=90",
          // Limit remembered set update to 5% of pause time
          "-XX:G1RSetUpdatingPauseTimePercent=5",
          // Promote objects to old gen faster (game server allocation pattern)
          "-XX:SurvivorRatio=32",
          // Disable perf shared memory file - reduces I/O overhead
          "-XX:+PerfDisableSharedMem",
          // Promote after 1 GC cycle (reduces young gen churn)
          "-XX:MaxTenuringThreshold=1",
        ];

        if (gcMode === "g1-extended") {
          g1Flags.push("-XX:+UseCompactObjectHeaders");
        }

        args.push(...g1Flags);
        break;
      }
    }
  }

  // Allow native access used by Netty to avoid Java warnings
  args.push("--enable-native-access=ALL-UNNAMED");

  // Extra JVM options from environment (supports quoted args)
  if (JAVA_OPTS) {
    args.push(...parseJavaOpts(JAVA_OPTS));
  }

  // JAR file
  args.push("-jar", SERVER_JAR);

  // Hytale server arguments
  args.push("--assets", ASSETS_FILE);

  // Bind address
  args.push("--bind", `${BIND_ADDRESS}:${SERVER_PORT}`);

  // Auth mode
  args.push("--auth-mode", AUTH_MODE);

  // Disable sentry
  addFlag("--disable-sentry", DISABLE_SENTRY);

  // Accept early plugins (unsupported)
  if (ACCEPT_EARLY_PLUGINS) {
    logWarn("Early plugins enabled - this is unsupported and may cause stability issues");
    args.push("--accept-early-plugins");
  }

  // Allow operator commands
  addFlag("--allow-op", ALLOW_OP);

  // Backups
  if (ENABLE_BACKUPS) {
    addFlag("--backup", true);
    addArg("--backup-dir", BACKUP_DIR);
    addArg("--backup-frequency", BACKUP_FREQUENCY);
    addArg("--backup-max-count", BACKUP_MAX_COUNT);
    logInfo(
      `Backups enabled: every ${BACKUP_FREQUENCY} minutes to ${BACKUP_DIR} (max ${BACKUP_MAX_COUNT})`
    );
  }

  // Transport type (e.g., QUIC, TCP)
  addArg("--transport", TRANSPORT_TYPE);

  // Advanced server toggles and options
  addFlag("--bare", BARE_MODE);
  addArg("--client-pid", CLIENT_PID);
  addFlag("--disable-asset-compare", DISABLE_ASSET_COMPARE);
  addFlag("--disable-cpb-build", DISABLE_CPB_BUILD);
  addFlag("--disable-file-watcher", DISABLE_FILE_WATCHER);
  addFlag("--event-debug", EVENT_DEBUG);
  addArg("--force-network-flush", FORCE_NETWORK_FLUSH);
  addFlag("--generate-schema", GENERATE_SCHEMA);
  addArg("--migrate-worlds", MIGRATE_WORLDS);
  addArg("--migrations", MIGRATIONS);
  addArg("--prefab-cache", PREFAB_CACHE);
  addFlag("--shutdown-after-validate", SHUTDOWN_AFTER_VALIDATE);
  addFlag("--singleplayer", SINGLEPLAYER);
  addArg("--universe", UNIVERSE_PATH);
  addFlag("--validate-assets", VALIDATE_ASSETS);
  addArg("--validate-prefabs", VALIDATE_PREFABS);
  addFlag("--validate-world-gen", VALIDATE_WORLD_GEN);
  addFlag("--version", SHOW_VERSION);
  addArg("--world-gen", WORLD_GEN);

  // Boot commands (comma-separated, run on server start)
  if (BOOT_COMMANDS) {
    const commands = BOOT_COMMANDS.split(",")
      .map((cmd) => cmd.trim())
      .filter((cmd) => cmd.length > 0);
    for (const cmd of commands) {
      args.push("--boot-command", cmd);
    }
    logInfo(`Boot commands configured: ${commands.length} command(s)`);
  }

  // Additional mods directory
  if (ADDITIONAL_MODS_DIR) {
    addArg("--mods", ADDITIONAL_MODS_DIR);
    logInfo(`Additional mods directory: ${ADDITIONAL_MODS_DIR}`);
  }

  // Provider mod directory (adds extra --mods path)
  const modsDir = getModDir();
  if (modsDir && (!ADDITIONAL_MODS_DIR || ADDITIONAL_MODS_DIR !== modsDir)) {
    addArg("--mods", modsDir);
    logInfo(`Mods directory: ${modsDir}`);
  }

  // Additional early plugins directory
  if (ADDITIONAL_PLUGINS_DIR) {
    addArg("--early-plugins", ADDITIONAL_PLUGINS_DIR);
    logInfo(`Additional early plugins directory: ${ADDITIONAL_PLUGINS_DIR}`);
  }

  // Server log level (e.g., root=DEBUG)
  addArg("--log", SERVER_LOG_LEVEL);

  // ==========================================================================
  // Session Tokens (for authenticated mode)
  // Priority: Environment variables > OAuth-acquired tokens
  // ==========================================================================
  if (HYTALE_SERVER_SESSION_TOKEN) {
    // Hosting providers can pass tokens via environment
    args.push("--session-token", HYTALE_SERVER_SESSION_TOKEN);
    if (HYTALE_SERVER_IDENTITY_TOKEN) {
      args.push("--identity-token", HYTALE_SERVER_IDENTITY_TOKEN);
    }
    if (HYTALE_OWNER_UUID) {
      args.push("--owner-uuid", HYTALE_OWNER_UUID);
    }
    if (HYTALE_OWNER_NAME) {
      args.push("--owner-name", HYTALE_OWNER_NAME);
    }
    logInfo("Using session tokens from environment variables");
  } else if (sessionTokens) {
    // Tokens acquired via OAuth device flow
    args.push("--session-token", sessionTokens.sessionToken);
    args.push("--identity-token", sessionTokens.identityToken);
    args.push("--owner-uuid", sessionTokens.profileUuid);
    logInfo("Using session tokens from OAuth authentication");
  }

  return args;
}

function parseJavaOpts(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (const char of value) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (inSingle) {
      if (char === "'") {
        inSingle = false;
      } else {
        current += char;
      }
      continue;
    }

    if (inDouble) {
      if (char === '"') {
        inDouble = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escape) {
    current += "\\";
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

/**
 * Validate server files exist
 */
export function validateServerFiles(): void {
  if (!existsSync(DATA_SERVER_JAR)) {
    fatal(`Server JAR not found in data directory: ${DATA_SERVER_JAR}`);
  }

  if (!existsSync(ASSETS_FILE)) {
    fatal(`Assets file not found: ${ASSETS_FILE}`);
  }
}

/**
 * Setup directories
 */
export function setupDirectories(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SERVER_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const modDir = getModDir();
  if (modDir) {
    mkdirSync(modDir, { recursive: true });
  }
}
