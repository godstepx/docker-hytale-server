#!/usr/bin/env bun
/**
 * Download Adapter - Hytale Server Files Management
 * Handles obtaining server files via multiple methods:
 *   1. MANUAL: User provides files via volume mount (no auth needed)
 *   2. CLI: Official Hytale Downloader CLI with OAuth2 (recommended)
 *   3. LAUNCHER_PATH: Copy from local Hytale launcher installation
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  renameSync,
  readdirSync,
} from "fs";
import { resolve as resolvePath, basename } from "path";
import { cp } from "fs/promises";
import { logInfo, logWarn, logError, logDebug, logSeparator, die } from "./log-utils.ts";
import {
  DATA_DIR,
  BUNDLED_CLI_DIR,
  USER_CLI_DIR,
  AUTH_CACHE,
  SERVER_DIR,
  ASSETS_FILE,
  VERSION_FILE,
  DOWNLOAD_MODE,
  HYTALE_CLI_URL,
  LAUNCHER_PATH,
  DOWNLOAD_MAX_RETRIES,
  DOWNLOAD_INITIAL_BACKOFF,
  HYTALE_PATCHLINE,
  FORCE_DOWNLOAD,
  CHECK_UPDATES,
  SKIP_CLI_UPDATE_CHECK,
  DRY_RUN,
} from "./config.ts";

/**
 * Calculate exponential backoff with jitter
 */
function calculateBackoff(attempt: number): number {
  const baseBackoff = DOWNLOAD_INITIAL_BACKOFF * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 5);
  return baseBackoff + jitter;
}

// Cached CLI binary path (resolved once, reused)
let cachedCliBinary: string | null = null;

/**
 * Get or resolve CLI binary path (cached after first call)
 */
function getOrResolveCli(): string {
  if (cachedCliBinary) return cachedCliBinary;
  cachedCliBinary = getCliBinaryPath();
  if (!cachedCliBinary) {
    die("CLI binary not found. Bundled CLI should always be present.");
  }
  return cachedCliBinary;
}

/**
 * Clear CLI cache (call after downloading new CLI)
 */
function clearCliCache(): void {
  cachedCliBinary = null;
}

/**
 * Build CLI args with common flags
 */
function buildCliArgs(args: string[]): string[] {
  // Always specify credentials path to persist auth in the volume
  const credentialsPath = resolvePath(AUTH_CACHE, "credentials.json");
  const fullArgs = ["-credentials-path", credentialsPath, ...args];

  if (SKIP_CLI_UPDATE_CHECK) {
    fullArgs.push("-skip-update-check");
  }
  return fullArgs;
}

/**
 * Run CLI command synchronously (for quick commands like -print-version)
 */
function runCliSync(args: string[]): { exitCode: number; stdout: string } {
  // Ensure auth cache directory exists before CLI runs
  mkdirSync(AUTH_CACHE, { recursive: true });

  const cliBin = getOrResolveCli();
  const proc = Bun.spawnSync([cliBin, ...buildCliArgs(args)]);
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
  };
}

/**
 * Run CLI command asynchronously with interactive I/O (for downloads with OAuth)
 */
