/**
 * CurseForge Mod Installer
 * Downloads and installs mods into the configured mods directory.
 */

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { resolve as resolvePath } from "path";
import { logInfo, logWarn, logDebug, die } from "./log-utils.ts";
import {
  CURSEFORGE_API_KEY,
  CURSEFORGE_GAME_VERSION,
  CURSEFORGE_MOD_LIST,
  CURSEFORGE_MODS_DIR,
  DATA_DIR,
  DOWNLOAD_INITIAL_BACKOFF,
  DOWNLOAD_MAX_RETRIES,
  DRY_RUN,
  HYTALE_PATCHLINE,
  MOD_INSTALL_MODE,
} from "./config.ts";

type ModRequest = {
  modId: number;
  fileId?: number;
  raw: string;
};

type CurseForgeFile = {
  modId: number;
  fileId: number;
  fileName: string;
  downloadUrl: string;
  fileLength: number;
  hashes: Record<string, string>;
  gameVersions: string[];
};

type ModCache = {
  mods: Record<
    string,
    {
      modId: number;
      fileId: number;
      fileName: string;
      fileLength: number;
      hashes: Record<string, string>;
      installedAt: string;
    }
  >;
};

const CURSEFORGE_API_BASE = "https://api.curseforge.com/v1";
const MOD_CACHE_FILE = resolvePath(DATA_DIR, ".mods-cache.json");

function calculateBackoff(attempt: number): number {
  const baseBackoff = DOWNLOAD_INITIAL_BACKOFF * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 5);
  return baseBackoff + jitter;
}

function parseModSpec(raw: string): ModRequest | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const separator = trimmed.includes("@") ? "@" : trimmed.includes(":") ? ":" : null;
  const [idPart, filePart] = separator ? trimmed.split(separator, 2) : [trimmed, ""];
  const modId = Number.parseInt(idPart, 10);
  const fileId = filePart ? Number.parseInt(filePart, 10) : undefined;

  if (!Number.isFinite(modId) || modId <= 0) {
    logWarn(`Invalid CurseForge mod id: ${raw}`);
    return null;
  }

  if (filePart && (!Number.isFinite(fileId) || fileId <= 0)) {
    logWarn(`Invalid CurseForge file id: ${raw}`);
    return null;
  }

  return { modId, fileId, raw: trimmed };
}

function parseModList(list: string): ModRequest[] {
  const entries = list
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const parsed = entries.map(parseModSpec).filter((entry): entry is ModRequest => !!entry);
  const deduped = new Map<string, ModRequest>();

  for (const entry of parsed) {
    const key = `${entry.modId}:${entry.fileId ?? "latest"}`;
    deduped.set(key, entry);
  }

  return Array.from(deduped.values());
}

function loadModList(): ModRequest[] {
  if (!CURSEFORGE_MOD_LIST) return [];
  return parseModList(CURSEFORGE_MOD_LIST);
}

