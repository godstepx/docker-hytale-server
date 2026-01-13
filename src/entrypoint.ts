#!/usr/bin/env bun
/**
 * Hytale Server Entrypoint
 * Main entrypoint script that orchestrates:
 * 1. Server binary download via official Hytale CLI
 * 2. Server startup with proper signal handling
 *
 * Note: Hytale manages its own config.json files.
 * See official docs: https://support.hytale.com/hc/en-us/articles/45326769420827
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { logInfo, logWarn, logBanner, die } from "./log-utils.ts";
import { ensureServerFiles } from "./download.ts";
import {
  DATA_DIR,
  SERVER_DIR,
  SERVER_JAR,
  ASSETS_FILE,
  PID_FILE,
  LOG_DIR,
  AOT_CACHE,
  JAVA_XMS,
  JAVA_XMX,
  JAVA_OPTS,
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

// Server process
let serverProcess: ReturnType<typeof Bun.spawn> | null = null;
let isShuttingDown = false;

/**
 * Cleanup and graceful shutdown
 */
async function cleanup(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logInfo("Received shutdown signal...");

  if (serverProcess && !serverProcess.killed) {
    logInfo(`Stopping server gracefully (PID: ${serverProcess.pid})...`);

    try {
      // Send SIGTERM to the process
      serverProcess.kill("SIGTERM");

      // Wait for graceful shutdown (max 30 seconds)
      const timeout = 30;
      let count = 0;

      while (!serverProcess.killed && count < timeout) {
        await Bun.sleep(1000);
        count++;
      }

      // Force kill if still running
      if (!serverProcess.killed) {
        logWarn("Server did not stop gracefully, forcing...");
        serverProcess.kill("SIGKILL");
      }
    } catch (error) {
      logWarn(`Error during shutdown: ${error}`);
    }
  }

  // Remove PID file
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch (error) {
      // Ignore
    }
  }

  logInfo("Shutdown complete");
  process.exit(0);
}

/**
 * Setup signal handlers
 */
function setupSignalHandlers(): void {
  process.on("SIGTERM", () => {
    void cleanup();
  });

  process.on("SIGINT", () => {
    void cleanup();
  });

  process.on("SIGHUP", () => {
    void cleanup();
  });
}

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

  // Use AOT cache if available (faster startup)
  if (existsSync(AOT_CACHE)) {
    logInfo("Using AOT cache for faster startup");
    args.push(`-XX:AOTCache=${AOT_CACHE}`);
  }

  // Recommended JVM flags for game servers
  args.push(
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
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
 * Start the Hytale server
 */
async function startServer(): Promise<void> {
  logInfo("Starting Hytale server...");

  if (!existsSync(SERVER_JAR)) {
    die(`Server JAR not found: ${SERVER_JAR}`);
  }

  if (!existsSync(ASSETS_FILE)) {
    die(`Assets file not found: ${ASSETS_FILE}`);
  }

  mkdirSync(LOG_DIR, { recursive: true });

  const javaArgs = buildJavaArgs();

  logInfo(`Java command: java ${javaArgs.join(" ")}`);

  if (DRY_RUN) {
    logInfo(`[DRY_RUN] Would start server with: java ${javaArgs.join(" ")}`);
    logInfo("[DRY_RUN] Entrypoint complete, exiting.");
    process.exit(0);
  }

  // Change to data directory
  process.chdir(DATA_DIR);

  // Start server - pass through current environment
  serverProcess = Bun.spawn(["java", ...javaArgs], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  // Save PID
  writeFileSync(PID_FILE, serverProcess.pid.toString(), "utf-8");
  logInfo(`Server started with PID: ${serverProcess.pid}`);

  // Wait for server process
  const exitCode = await serverProcess.exited;

  // Remove PID file
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch (error) {
      // Ignore
    }
  }

  logInfo(`Server exited with code: ${exitCode}`);
  process.exit(exitCode);
}

/**
 * Main
 */
async function main(): Promise<void> {
  logBanner();

  // Setup signal handlers
  setupSignalHandlers();

  // Setup directories
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SERVER_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  // Phase 1: Download server files (via Hytale CLI)
  await downloadServer();

  // Phase 2: Start server
  await startServer();
}

// Run main if executed directly
if (import.meta.main) {
  main().catch((error) => {
    die(`Entrypoint failed: ${error}`);
  });
}
