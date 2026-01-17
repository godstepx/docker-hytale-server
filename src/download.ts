/**
 * Hytale Server File Management
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
import { logInfo, logWarn, logError, logDebug, logSeparator, fatal } from "./log-utils.ts";
import { calculateBackoff } from "./utils.ts";
import {
  DATA_DIR,
  BUNDLED_CLI_DIR,
  USER_CLI_DIR,
  AUTH_CACHE,
  SERVER_DIR,
  DATA_SERVER_JAR,
  ASSETS_FILE,
  VERSION_FILE,
  DOWNLOAD_MODE,
  HYTALE_CLI_URL,
  LAUNCHER_PATH,
  DOWNLOAD_MAX_RETRIES,
  HYTALE_PATCHLINE,
  FORCE_DOWNLOAD,
  CHECK_UPDATES,
  SKIP_CLI_UPDATE_CHECK,
  DRY_RUN,
} from "./config.ts";

const CLI_CREDENTIALS_PATH = resolvePath(AUTH_CACHE, "credentials.json");

interface ModeHandler {
  ensure: () => Promise<void>;
}

function logServerFilesReady(): void {
  logInfo("Server files ready!");
}

// Cached CLI binary path (resolved once, reused)
let cachedCliBinary: string | null = null;
let cachedCliVersion: string | null = null;
let serverFilesCache: { serverJar: boolean; assets: boolean } | null = null;

function getServerFilesPresence(): { serverJar: boolean; assets: boolean } {
  if (serverFilesCache) return serverFilesCache;
  serverFilesCache = {
    serverJar: existsSync(DATA_SERVER_JAR),
    assets: existsSync(ASSETS_FILE),
  };
  return serverFilesCache;
}

function clearServerFilesCache(): void {
  serverFilesCache = null;
}

/**
 * Get or resolve CLI binary path (cached after first call)
 */
function getOrResolveCli(): string {
  if (cachedCliBinary) return cachedCliBinary;
  cachedCliBinary = getCliBinaryPath();
  if (!cachedCliBinary) {
    fatal("CLI binary not found. Bundled CLI should always be present.");
  }
  return cachedCliBinary;
}

/**
 * Clear CLI cache (call after downloading new CLI)
 */
function clearCliCache(): void {
  cachedCliBinary = null;
  cachedCliVersion = null;
}

/**
 * Build CLI args with common flags
 */
function buildCliArgs(args: string[]): string[] {
  // Always specify credentials path to persist auth in the volume
  const fullArgs = ["-credentials-path", CLI_CREDENTIALS_PATH, ...args];

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

function getCliVersionCached(): string {
  if (cachedCliVersion) return cachedCliVersion;
  let version = "unknown";
  try {
    const result = runCliSync(["-print-version"]);
    if (result.exitCode === 0 && result.stdout) {
      version = result.stdout;
    }
  } catch {
    // Ignore version check errors
  }
  cachedCliVersion = version;
  return version;
}

type CliResult = {
  exitCode: number;
  output: string;
};

async function captureCliOutput(
  stream: ReadableStream<Uint8Array> | null,
  writeTo: NodeJS.WriteStream
): Promise<string> {
  if (!stream) return "";
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    writeTo.write(chunk);
    chunks.push(chunk);
  }
  if (!chunks.length) return "";
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Run CLI command asynchronously with interactive I/O (for downloads with OAuth)
 */
async function runCliAsync(args: string[]): Promise<CliResult> {
  // Ensure auth cache directory exists before CLI runs
  mkdirSync(AUTH_CACHE, { recursive: true });

  const cliBin = getOrResolveCli();
  const proc = Bun.spawn([cliBin, ...buildCliArgs(args)], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    captureCliOutput(proc.stdout, process.stdout),
    captureCliOutput(proc.stderr, process.stderr),
    proc.exited,
  ]);

  const output = [stdout, stderr].filter(Boolean).join("\n");
  return { exitCode: exitCode ?? 1, output };
}

// Some how get the error message from the CLI output
function isCliAuthInvalid(output: string): boolean {
  return (
    /invalid_grant/i.test(output) ||
    /refresh token.*invalid/i.test(output) ||
    /401\s+Unauthorized/i.test(output) ||
    /403\s+Forbidden/i.test(output)
  );
}

