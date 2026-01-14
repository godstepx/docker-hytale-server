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
import { readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { logInfo, logWarn, logError, logDebug, logBanner, die } from "./log-utils.ts";
import { downloadServer, buildJavaArgs, validateServerFiles, setupDirectories } from "./setup.ts";
import { writeConfigFiles } from "./config-writer.ts";
import { installCurseForgeMods } from "./mod-installer.ts";
import {
  acquireSessionTokens,
  startOAuthRefreshLoop,
  stopOAuthRefreshLoop,
} from "./token-manager.ts";
import { DATA_DIR, LOG_DIR, LOG_RETENTION_DAYS, DRY_RUN } from "./config.ts";

// Track the Java server process for signal handling
let javaProcess: Subprocess | null = null;
let isShuttingDown = false;
let logCleanupRunning = false;

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
      // Only clean up .log files
      if (!file.endsWith(".log")) continue;

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
  const intervalMs = 24 * 60 * 60 * 1000; // 24 hours

  setTimeout(async () => {
    while (logCleanupRunning) {
      await Bun.sleep(intervalMs);
      if (!logCleanupRunning) break;
      cleanupOldLogs();
    }
  }, intervalMs); // First check after 24 hours (already ran at startup)
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
  logBanner();
  setupSignalHandlers();

  // Phase 1: Setup directories
  logInfo("Setting up directories...");
  setupDirectories();

  // Phase 2: Clean up old logs
  cleanupOldLogs();

  // Phase 3: Write config files (if needed)
  await writeConfigFiles();

  // Phase 4: Download server files (if needed)
  logInfo("Ensuring server files...");
  await downloadServer();

  // Phase 5: Validate files exist
  validateServerFiles();

  // Phase 6: Install mods (if configured)
  await installCurseForgeMods();

  // Phase 7: Acquire session tokens
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

  // Phase 8: Build Java command
  const javaArgs = buildJavaArgs(sessionTokens);

  if (DRY_RUN) {
    logInfo(`[DRY_RUN] Would run: java ${javaArgs.join(" ")}`);
    logInfo("[DRY_RUN] Entrypoint complete, exiting.");
    process.exit(0);
  }

  // Phase 9: Start background tasks
  startOAuthRefreshLoop(); // Keeps refresh token alive for 30+ day runs
  startLogCleanupLoop(); // Daily log cleanup

  // Phase 10: Start Java server
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
  die(`Fatal error: ${error}`);
});
