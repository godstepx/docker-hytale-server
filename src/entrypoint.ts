#!/usr/bin/env bun
/**
 * Hytale Server Entrypoint
 * Main entrypoint script that orchestrates:
 * 1. Server binary download via official Hytale CLI
 * 2. Configuration generation
 * 3. Server startup with proper signal handling
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { logInfo, logWarn, logBanner, die } from "./log-utils.ts";

// Configuration
const DATA_DIR = process.env.DATA_DIR || "/data";
const SERVER_DIR = resolve(DATA_DIR, "server");
const SERVER_JAR = resolve(SERVER_DIR, "HytaleServer.jar");
const ASSETS_FILE = resolve(DATA_DIR, "Assets.zip");
const CONFIG_FILE = resolve(DATA_DIR, "config.json");
const PID_FILE = resolve(DATA_DIR, "server.pid");
const LOG_DIR = resolve(DATA_DIR, "logs");
const AOT_CACHE = resolve(SERVER_DIR, "HytaleServer.aot");

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
    cleanup();
  });

  process.on("SIGINT", () => {
    cleanup();
  });

  process.on("SIGHUP", () => {
    cleanup();
  });
}

/**
 * Download server files
 */
async function downloadServer(): Promise<void> {
  logInfo("Checking server files...");

  const downloadBinary = resolve(import.meta.dir, "download.ts");

  const proc = Bun.spawn(["bun", "run", downloadBinary], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env as Record<string, string>,
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    die("Server file download failed");
  }
}

/**
 * Generate configuration
 */
async function generateConfiguration(): Promise<void> {
  logInfo("Generating server configuration...");

  process.env.CONFIG_OUTPUT = CONFIG_FILE;

  const configBinary = resolve(import.meta.dir, "generate-config.ts");

  const proc = Bun.spawn(["bun", "run", configBinary], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env as Record<string, string>,
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    die("Configuration generation failed");
  }
}

/**
 * Build Java arguments
 */
function buildJavaArgs(): string[] {
  const args: string[] = [];

  // Memory settings
  const xms = process.env.JAVA_XMS || "1G";
  const xmx = process.env.JAVA_XMX || "4G";
  args.push(`-Xms${xms}`, `-Xmx${xmx}`);

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
  if (process.env.JAVA_OPTS) {
    const extraOpts = process.env.JAVA_OPTS.split(" ").filter((opt) => opt.trim().length > 0);
    args.push(...extraOpts);
  }

  // JAR file
  args.push("-jar", SERVER_JAR);

  // Hytale server arguments
  args.push("--assets", ASSETS_FILE);

  // Bind address
  const bindAddr = process.env.BIND_ADDRESS || "0.0.0.0";
  const port = process.env.SERVER_PORT || "5520";
  args.push("--bind", `${bindAddr}:${port}`);

  // Auth mode
  const authMode = process.env.AUTH_MODE || "authenticated";
  args.push("--auth-mode", authMode);

  // Disable sentry in dev mode
  if (process.env.DISABLE_SENTRY === "true") {
    args.push("--disable-sentry");
  }

  // Accept early plugins (unsupported)
  if (process.env.ACCEPT_EARLY_PLUGINS === "true") {
    logWarn("Early plugins enabled - this is unsupported and may cause stability issues");
    args.push("--accept-early-plugins");
  }

  // Allow operator commands
  if (process.env.ALLOW_OP === "true") {
    args.push("--allow-op");
  }

  // Backups
  if (process.env.ENABLE_BACKUPS === "true") {
    args.push("--backup");
    args.push("--backup-dir", process.env.BACKUP_DIR || "/data/backups");
    args.push("--backup-frequency", process.env.BACKUP_FREQUENCY || "30");
    logInfo(
      `Backups enabled: every ${process.env.BACKUP_FREQUENCY || "30"} minutes to ${
        process.env.BACKUP_DIR || "/data/backups"
      }`
    );
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

  if (process.env.DRY_RUN === "true") {
    logInfo(`[DRY_RUN] Would start server with: java ${javaArgs.join(" ")}`);
    logInfo("[DRY_RUN] Entrypoint complete, exiting.");
    process.exit(0);
  }

  // Change to data directory
  process.chdir(DATA_DIR);

  // Start server
  serverProcess = Bun.spawn(["java", ...javaArgs], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env as Record<string, string>,
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

  // Phase 2: Generate configuration (optional - Hytale uses its own config)
  // await generateConfiguration();

  // Phase 3: Start server
  await startServer();
}

// Run main if executed directly
if (import.meta.main) {
  main().catch((error) => {
    die(`Entrypoint failed: ${error}`);
  });
}