function handleCliAuthFailure(output: string): void {
  if (!isCliAuthInvalid(output)) return;
  if (existsSync(CLI_CREDENTIALS_PATH)) {
    try {
      rmSync(CLI_CREDENTIALS_PATH, { force: true });
      logWarn("CLI auth token expired or revoked. Cleared credentials.json; re-auth required.");
    } catch (error) {
      logWarn(`Failed to clear CLI credentials.json: ${error}`);
    }
  } else {
    logWarn("CLI auth token expired or revoked. Re-auth required.");
  }
}

async function checkCliUpdate(): Promise<boolean> {
  logInfo("Checking CLI update status...");
  const result = await runCliAsync(["-check-update"]);
  if (result.exitCode !== 0) {
    handleCliAuthFailure(result.output);
    logWarn(`CLI update check failed (exit ${result.exitCode})`);
    return false;
  }
  return true;
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
  if (userCli) {
    logInfo(`Using user CLI: ${basename(userCli)}`);
    return userCli;
  }

  // Fall back to bundled CLI (always present in image)
  return detectCliBinaryIn(BUNDLED_CLI_DIR);
}

function logCliInfo(binary: string): void {
  const isUserCli = binary.startsWith(USER_CLI_DIR);
  const source = isUserCli ? "user" : "bundled";
  logInfo(`Using ${source} CLI: ${basename(binary)}`);
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
        fatal(`CLI extracted but no executable found in ${USER_CLI_DIR}`);
      }
    } catch (error) {
      rmSync(tempZipPath, { force: true }); // Cleanup on error
      const backoff = calculateBackoff(attempt);
      logWarn(`Download failed (${error}), retrying in ${backoff}s...`);
      await Bun.sleep(backoff * 1000);
      attempt++;
    }
  }

  fatal(`Failed to download Hytale CLI after ${DOWNLOAD_MAX_RETRIES} attempts`);
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
  logCliInfo(binary);
}

/**
 * Check if existing server files are present
 */
function hasExistingFiles(): boolean {
  const presence = getServerFilesPresence();
  return presence.serverJar && presence.assets;
}

async function checkForUpdates(): Promise<boolean> {
  if (!CHECK_UPDATES) return false;

  logInfo("Checking for updates...");
  try {
    const result = runCliSync(["-print-version"]);
    if (result.exitCode !== 0) return false;

    const latestVersion = result.stdout;
    const installedVersion = getInstalledVersion();

    if (installedVersion === "unknown") {
      logInfo(`Latest version: ${latestVersion} (installed version unknown)`);
      return true;
    } else if (latestVersion === installedVersion) {
      logInfo(`Server is up to date (${installedVersion})`);
      return false;
    } else {
      logWarn(`Update available: ${installedVersion} -> ${latestVersion}`);
      return true;
    }
  } catch (error) {
    logDebug(`Failed to check version: ${error}`);
  }

  return false;
}

/**
 * Download server files using the CLI
 */
