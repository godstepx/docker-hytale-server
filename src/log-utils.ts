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

// ANSI color codes (disabled if not a TTY or NO_COLOR is set)
import { NO_COLOR } from "./config.ts";
const isTTY = process.stderr.isTTY ?? false;
const useColor = isTTY && !NO_COLOR;
const COLOR_RESET = useColor ? "\x1b[0m" : "";
const COLOR_DIM = useColor ? "\x1b[2m" : ""; // Dim/gray for timestamp
const COLOR_DEBUG = useColor ? "\x1b[0;36m" : ""; // Cyan
const COLOR_INFO = useColor ? "\x1b[0;32m" : ""; // Green
const COLOR_WARN = useColor ? "\x1b[0;33m" : ""; // Yellow
const COLOR_ERROR = useColor ? "\x1b[0;31m" : ""; // Red

// Global state
let currentLogLevel = LogLevel.INFO;
const LOG_LEVELS: Record<string, LogLevel> = {
  DEBUG: LogLevel.DEBUG,
  INFO: LogLevel.INFO,
  WARN: LogLevel.WARN,
  ERROR: LogLevel.ERROR,
};

/**
 * Set the current log level from environment variable or default
 */
export function initLogLevel(): void {
  const logLevelEnv = process.env.CONTAINER_LOG_LEVEL?.toUpperCase() ?? "";
  currentLogLevel = LOG_LEVELS[logLevelEnv] ?? LogLevel.INFO;
}

// Log prefix to distinguish from Hytale server logs
const LOG_PREFIX = "[Container]";

/**
 * Core logging function
 */
function log(level: LogLevel, levelName: string, color: string, message: string): void {
  // Skip if below current log level
  if (level < currentLogLevel) {
    return;
  }

  // Format: [TIMESTAMP] [LEVEL] [Container] message
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  const formattedMessage = `${COLOR_DIM}[${timestamp}]${COLOR_RESET} ${color}[${levelName.padEnd(5)}]${COLOR_RESET} ${LOG_PREFIX} ${message}\n`;

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
export function fatal(context: string, error?: unknown, exitCode: number = 1): never {
  if (error instanceof Error) {
    logError(`${context}: ${error.message}`);
  } else if (error !== undefined) {
    logError(`${context}: ${String(error)}`);
  } else {
    logError(context);
  }
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
  logSeparator();
  logInfo("Hytale Dedicated Server - Docker Container");
  logSeparator();
}

// Initialize log level on module load
initLogLevel();
