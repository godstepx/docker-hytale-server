#!/usr/bin/env bun
/**
 * Hytale Server Entrypoint
 *
 * Main entry point for the Docker container that:
 * 1. Cleans up old log files
 * 2. Downloads server files (if needed)
 * 3. Acquires OAuth tokens and creates game session
 * 4. Starts Java server with session tokens
 * 5. Runs background OAuth refresh for indefinite authentication
 * 6. Handles signals for graceful shutdown
 *
 * The Hytale server handles game session refresh internally when started
 * with --session-token and --identity-token flags. (https://support.hytale.com/hc/en-us/articles/45328341414043-Server-Provider-Authentication-Guide#token-lifecycle)
 */

import { Subprocess } from "bun";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { logInfo, logWarn, logError, logDebug, logBanner, fatal } from "./log-utils.ts";
import {
  downloadServer,
  ensureReadOnlyServerJar,
  buildJavaArgs,
  validateServerFiles,
  setupDirectories,
} from "./setup.ts";
import { writeConfigFiles } from "./config-writer.ts";
import { installMods } from "./mod-installer/index.ts";
import { runDiagnostics } from "./diagnostics.ts";
import {
  acquireSessionTokens,
  startOAuthRefreshLoop,
  stopOAuthRefreshLoop,
} from "./token-manager.ts";
import { DATA_DIR, LOG_DIR, LOG_RETENTION_DAYS, DRY_RUN, DIAGNOSTICS } from "./config.ts";

// Track the Java server process for signal handling
let javaProcess: Subprocess | null = null;
let isShuttingDown = false;
let logCleanupRunning = false;
const APP_DIR = "/opt/hytale";
const ENTRYPOINT_PATH = `${APP_DIR}/bin/entrypoint`;
const LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MACHINE_ID_PATH = "/etc/machine-id";
const PERSISTENT_MACHINE_ID = join(DATA_DIR, ".machine-id");

function ensureMachineId(): void {
  try {
    if (existsSync(MACHINE_ID_PATH)) {
      logInfo("Using machine-id from host");
      return;
    }
    
    if (existsSync(PERSISTENT_MACHINE_ID)) {
      const existing = readFileSync(PERSISTENT_MACHINE_ID, "utf-8");
      writeFileSync(MACHINE_ID_PATH, existing.trim(), "utf-8");
      logInfo("Loaded persistent machine-id from data volume");
      return;
    }

    const uuid = new TextDecoder()
      .decode(Bun.spawnSync(["cat", "/proc/sys/kernel/random/uuid"]).stdout ?? new Uint8Array())
      .trim()
      .replace(/-/g, "");
    writeFileSync(MACHINE_ID_PATH, uuid, "utf-8");
    writeFileSync(PERSISTENT_MACHINE_ID, uuid, "utf-8");
    logInfo("Generated and persisted machine-id");
  } catch (error) {
    logWarn(`Failed to setup machine-id: ${error}`);
  }
}