async function downloadServerFiles(): Promise<void> {
  logInfo("Starting server file download...");
  clearServerFilesCache();

  const tempDir = "/tmp";
  const downloadPath = resolvePath(tempDir, "hytale-game.zip");
  mkdirSync(tempDir, { recursive: true });

  // Clean up any leftover archive from previous failed runs
  try {
    rmSync(downloadPath, { force: true });
  } catch (error) {
    logWarn(`Could not clean up old download archive: ${error}`);
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

  const result = await runCliAsync(downloadArgs);

  console.log(""); // Blank line after CLI output
  logSeparator();

  if (result.exitCode !== 0) {
    handleCliAuthFailure(result.output);
    fatal("Hytale Downloader failed. Please check the output above.");
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

    const extractedServerDir = resolvePath(DATA_DIR, "Server");
    const serverJar = DATA_SERVER_JAR;

    if (existsSync(serverJar)) {
      // Files already in correct location (case-insensitive filesystem extracted to server/)
      logDebug("Server files already in correct location");
    } else if (existsSync(extractedServerDir)) {
      // Case-sensitive filesystem: need to rename Server/ to server/
      logDebug(`Renaming ${extractedServerDir} to ${SERVER_DIR}`);
      renameSync(extractedServerDir, SERVER_DIR);
    } else {
      fatal("Extraction failed: Server directory not found after unzip");
    }

    // Assets.zip is already in the right place (DATA_DIR/Assets.zip)

    // Cleanup downloaded archive
    rmSync(downloadPath, { force: true });

    clearServerFilesCache();
    saveVersionInfo();
  } else {
    fatal("Expected download archive not found after download");
  }
}

/**
 * Save version information
 */
function saveVersionInfo(): void {
  const version = getCliVersionCached();

  const versionInfo = {
    version,
    patchline: HYTALE_PATCHLINE,
    downloaded_at: new Date().toISOString(),
  };

  writeFileSync(VERSION_FILE, JSON.stringify(versionInfo, null, 2), "utf-8");
  logInfo(`Version info saved: ${version}`);
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
  logInfo(
    `\nPlease provide server files using one of these methods:\n\n` +
      `Option 1 (Recommended): Use Hytale Downloader CLI\n` +
      `  Set DOWNLOAD_MODE=cli (HYTALE_CLI_URL is optional if using the bundled CLI)\n` +
      `  Custom CLI URL: https://support.hytale.com/hc/en-us/articles/45326769420827-Hytale-Server-Manual\n\n` +
      `Option 2: Copy from your Hytale Launcher installation\n` +
      `  Source locations:\n` +
      `    Windows: %appdata%\\Hytale\\install\\release\\package\\game\\latest\n` +
      `    Linux:   $XDG_DATA_HOME/Hytale/install/release/package/game/latest\n` +
      `    MacOS:   ~/Application Support/Hytale/install/release/package/game/latest\n\n` +
      `  Copy 'Server/' folder and 'Assets.zip' to your data volume:\n` +
      `    docker cp ./Server hytale-server:/data/server\n` +
      `    docker cp ./Assets.zip hytale-server:/data/Assets.zip\n\n` +
      `Option 3: Mount launcher directory directly\n` +
      `  docker run -v /path/to/Hytale/install/release/package/game/latest:/launcher:ro \\\n` +
      `             -e LAUNCHER_PATH=/launcher \\\n` +
      `             -v hytale-data:/data ...\n`
  );
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

  clearServerFilesCache();
  logInfo("Server files copied successfully!");
  return true;
}

const manualHandler: ModeHandler = {
  async ensure(): Promise<void> {
    showManualInstructions();
    fatal("Server files must be provided manually. See instructions above.");
  },
};

const launcherHandler: ModeHandler = {
  async ensure(): Promise<void> {
    if (await copyFromLauncher()) {
      logServerFilesReady();
      return;
    }
    fatal("Failed to copy from launcher. Check LAUNCHER_PATH.");
  },
};

const cliHandler: ModeHandler = {
  async ensure(): Promise<void> {
    await ensureCli();

    const updateOk = await checkCliUpdate();
    if (!updateOk) {
      fatal("CLI not logged in or auth expired. Please re-auth and try again.");
    }

    // Check if files already exist
    if (hasExistingFiles()) {
      if (FORCE_DOWNLOAD) {
        logInfo("FORCE_DOWNLOAD=true, re-downloading...");
      } else {
        const shouldDownload = await checkForUpdates();
        if (!shouldDownload) {
          logInfo(`Using existing server files (version: ${getInstalledVersion()})`);
          return;
        }
      }
    }

    await downloadServerFiles();
    logServerFilesReady();
  },
};

const autoHandler: ModeHandler = {
  async ensure(): Promise<void> {
    logInfo("Auto-detecting best method...");

    if (LAUNCHER_PATH) {
      logInfo("Using mode: launcher");
      await modeHandlers.launcher?.ensure();
      return;
    }

    if (HYTALE_CLI_URL) {
      logInfo("Using mode: cli");
      await modeHandlers.cli?.ensure();
      return;
    }

    await modeHandlers.manual?.ensure();
  },
};

const modeHandlers: Record<string, ModeHandler> = {
  manual: manualHandler,
  launcher: launcherHandler,
  cli: cliHandler,
  auto: autoHandler,
};

/**
 * Main entry point for download module
 * Can be called directly or imported by other modules
 */
export async function prepareServerFiles(): Promise<void> {
  logSeparator();
  logInfo("Hytale Server File Manager");
  logSeparator();
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
    logInfo(`[DRY_RUN] Checking for updates: ${CHECK_UPDATES}`);
    return;
  }

  // Ensure directories exist
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SERVER_DIR, { recursive: true });

  const handler = modeHandlers[DOWNLOAD_MODE] ?? autoHandler;
  if (!modeHandlers[DOWNLOAD_MODE] && DOWNLOAD_MODE !== "auto") {
    logWarn(`Unknown DOWNLOAD_MODE=${DOWNLOAD_MODE}, falling back to auto mode.`);
  }
  await handler.ensure();
}
