#!/usr/bin/env bun
/**
 * Download Adapter - Hytale Server Files Management
 * Handles obtaining server files via multiple methods:
 *   1. MANUAL: User provides files via volume mount (no auth needed)
 *   2. CLI: Official Hytale Downloader CLI with OAuth2 (recommended)
 *   3. LAUNCHER_PATH: Copy from local Hytale launcher installation
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "fs";
import { resolve as resolvePath, basename } from "path";
import { cp } from "fs/promises";
import { unzip } from "fflate";
import {
  logInfo,
  logWarn,
  logError,
  logDebug,
  logSeparator,
  die,
} from "./log-utils.ts";
import {
  DATA_DIR,
  CLI_DIR,
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

/**
 * Detect CLI binary in the CLI directory
 */
function detectCliBinary(): string | null {
  const candidates = [
    resolvePath(CLI_DIR, "hytale-downloader-linux-amd64"),
    resolvePath(CLI_DIR, "hytale-downloader-linux-arm64"),
    resolvePath(CLI_DIR, "hytale-downloader"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Unzip a buffer to a directory using fflate
 */
async function unzipBuffer(buffer: Uint8Array, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    unzip(buffer, (err, unzipped) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        mkdirSync(targetDir, { recursive: true });

        for (const [filename, data] of Object.entries(unzipped)) {
          const filePath = resolvePath(targetDir, filename);
          const fileDir = resolvePath(filePath, "..");

          // Create directory if needed
          mkdirSync(fileDir, { recursive: true });

          // Write file
          writeFileSync(filePath, data);

          // Make executable if it looks like a binary
          if (
            filename.includes("hytale-downloader") ||
            filename.endsWith(".sh") ||
            filename.endsWith(".bin")
          ) {
            try {
              const proc = Bun.spawnSync(["chmod", "+x", filePath]);
              if (proc.exitCode !== 0) {
                logWarn(`Failed to make ${filename} executable`);
              }
            } catch (error) {
              logWarn(`Failed to make ${filename} executable: ${error}`);
            }
          }
        }

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Download Hytale CLI
 */
async function downloadCli(): Promise<void> {
  logInfo("Downloading Hytale Downloader CLI...");

  mkdirSync(CLI_DIR, { recursive: true });

  let attempt = 1;
  while (attempt <= DOWNLOAD_MAX_RETRIES) {
    logInfo(`Download attempt ${attempt}/${DOWNLOAD_MAX_RETRIES}...`);

    try {
      const response = await fetch(HYTALE_CLI_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      logInfo("Extracting CLI...");

      await unzipBuffer(buffer, CLI_DIR);

      // Verify we can find the binary
      const binary = detectCliBinary();
      if (binary) {
        logInfo(`CLI downloaded successfully: ${basename(binary)}`);
        return;
      } else {
        die(`CLI extracted but no executable found in ${CLI_DIR}`);
      }
    } catch (error) {
      const backoff = calculateBackoff(attempt);
      logWarn(`Download failed (${error}), retrying in ${backoff}s...`);
      await Bun.sleep(backoff * 1000);
      attempt++;
    }
  }

  die(`Failed to download Hytale CLI after ${DOWNLOAD_MAX_RETRIES} attempts`);
}

/**
 * Get CLI binary path
 */
function getCliBinary(): string {
  const binary = detectCliBinary();
  if (!binary) {
    die("CLI binary not found. Run download first.");
  }
  return binary;
}

/**
 * Ensure CLI is present
 */
async function ensureCli(): Promise<void> {
  const binary = detectCliBinary();

  if (!binary) {
    await downloadCli();
  } else {
    logDebug(`CLI already present at ${binary}`);
  }
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
      const cliBin = detectCliBinary();
      if (cliBin) {
        logInfo("Checking for updates...");
        try {
          const proc = Bun.spawnSync([cliBin, "-print-version"]);
          if (proc.exitCode === 0) {
            const currentVersion = new TextDecoder().decode(proc.stdout).trim();
            logInfo(`Latest version available: ${currentVersion}`);
            // TODO: Compare with installed version
          }
        } catch (error) {
          logDebug(`Failed to check version: ${error}`);
        }
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

  // Ensure auth cache directory exists
  mkdirSync(AUTH_CACHE, { recursive: true });

  // Set HOME to auth cache so CLI stores tokens there
  process.env.HOME = AUTH_CACHE;
  process.env.XDG_CONFIG_HOME = AUTH_CACHE;

  const downloadPath = resolvePath(DATA_DIR, "game.zip");
  const downloadArgs = ["-download-path", downloadPath];

  // Add patchline if not release
  if (HYTALE_PATCHLINE !== "release") {
    downloadArgs.push("-patchline", HYTALE_PATCHLINE);
  }

  logSeparator();
  logInfo("Running Hytale Downloader...");
  logInfo("If this is your first time, you will need to authorize:");
  logSeparator();

  // Get CLI binary path
  const cliBin = getCliBinary();

  // Run the CLI - it will handle auth interactively
  const proc = Bun.spawn([cliBin, ...downloadArgs], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    die("Hytale Downloader failed. Please check the output above.");
  }

  logInfo("Download complete, extracting...");

  // Extract the downloaded archive
  if (existsSync(downloadPath)) {
    const buffer = new Uint8Array(await Bun.file(downloadPath).arrayBuffer());

    // Extract to temp directory first
    const tempDir = resolvePath(DATA_DIR, "temp-extract");
    await unzipBuffer(buffer, tempDir);

    // Move files to expected locations
    const serverSrcDir = resolvePath(tempDir, "Server");
    if (existsSync(serverSrcDir)) {
      // Remove old server dir if it exists
      if (existsSync(SERVER_DIR)) {
        rmSync(SERVER_DIR, { recursive: true, force: true });
      }
      await cp(serverSrcDir, SERVER_DIR, { recursive: true });
    }

    const assetsSrc = resolvePath(tempDir, "Assets.zip");
    if (existsSync(assetsSrc)) {
      copyFileSync(assetsSrc, ASSETS_FILE);
    }

    // Cleanup
    rmSync(downloadPath, { force: true });
    rmSync(tempDir, { recursive: true, force: true });

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

  const cliBin = detectCliBinary();
  if (cliBin) {
    try {
      const proc = Bun.spawnSync([cliBin, "-print-version"]);
      if (proc.exitCode === 0) {
        version = new TextDecoder().decode(proc.stdout).trim();
      }
    } catch (error) {
      // Ignore
    }
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
  logInfo(
    "  docker run -v /path/to/Hytale/install/release/package/game/latest:/launcher:ro \\"
  );
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