async function runCliAsync(args: string[]): Promise<number> {
  // Ensure auth cache directory exists before CLI runs
  mkdirSync(AUTH_CACHE, { recursive: true });

  const cliBin = getOrResolveCli();
  const proc = Bun.spawn([cliBin, ...buildCliArgs(args)], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await proc.exited;
}

/**
 * Detect CLI binary in a specific directory
 */
function detectCliBinaryIn(dir: string): string | null {
  const binaryNames = [
    "hytale-downloader-linux-amd64",
    "hytale-downloader-linux-arm64",
    "hytale-downloader",
  ];

  for (const name of binaryNames) {
    const candidate = resolvePath(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Get CLI binary path
 * Priority: 1) User CLI (if exists), 2) Bundled CLI (fallback)
 */
function getCliBinaryPath(): string | null {
  // Check user CLI first (may have been downloaded previously or via FORCE_DOWNLOAD)
  const userCli = detectCliBinaryIn(USER_CLI_DIR);
  if (userCli) return userCli;

  // Fall back to bundled CLI (always present in image)
  return detectCliBinaryIn(BUNDLED_CLI_DIR);
}

/**
 * Unzip a file to a directory using system unzip command
 */
async function unzipFile(zipPath: string, targetDir: string): Promise<void> {
  mkdirSync(targetDir, { recursive: true });

  const proc = Bun.spawn(["unzip", "-q", "-o", zipPath, "-d", targetDir], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`unzip failed with exit code ${exitCode}`);
  }
}

/**
 * Download Hytale CLI to user directory (fallback if bundled CLI not present)
 */
async function downloadCli(): Promise<void> {
  logInfo("Downloading Hytale Downloader CLI...");

  mkdirSync(USER_CLI_DIR, { recursive: true });

  const tempZipPath = resolvePath(USER_CLI_DIR, "cli-download.zip");

  let attempt = 1;
  while (attempt <= DOWNLOAD_MAX_RETRIES) {
    logInfo(`Download attempt ${attempt}/${DOWNLOAD_MAX_RETRIES}...`);

    try {
      const response = await fetch(HYTALE_CLI_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Save to temp file
      const buffer = new Uint8Array(await response.arrayBuffer());
      writeFileSync(tempZipPath, buffer);

      logInfo("Extracting CLI...");
      await unzipFile(tempZipPath, USER_CLI_DIR);

      // Cleanup temp file
      rmSync(tempZipPath, { force: true });

      // Verify we can find the binary
      const binary = detectCliBinaryIn(USER_CLI_DIR);
      if (binary) {
        logInfo(`CLI downloaded successfully: ${basename(binary)}`);
        return;
      } else {
        die(`CLI extracted but no executable found in ${USER_CLI_DIR}`);
      }
    } catch (error) {
      rmSync(tempZipPath, { force: true }); // Cleanup on error
      const backoff = calculateBackoff(attempt);
      logWarn(`Download failed (${error}), retrying in ${backoff}s...`);
      await Bun.sleep(backoff * 1000);
      attempt++;
    }
  }

  die(`Failed to download Hytale CLI after ${DOWNLOAD_MAX_RETRIES} attempts`);
}

/**
 * Ensure CLI is ready - downloads fresh CLI to user dir if FORCE_DOWNLOAD
 */
async function ensureCli(): Promise<void> {
  if (FORCE_DOWNLOAD) {
    // Download fresh CLI to user directory
    logInfo("FORCE_DOWNLOAD: Downloading fresh CLI...");
    await downloadCli();
    // Clear cache so we pick up the newly downloaded CLI
    clearCliCache();
  }

  // Log which CLI we're using
  const binary = getOrResolveCli();
  const isUserCli = binary.startsWith(USER_CLI_DIR);
  logInfo(`Using ${isUserCli ? "user" : "bundled"} CLI: ${basename(binary)}`);
}

/**
 * Check if existing server files are present
 */
function checkExistingFiles(): boolean {
  const serverJar = resolvePath(SERVER_DIR, "HytaleServer.jar");

  if (existsSync(serverJar) && existsSync(ASSETS_FILE)) {
    logInfo("Server files already exist");

    if (FORCE_DOWNLOAD) {
      logInfo("FORCE_DOWNLOAD=true, re-downloading...");
      return false;
    }

    if (CHECK_UPDATES) {
      logInfo("Checking for updates...");
      try {
        const result = runCliSync(["-print-version"]);
        if (result.exitCode === 0) {
          const latestVersion = result.stdout;
          const installedVersion = getInstalledVersion();

          if (installedVersion === "unknown") {
            logInfo(`Latest version: ${latestVersion} (installed version unknown)`);
          } else if (latestVersion === installedVersion) {
            logInfo(`Server is up to date (${installedVersion})`);
          } else {
            logWarn(`Update available: ${installedVersion} -> ${latestVersion}`);
            logInfo("Set FORCE_DOWNLOAD=true to update");
          }
        }
      } catch (error) {
        logDebug(`Failed to check version: ${error}`);
      }
    }

    return true;
  }

  return false;
}

/**
 * Download server files using the CLI
 */
async function downloadServerFiles(): Promise<void> {
  logInfo("Starting server file download...");

  const downloadPath = resolvePath(DATA_DIR, "game.zip");

  // Clean up any leftover game.zip from previous failed runs
  try {
    rmSync(downloadPath, { force: true });
  } catch (error) {
    logWarn(`Could not clean up old game.zip: ${error}`);
  }

  const downloadArgs = ["-download-path", downloadPath];

  // Add patchline if not release
  if (HYTALE_PATCHLINE !== "release") {
    downloadArgs.push("-patchline", HYTALE_PATCHLINE);
  }

  logSeparator();
  logInfo("Running Hytale Downloader...");
  logInfo("If this is your first time, you will need to authorize:");
  logSeparator();
  console.log(""); // Blank line before CLI output

  const exitCode = await runCliAsync(downloadArgs);

  console.log(""); // Blank line after CLI output
  logSeparator();

  if (exitCode !== 0) {
    die("Hytale Downloader failed. Please check the output above.");
  }

  logInfo("Download complete, extracting...");

  // Extract the downloaded archive
  if (existsSync(downloadPath)) {
    // Extract directly to DATA_DIR (creates Server/ and Assets.zip there)
    await unzipFile(downloadPath, DATA_DIR);

    // Debug: List what was extracted
    try {
      const items = readdirSync(DATA_DIR);
      logDebug(`Extracted items in ${DATA_DIR}: ${items.join(", ")}`);
    } catch (e) {
      logDebug(`Could not list ${DATA_DIR}: ${e}`);
    }

    // Rename Server/ to server/ (our expected location)
    // Note: On case-insensitive filesystems, Server/ and server/ are the same
    const extractedServerDir = resolvePath(DATA_DIR, "Server");
    const serverJar = resolvePath(SERVER_DIR, "HytaleServer.jar");

    if (existsSync(extractedServerDir) && extractedServerDir !== SERVER_DIR) {
      logDebug(`Renaming ${extractedServerDir} to ${SERVER_DIR}`);
      // Remove old server dir if it exists
      if (existsSync(SERVER_DIR)) {
        rmSync(SERVER_DIR, { recursive: true, force: true });
      }
      // Rename Server -> server
      renameSync(extractedServerDir, SERVER_DIR);
    } else if (existsSync(serverJar)) {
      // Files extracted directly to server/ (case-insensitive filesystem)
      logDebug("Server files already in correct location");
    } else {
      die("Extraction failed: Server directory not found after unzip");
    }

    // Assets.zip is already in the right place (DATA_DIR/Assets.zip)

    // Cleanup downloaded archive
    rmSync(downloadPath, { force: true });

    saveVersionInfo("cli");
    logInfo("Server files ready!");
  } else {
    die("Expected game.zip not found after download");
  }
}

/**
 * Save version information
 */
function saveVersionInfo(source: string): void {
  let version = "unknown";

  try {
    const result = runCliSync(["-print-version"]);
    if (result.exitCode === 0) {
      version = result.stdout;
    }
  } catch (error) {
    // Ignore
  }

  const versionInfo = {
    version,
    source,
    patchline: HYTALE_PATCHLINE,
    downloaded_at: new Date().toISOString(),
  };

  writeFileSync(VERSION_FILE, JSON.stringify(versionInfo, null, 2), "utf-8");
  logInfo(`Version info saved: ${version} (${source})`);
}

/**
 * Get installed version
 */
function getInstalledVersion(): string {
  if (existsSync(VERSION_FILE)) {
    try {
      const content = readFileSync(VERSION_FILE, "utf-8");
      const versionInfo = JSON.parse(content);
      return versionInfo.version || "unknown";
    } catch (error) {
      return "unknown";
    }
  }
  return "unknown";
}

/**
 * Show manual instructions
 */
function showManualInstructions(): void {
  logSeparator();
  logError("Server files not found!");
  logSeparator();
  logInfo("");
  logInfo("Please provide server files using one of these methods:");
  logInfo("");
  logInfo("Option 1: Copy from your Hytale Launcher installation");
  logInfo("  Source locations:");
  logInfo("    Windows: %appdata%\\Hytale\\install\\release\\package\\game\\latest");
  logInfo("    Linux:   $XDG_DATA_HOME/Hytale/install/release/package/game/latest");
  logInfo("    MacOS:   ~/Application Support/Hytale/install/release/package/game/latest");
  logInfo("");
  logInfo("  Copy 'Server/' folder and 'Assets.zip' to your data volume:");
  logInfo("    docker cp ./Server hytale-server:/data/server");
  logInfo("    docker cp ./Assets.zip hytale-server:/data/Assets.zip");
  logInfo("");
  logInfo("Option 2: Use Hytale Downloader CLI");
  logInfo("  Set HYTALE_CLI_URL environment variable to the CLI download URL");
  logInfo(
    "  (Get URL from: https://support.hytale.com/hc/en-us/articles/45326769420827-Hytale-Server-Manual)"
  );
  logInfo("");
  logInfo("Option 3: Mount launcher directory directly");
  logInfo("  docker run -v /path/to/Hytale/install/release/package/game/latest:/launcher:ro \\");
  logInfo("             -e LAUNCHER_PATH=/launcher \\");
  logInfo("             -v hytale-data:/data ...");
  logInfo("");
  logSeparator();
}

/**
 * Copy from launcher installation
 */
async function copyFromLauncher(): Promise<boolean> {
  if (!LAUNCHER_PATH) {
    return false;
  }

  logInfo(`Copying server files from launcher: ${LAUNCHER_PATH}`);

  const launcherServer = resolvePath(LAUNCHER_PATH, "Server");
  const launcherAssets = resolvePath(LAUNCHER_PATH, "Assets.zip");

  if (!existsSync(launcherServer)) {
    logError(`Server directory not found at: ${launcherServer}`);
    return false;
  }

  if (!existsSync(launcherAssets)) {
    logError(`Assets.zip not found at: ${launcherAssets}`);
    return false;
  }

  // Ensure server dir exists and is empty
  if (existsSync(SERVER_DIR)) {
    rmSync(SERVER_DIR, { recursive: true, force: true });
  }
  mkdirSync(SERVER_DIR, { recursive: true });

  logInfo("Copying Server files...");
  await cp(launcherServer, SERVER_DIR, { recursive: true });

  logInfo("Copying Assets.zip...");
  copyFileSync(launcherAssets, ASSETS_FILE);

  saveVersionInfo("launcher");
  logInfo("Server files copied successfully!");
  return true;
}

/**
 * Main entry point for download module
 * Can be called directly or imported by other modules
 */
export async function ensureServerFiles(): Promise<void> {
  logInfo("Hytale Server File Manager");
  logInfo("==========================");
  logInfo(`Mode: ${DOWNLOAD_MODE}`);

  // DRY_RUN mode
  if (DRY_RUN) {
    logInfo("[DRY_RUN] Would obtain Hytale server files");
    logInfo(`[DRY_RUN] Download mode: ${DOWNLOAD_MODE}`);
    logInfo(`[DRY_RUN] CLI URL: ${HYTALE_CLI_URL || "<not set>"}`);
    logInfo(`[DRY_RUN] Launcher path: ${LAUNCHER_PATH || "<not set>"}`);
    logInfo(`[DRY_RUN] Patchline: ${HYTALE_PATCHLINE}`);
    logInfo(`[DRY_RUN] Server dir: ${SERVER_DIR}`);
    logInfo(`[DRY_RUN] Assets: ${ASSETS_FILE}`);
    return;
  }

  // Ensure directories exist
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SERVER_DIR, { recursive: true });

  // Check if files already exist
  if (checkExistingFiles()) {
    logInfo(`Using existing server files (version: ${getInstalledVersion()})`);
    return;
  }

  // Determine how to obtain files based on mode
  switch (DOWNLOAD_MODE) {
    case "manual":
      showManualInstructions();
      die("Server files must be provided manually. See instructions above.");

    case "launcher":
      if (await copyFromLauncher()) {
        logInfo("Server files ready!");
        return;
      } else {
        die("Failed to copy from launcher. Check LAUNCHER_PATH.");
      }

    case "cli":
      await ensureCli();
      await downloadServerFiles();
      break;

    case "auto":
    default:
      // Auto mode: Try methods in order of preference
      logInfo("Auto-detecting best method...");

      // 1. Try launcher path if set
      if (LAUNCHER_PATH) {
        logInfo("Trying launcher copy...");
        if (await copyFromLauncher()) {
          logInfo("Server files ready!");
          return;
        }
        logWarn("Launcher copy failed, trying next method...");
      }

      // 2. Try CLI if URL is set
      if (HYTALE_CLI_URL) {
        logInfo("Trying CLI download...");
        await ensureCli();
        await downloadServerFiles();
        logInfo("Server files ready!");
        return;
      }

      // 3. No automatic method available - show instructions
      showManualInstructions();
      die("No automatic download method available. See instructions above.");
  }
}
