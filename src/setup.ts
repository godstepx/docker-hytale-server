#!/usr/bin/env bun
/**
 * Hytale Server Setup
 * Setup script that:
 * 1. Downloads server files via official Hytale CLI
 * 2. Validates files exist
 * 3. Writes Java command for shell wrapper to exec
 *
 * The shell wrapper (entrypoint-wrapper.sh) then execs Java directly.
 * This avoids Bun managing long-running subprocesses (which can crash on ARM64).
 *
 * Note: Hytale manages its own config.json files.
 * See official docs: https://support.hytale.com/hc/en-us/articles/45326769420827
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { logInfo, logWarn, logBanner, die } from "./log-utils.ts";
import { ensureServerFiles } from "./download.ts";
import {
  DATA_DIR,
  SERVER_DIR,
  SERVER_JAR,
  ASSETS_FILE,
  LOG_DIR,
  AOT_CACHE,
  JAVA_XMS,
  JAVA_XMX,
  JAVA_OPTS,
  ENABLE_AOT_CACHE,
  BIND_ADDRESS,
  SERVER_PORT,
  AUTH_MODE,
  DISABLE_SENTRY,
  ACCEPT_EARLY_PLUGINS,
  ALLOW_OP,
  ENABLE_BACKUPS,
  BACKUP_DIR,
  BACKUP_FREQUENCY,
  DRY_RUN,
} from "./config.ts";

/**
 * Download server files by calling the download module
 */
async function downloadServer(): Promise<void> {
  try {
    await ensureServerFiles();
  } catch (error) {
    die(`Server file download failed: ${error}`);
  }
}

/**
 * Build Java arguments
 */
function buildJavaArgs(): string[] {
  const args: string[] = [];

  // Memory settings
  args.push(`-Xms${JAVA_XMS}`, `-Xmx${JAVA_XMX}`);

  if (ENABLE_AOT_CACHE && existsSync(AOT_CACHE)) {
    logInfo("Using AOT cache for faster startup");
    args.push(`-XX:AOTCache=${AOT_CACHE}`);
  }

  // ==========================================================================
  // G1GC Configuration for Game Servers
  // Optimized for low-latency game server workloads with predictable pause times.
  // Based on Aikar's flags (widely used for Minecraft servers) adapted for Hytale.
  // Reference: https://docs.papermc.io/paper/aikars-flags
  // ==========================================================================
  args.push(
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
    "-XX:MaxTenuringThreshold=1"
  );

  // Extra JVM options from environment
  if (JAVA_OPTS) {
    const extraOpts = JAVA_OPTS.split(" ").filter((opt) => opt.trim().length > 0);
    args.push(...extraOpts);
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
  if (DISABLE_SENTRY) {
    args.push("--disable-sentry");
  }

  // Accept early plugins (unsupported)
  if (ACCEPT_EARLY_PLUGINS) {
    logWarn("Early plugins enabled - this is unsupported and may cause stability issues");
    args.push("--accept-early-plugins");
  }

  // Allow operator commands
  if (ALLOW_OP) {
    args.push("--allow-op");
  }

  // Backups
  if (ENABLE_BACKUPS) {
    args.push("--backup");
    args.push("--backup-dir", BACKUP_DIR);
    args.push("--backup-frequency", BACKUP_FREQUENCY);
    logInfo(`Backups enabled: every ${BACKUP_FREQUENCY} minutes to ${BACKUP_DIR}`);
  }

  return args;
}

/**
 * Prepare server startup
 * Writes Java command to file for shell wrapper to exec
 */
async function prepareServer(): Promise<void> {
  logInfo("Preparing Hytale server...");

  const javaArgs = buildJavaArgs();

  if (DRY_RUN) {
    logInfo(`[DRY_RUN] Java command: java ${javaArgs.join(" ")}`);
    logInfo("[DRY_RUN] Setup complete, exiting.");
    process.exit(0);
  }

  if (!existsSync(SERVER_JAR)) {
    die(`Server JAR not found: ${SERVER_JAR}`);
  }

  if (!existsSync(ASSETS_FILE)) {
    die(`Assets file not found: ${ASSETS_FILE}`);
  }

  mkdirSync(LOG_DIR, { recursive: true });

  // Write Java command to file for shell wrapper to exec
  // This avoids Bun managing a long-running subprocess (which can crash on ARM64)
  const javaCommand = ["exec", "java", ...javaArgs];
  const escapedArgs = javaCommand.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(" ");
  const javaCmdFile = "/tmp/java-cmd.sh";

  writeFileSync(javaCmdFile, escapedArgs + "\n", { mode: 0o755 });
  logInfo(`Java command: java ${javaArgs.join(" ")}`);
  logInfo("Setup complete, handing off to Java...");
}

/**
 * Main
 */
async function main(): Promise<void> {
  logBanner();

  // Setup directories
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SERVER_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  // Phase 1: Download server files (via Hytale CLI)
  await downloadServer();

  // Phase 2: Prepare server (write java command)
  await prepareServer();
}

// Run main if executed directly
if (import.meta.main) {
  main().catch((error) => {
    die(`Setup failed: ${error}`);
  });
}