function fixPermissionsAndDropPrivileges(): void {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }

  ensureMachineId();

  logInfo("Fixing volume permissions...");
  Bun.spawnSync(["chown", "-R", "hytale:hytale", DATA_DIR], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  Bun.spawnSync(["chown", "-R", "hytale:hytale", APP_DIR], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  logInfo("Dropping privileges to hytale user...");
  try {
    const result = Bun.spawnSync(["su-exec", "hytale", ENTRYPOINT_PATH, ...process.argv.slice(1)], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    process.exit(result.exitCode ?? 1);
  } catch (error) {
    fatal("Failed to drop privileges with su-exec", error);
  }
}

/**
 * Clean up old log files to prevent disk overflow
 * Deletes Hytale server logs older than LOG_RETENTION_DAYS
 */
function cleanupOldLogs(): void {
  if (LOG_RETENTION_DAYS <= 0) {
    logDebug("Log cleanup disabled (LOG_RETENTION_DAYS=0)");
    return;
  }

  try {
    const files = readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      // Only clean up .log and .log.lck files
      if (!file.endsWith(".log") && !file.endsWith(".log.lck")) continue;

      const filePath = join(LOG_DIR, file);
      try {
        const stats = statSync(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAgeMs) {
          unlinkSync(filePath);
          deletedCount++;
          logDebug(`Deleted old log: ${file}`);
        }
      } catch {
        // Ignore errors for individual files
      }
    }

    if (deletedCount > 0) {
      logInfo(`Cleaned up ${deletedCount} old log file(s)`);
    }
  } catch (error) {
    // Log directory might not exist yet, that's fine
    logDebug(`Log cleanup skipped: ${error}`);
  }
}

/**
 * Start background log cleanup loop (runs daily)
 */
function startLogCleanupLoop(): void {
  if (LOG_RETENTION_DAYS <= 0) return;

  logCleanupRunning = true;

  setTimeout(async () => {
    while (logCleanupRunning) {
      await Bun.sleep(LOG_CLEANUP_INTERVAL_MS);
      if (!logCleanupRunning) break;
      cleanupOldLogs();
    }
  }, LOG_CLEANUP_INTERVAL_MS); // First check after 24 hours (already ran at startup)
}

/**
 * Stop background log cleanup loop
 */
function stopLogCleanupLoop(): void {
  logCleanupRunning = false;
}

/**
 * Setup signal handlers for graceful shutdown
 */
function setupSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logWarn(`Already shutting down, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;

    logInfo(`Received ${signal}, shutting down gracefully...`);

    // Stop background tasks
    stopOAuthRefreshLoop();
    stopLogCleanupLoop();

    // Send SIGTERM to Java process
    if (javaProcess) {
      logInfo("Stopping Java server...");
      javaProcess.kill("SIGTERM");

      // Wait up to 30 seconds for graceful shutdown
      const timeout = setTimeout(() => {
        if (javaProcess) {
          logWarn("Server did not stop gracefully, forcing...");
          javaProcess.kill("SIGKILL");
        }
      }, 30000);

      try {
        await javaProcess.exited;
        clearTimeout(timeout);
        logInfo("Server stopped gracefully");
      } catch {
        clearTimeout(timeout);
      }
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

/**
 * Main entrypoint function
 */
async function main(): Promise<void> {
  fixPermissionsAndDropPrivileges();
  logBanner();
  setupSignalHandlers();

  // Phase 1: Setup directories
  logInfo("Setting up directories...");
  setupDirectories();

  // Optional: Run diagnostics
  if (DIAGNOSTICS) {
    runDiagnostics();
  }

  // Phase 2: Clean up old logs
  cleanupOldLogs();

  // Phase 3: Write config files (if needed)
  await writeConfigFiles();

  // Phase 4: Download server files (if needed)
  logInfo("Ensuring server files...");
  await downloadServer();

  // Phase 5: Validate files exist
  validateServerFiles();

  // Phase 6: Copy server JAR to read-only location
  ensureReadOnlyServerJar();

  // Phase 7: Install mods (if configured)
  await installMods();

  // Phase 8: Acquire session tokens
  logInfo("Acquiring session tokens...");
  const sessionTokens = await acquireSessionTokens();

  if (sessionTokens) {
    logInfo(`Authenticated as profile: ${sessionTokens.profileUuid}`);
    if (sessionTokens.expiresAt) {
      logInfo(`Session expires: ${sessionTokens.expiresAt}`);
    }
  } else {
    logWarn("No tokens available - server will start unauthenticated");
    logWarn("Use '/auth login device' in server console to authenticate");
  }

  // Phase 9: Build Java command
  const javaArgs = buildJavaArgs(sessionTokens);

  if (DRY_RUN) {
    logInfo(`[DRY_RUN] Would run: java ${javaArgs.join(" ")}`);
    logInfo("[DRY_RUN] Entrypoint complete, exiting.");
    process.exit(0);
  }

  // Phase 10: Start background tasks
  startOAuthRefreshLoop(); // Keeps refresh token alive for 30+ day runs
  startLogCleanupLoop(); // Daily log cleanup

  // Phase 11: Start Java server
  logInfo("Starting Hytale server...");

  javaProcess = Bun.spawn(["java", ...javaArgs], {
    cwd: DATA_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });

  // Wait for Java to exit
  const exitCode = await javaProcess.exited;

  // Stop background tasks
  stopOAuthRefreshLoop();
  stopLogCleanupLoop();

  logInfo(`Server exited with code: ${exitCode}`);
  process.exit(exitCode);
}

main().catch((error) => {
  logError(`Entrypoint failed: ${error}`);
  fatal("Fatal error", error);
});