function loadCache(): ModCache {
  if (!existsSync(MOD_CACHE_FILE)) {
    return { mods: {} };
  }

  try {
    const content = readFileSync(MOD_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(content) as ModCache;
    if (!parsed.mods) return { mods: {} };
    return parsed;
  } catch {
    return { mods: {} };
  }
}

function saveCache(cache: ModCache): void {
  writeFileSync(MOD_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

async function fetchJsonWithRetries<T>(url: string, label: string): Promise<T> {
  let attempt = 1;
  while (attempt <= DOWNLOAD_MAX_RETRIES) {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "hytale-server-mod-installer/1.0",
      };

      if (CURSEFORGE_API_KEY) {
        headers["x-api-key"] = CURSEFORGE_API_KEY;
      }

      const response = await fetch(url, { headers });
      if (response.status === 401 || response.status === 403) {
        const body = await response.text();
        throw new Error(
          `CurseForge API request unauthorized (HTTP ${response.status}). ${body || "Check CURSEFORGE_API_KEY."}`
        );
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} ${body || ""}`.trim());
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) {
        throw error;
      }
      if (attempt >= DOWNLOAD_MAX_RETRIES) {
        throw error;
      }
      const backoff = calculateBackoff(attempt);
      logWarn(`${label} failed (${error}), retrying in ${backoff}s...`);
      await Bun.sleep(backoff * 1000);
      attempt++;
    }
  }

  throw new Error(`${label} failed after ${DOWNLOAD_MAX_RETRIES} attempts`);
}

function extractHashes(hashes: Array<{ algo: number; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const hash of hashes) {
    switch (hash.algo) {
      case 1:
        result.sha1 = hash.value;
        break;
      case 2:
        result.md5 = hash.value;
        break;
      case 3:
        result.sha256 = hash.value;
        break;
      default:
        break;
    }
  }
  return result;
}

function pickHash(hashes: Record<string, string>): { algo: string; value: string } | null {
  if (hashes.sha256) return { algo: "sha256", value: hashes.sha256 };
  if (hashes.sha1) return { algo: "sha1", value: hashes.sha1 };
  if (hashes.md5) return { algo: "md5", value: hashes.md5 };
  return null;
}

async function calculateHash(path: string, algo: string): Promise<string> {
  const data = await Bun.file(path).arrayBuffer();
  const hash = createHash(algo);
  hash.update(Buffer.from(data));
  return hash.digest("hex");
}

async function validateFile(path: string, fileInfo: CurseForgeFile): Promise<boolean> {
  if (!existsSync(path)) return false;

  const preferredHash = pickHash(fileInfo.hashes);
  if (preferredHash) {
    const actual = await calculateHash(path, preferredHash.algo);
    return actual.toLowerCase() === preferredHash.value.toLowerCase();
  }

  if (fileInfo.fileLength > 0) {
    const stats = statSync(path);
    return stats.size === fileInfo.fileLength;
  }

  return false;
}

async function getModFile(modId: number, fileId?: number): Promise<CurseForgeFile> {
  if (fileId) {
    const response = await fetchJsonWithRetries<{ data: any }>(
      `${CURSEFORGE_API_BASE}/mods/${modId}/files/${fileId}`,
      `CurseForge file lookup (${modId}:${fileId})`
    );
    return {
      modId,
      fileId: response.data.id,
      fileName: response.data.fileName,
      downloadUrl: response.data.downloadUrl,
      fileLength: response.data.fileLength ?? 0,
      hashes: extractHashes(response.data.hashes ?? []),
      gameVersions: response.data.gameVersions ?? [],
    };
  }

  const response = await fetchJsonWithRetries<{ data: any[] }>(
    `${CURSEFORGE_API_BASE}/mods/${modId}/files?index=0&pageSize=50`,
    `CurseForge file list (${modId})`
  );

  const files = response.data ?? [];
  if (!files.length) {
    throw new Error(`No files found for mod ${modId}`);
  }

  const desiredVersion = CURSEFORGE_GAME_VERSION || "";
  const versionFiltered = desiredVersion
    ? files.filter((file) => matchesGameVersion(file.gameVersions ?? [], desiredVersion))
    : files;

  if (desiredVersion && !versionFiltered.length) {
    logWarn(`No mod files matched game version "${desiredVersion}" for mod ${modId}`);
  }

  const candidates = versionFiltered.length ? versionFiltered : files;

  const latest = candidates.reduce((current, next) => {
    if (!current) return next;
    const currentDate = new Date(current.fileDate ?? 0).getTime();
    const nextDate = new Date(next.fileDate ?? 0).getTime();
    return nextDate >= currentDate ? next : current;
  }, candidates[0]);

  return {
    modId,
    fileId: latest.id,
    fileName: latest.fileName,
    downloadUrl: latest.downloadUrl,
    fileLength: latest.fileLength ?? 0,
    hashes: extractHashes(latest.hashes ?? []),
    gameVersions: latest.gameVersions ?? [],
  };
}

function buildVersionAliases(version: string): Set<string> {
  const normalized = version.trim().toLowerCase();
  const aliases = new Set<string>();
  if (!normalized) return aliases;
  aliases.add(normalized);

  if (normalized === "release") {
    aliases.add("early access");
    aliases.add("early-access");
  } else if (normalized === "pre-release") {
    aliases.add("prerelease");
    aliases.add("pre release");
  } else if (normalized === "early access") {
    aliases.add("early-access");
  } else if (normalized === "early-access") {
    aliases.add("early access");
  }

  return aliases;
}

function matchesGameVersion(gameVersions: string[], desiredVersion: string): boolean {
  if (!desiredVersion) return true;
  if (!gameVersions.length) return false;
  const aliases = buildVersionAliases(desiredVersion);
  if (!aliases.size) return false;
  return gameVersions.some((version) => aliases.has(version.toLowerCase()));
}

function warnIfIncompatible(fileInfo: CurseForgeFile): void {
  if (!fileInfo.gameVersions.length) return;

  const desiredVersion = CURSEFORGE_GAME_VERSION || HYTALE_PATCHLINE;
  if (!desiredVersion) return;

  const matches = matchesGameVersion(fileInfo.gameVersions, desiredVersion);
  if (!matches) {
    const label = CURSEFORGE_GAME_VERSION || HYTALE_PATCHLINE;
    logWarn(`Mod ${fileInfo.modId} file ${fileInfo.fileId} does not list game version "${label}"`);
  }
}

async function downloadFile(url: string, targetPath: string, label: string): Promise<void> {
  let attempt = 1;
  const tempPath = `${targetPath}.download`;

  while (attempt <= DOWNLOAD_MAX_RETRIES) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      writeFileSync(tempPath, buffer);
      renameSync(tempPath, targetPath);
      return;
    } catch (error) {
      rmSync(tempPath, { force: true });
      if (attempt >= DOWNLOAD_MAX_RETRIES) {
        throw new Error(`${label} download failed (${error})`);
      }
      const backoff = calculateBackoff(attempt);
      logWarn(`${label} download failed (${error}), retrying in ${backoff}s...`);
      await Bun.sleep(backoff * 1000);
      attempt++;
    }
  }
}

export async function installCurseForgeMods(): Promise<void> {
  if (MOD_INSTALL_MODE !== "curseforge") return;

  const modList = loadModList();
  if (!modList.length) {
    logInfo("CurseForge mod install enabled, but no mods were specified");
    if (!CURSEFORGE_MODS_DIR) return;
    const cache = loadCache();
    let removedCount = 0;
    for (const entry of Object.values(cache.mods)) {
      const stalePath = resolvePath(CURSEFORGE_MODS_DIR, entry.fileName);
      if (existsSync(stalePath)) {
        rmSync(stalePath, { force: true });
        removedCount++;
      }
    }
    if (removedCount > 0) {
      logInfo(`Removed ${removedCount} cached mod file(s)`);
    }
    cache.mods = {};
    saveCache(cache);
    return;
  }

  if (!CURSEFORGE_MODS_DIR) {
    logWarn("CURSEFORGE_MODS_DIR is empty; skipping CurseForge mod installation");
    return;
  }

  if (!CURSEFORGE_API_KEY) {
    if (DRY_RUN) {
      logWarn("CURSEFORGE_API_KEY is required to download mods");
      return;
    }
    die("CURSEFORGE_API_KEY is required for CurseForge mod installation");
  }

  logDebug(
    `CurseForge API key length: ${CURSEFORGE_API_KEY.length} (first 4: ${CURSEFORGE_API_KEY.slice(0, 4)})`
  );

  if (DRY_RUN) {
    for (const mod of modList) {
      logInfo(`[DRY_RUN] Would install mod ${mod.modId}${mod.fileId ? `:${mod.fileId}` : ""}`);
    }
    return;
  }

  mkdirSync(CURSEFORGE_MODS_DIR, { recursive: true });
  const cache = loadCache();

  logInfo(`Installing ${modList.length} CurseForge mod(s) into ${CURSEFORGE_MODS_DIR}`);

  const resolvedMods: CurseForgeFile[] = [];
  for (const mod of modList) {
    try {
      const fileInfo = await getModFile(mod.modId, mod.fileId);
      if (!fileInfo.downloadUrl) {
        logWarn(`No download URL provided for mod ${mod.modId} file ${fileInfo.fileId}`);
        continue;
      }
      warnIfIncompatible(fileInfo);
      resolvedMods.push(fileInfo);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) {
        die("CurseForge API request unauthorized. Check CURSEFORGE_API_KEY.");
      }
      logWarn(`Failed to resolve mod ${mod.modId}: ${error}`);
    }
  }

  const desiredFiles = new Set(resolvedMods.map((file) => file.fileName));
  const desiredModIds = new Set(resolvedMods.map((file) => String(file.modId)));

  for (const [modId, entry] of Object.entries(cache.mods)) {
    if (!desiredModIds.has(modId) || !desiredFiles.has(entry.fileName)) {
      const stalePath = resolvePath(CURSEFORGE_MODS_DIR, entry.fileName);
      if (existsSync(stalePath)) {
        rmSync(stalePath, { force: true });
        logInfo(`Removed stale mod file: ${entry.fileName}`);
      }
      delete cache.mods[modId];
    }
  }

  saveCache(cache);

  for (const fileInfo of resolvedMods) {
    const targetPath = resolvePath(CURSEFORGE_MODS_DIR, fileInfo.fileName);
    const cacheEntry = cache.mods[String(fileInfo.modId)];

    if (
      cacheEntry &&
      cacheEntry.fileId === fileInfo.fileId &&
      cacheEntry.fileName === fileInfo.fileName &&
      existsSync(targetPath)
    ) {
      const valid = await validateFile(targetPath, fileInfo);
      if (valid) {
        logInfo(`Mod ${fileInfo.modId} already installed (${fileInfo.fileName})`);
        continue;
      }
    }

    if (existsSync(targetPath)) {
      const valid = await validateFile(targetPath, fileInfo);
      if (valid) {
        logInfo(`Mod ${fileInfo.modId} already installed (${fileInfo.fileName})`);
        cache.mods[String(fileInfo.modId)] = {
          modId: fileInfo.modId,
          fileId: fileInfo.fileId,
          fileName: fileInfo.fileName,
          fileLength: fileInfo.fileLength,
          hashes: fileInfo.hashes,
          installedAt: new Date().toISOString(),
        };
        saveCache(cache);
        continue;
      }
      logWarn(`Mod ${fileInfo.modId} checksum mismatch, re-downloading`);
    }

    logInfo(`Downloading mod ${fileInfo.modId} file ${fileInfo.fileId}...`);
    await downloadFile(fileInfo.downloadUrl, targetPath, `Mod ${fileInfo.modId}`);

    const valid = await validateFile(targetPath, fileInfo);
    if (!valid) {
      rmSync(targetPath, { force: true });
      logWarn(`Checksum validation failed for mod ${fileInfo.modId}, removed file`);
      continue;
    }

    cache.mods[String(fileInfo.modId)] = {
      modId: fileInfo.modId,
      fileId: fileInfo.fileId,
      fileName: fileInfo.fileName,
      fileLength: fileInfo.fileLength,
      hashes: fileInfo.hashes,
      installedAt: new Date().toISOString(),
    };

    saveCache(cache);
    logInfo(`Installed mod ${fileInfo.modId} (${fileInfo.fileName})`);
  }
}
