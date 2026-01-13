/**
 * Logging Utilities
 * Provides structured logging with levels, colors, and timestamps
 */

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// ANSI color codes (disabled if not a TTY - check stderr since that's where we write)
const isTTY = Bun.stderr.isTTY;
const COLOR_RESET = isTTY ? "\x1b[0m" : "";
const COLOR_DEBUG = isTTY ? "\x1b[0;36m" : ""; // Cyan
const COLOR_INFO = isTTY ? "\x1b[0;32m" : ""; // Green
const COLOR_WARN = isTTY ? "\x1b[0;33m" : ""; // Yellow
const COLOR_ERROR = isTTY ? "\x1b[0;31m" : ""; // Red

// Global state
let currentLogLevel = LogLevel.INFO;

/**
 * Set the current log level from environment variable or default
 */
export function initLogLevel(): void {
  const logLevelEnv = process.env.LOG_LEVEL?.toUpperCase();
  switch (logLevelEnv) {
    case "DEBUG":
      currentLogLevel = LogLevel.DEBUG;
      break;
    case "INFO":
      currentLogLevel = LogLevel.INFO;
      break;
    case "WARN":
      currentLogLevel = LogLevel.WARN;
      break;
    case "ERROR":
      currentLogLevel = LogLevel.ERROR;
      break;
    default:
      currentLogLevel = LogLevel.INFO;
  }
}

/**
 * Core logging function
 */
function log(level: LogLevel, levelName: string, color: string, message: string): void {
  // Skip if below current log level
  if (level < currentLogLevel) {
    return;
  }

  // Format: [TIMESTAMP] [LEVEL] message
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  const formattedMessage = `${color}[${timestamp}] [${levelName.padEnd(5)}] ${message}${COLOR_RESET}\n`;

  // Write to stderr for logging
  Bun.write(Bun.stderr, formattedMessage);
}

/**
 * Public logging functions
 */
export function logDebug(message: string): void {
  log(LogLevel.DEBUG, "DEBUG", COLOR_DEBUG, message);
}

export function logInfo(message: string): void {
  log(LogLevel.INFO, "INFO", COLOR_INFO, message);
}

export function logWarn(message: string): void {
  log(LogLevel.WARN, "WARN", COLOR_WARN, message);
}

export function logError(message: string): void {
  log(LogLevel.ERROR, "ERROR", COLOR_ERROR, message);
}

/**
 * Log and exit with error
 */
export function die(message: string, exitCode: number = 1): never {
  logError(message);
  process.exit(exitCode);
}

/**
 * Print a separator line
 */
export function logSeparator(): void {
  logInfo("============================================================");
}

/**
 * Print startup banner
 */
export function logBanner(): void {
  const version = process.env.HYTALE_VERSION || "unknown";
  const downloadMode = process.env.DOWNLOAD_MODE || "auto";

  logSeparator();
  logInfo("Hytale Dedicated Server - Docker Container");
  logInfo(`Version: ${version}`);
  logInfo(`Mode: ${downloadMode}`);
  logSeparator();
}

// Initialize log level on module load
initLogLevel();
