#!/usr/bin/env bun
/**
 * Health Check Script
 * Verifies the Hytale server is running and healthy.
 * Used by Docker HEALTHCHECK directive.
 *
 * Exit codes:
 *   0 - Healthy
 *   1 - Unhealthy
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const PID_FILE = resolve(DATA_DIR, "server.pid");
const SERVER_PORT = process.env.SERVER_PORT || "5520";

/**
 * Check if Java process is running
 */
async function checkProcess(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["pgrep", "-f", "java.*HytaleServer"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Check PID file if it exists
 */
async function checkPidFile(): Promise<boolean> {
  if (!existsSync(PID_FILE)) {
    // No PID file, check process directly
    return true;
  }

  try {
    const pidStr = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return false;
    }

    // Check if process exists by sending signal 0
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // Process doesn't exist
      return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * Check if UDP port is listening
 */
async function checkPort(): Promise<boolean> {
  // Try ss first, fallback to netstat
  try {
    const ssProc = Bun.spawn(["ss", "-uln"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(ssProc.stdout).text();
    const exitCode = await ssProc.exited;

    if (exitCode === 0) {
      return output.includes(`:${SERVER_PORT} `);
    }
  } catch (error) {
    // ss not available, try netstat
  }

  try {
    const netstatProc = Bun.spawn(["netstat", "-uln"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(netstatProc.stdout).text();
    const exitCode = await netstatProc.exited;

    if (exitCode === 0) {
      return output.includes(`:${SERVER_PORT} `);
    }
  } catch (error) {
    // Neither available, just check process
  }

  // If neither command is available, just return true (process check is sufficient)
  return true;
}

/**
 * Main health check
 */
async function main(): Promise<void> {
  // Check process is running
  if (!(await checkProcess())) {
    console.error("UNHEALTHY: Java process not running");
    process.exit(1);
  }

  // Check PID file
  if (!(await checkPidFile())) {
    console.error("UNHEALTHY: PID file exists but process not running");
    process.exit(1);
  }

  // Check port (optional, may fail during startup)
  if (!(await checkPort())) {
    console.error("UNHEALTHY: UDP port not listening");
    process.exit(1);
  }

  console.log("HEALTHY");
  process.exit(0);
}

// Run main
main().catch((error) => {
  console.error("UNHEALTHY: Health check failed with error:", error);
  process.exit(1);
});
