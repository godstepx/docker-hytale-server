/**
 * CurseForge Mod Installer
 * Downloads and installs mods into the configured mods directory.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { logInfo, logWarn, logDebug, fatal } from "../log-utils.ts";
import {
  DRY_RUN,
  HYTALE_PATCHLINE,
  DATA_DIR,
  getEnvList,
  getEnv,
} from "../config.ts";
import { getProviderState, loadModState, saveModState } from "./state.ts";
import type {
  CurseForgeDependency,
  CurseForgeFile,
  CurseForgeStateEntry,
  ModRequest,
} from "../types/mod-installer.ts";
import { ModInstallerProvider } from "./provider.ts";

const CURSEFORGE_API_BASE = "https://api.curseforge.com/v1";
const CURSEFORGE_MOD_URL = "https://www.curseforge.com/hytale/mods/";
const REQUIRED_DEPENDENCY_TYPE = 3;
const CURSEFORGE_RELEASE_TYPE_RELEASE = 1;
const CURSEFORGE_RELEASE_TYPE_BETA = 2;
const CURSEFORGE_RELEASE_TYPE_ALPHA = 3;

type CurseForgeReleaseChannel = "release" | "beta" | "alpha" | "any";

const CURSEFORGE_MOD_LIST = getEnvList("CURSEFORGE_MOD_LIST", []);
const CURSEFORGE_API_KEY = getEnv("CURSEFORGE_API_KEY", "");
const CURSEFORGE_GAME_VERSION = getEnv("CURSEFORGE_GAME_VERSION", "Early Access");
const CURSEFORGE_RELEASE_CHANNEL_RAW = getEnv("CURSEFORGE_RELEASE_CHANNEL", "release");
const CURSEFORGE_MODS_DIR = getEnv(
  "CURSEFORGE_MODS_DIR",
  resolve(DATA_DIR, "curseforge-mods")
);
const CURSEFORGE_RELEASE_CHANNEL = parseReleaseChannel(CURSEFORGE_RELEASE_CHANNEL_RAW);

function parseModSpec(raw: string): ModRequest | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const separator = trimmed.includes("@") ? "@" : trimmed.includes(":") ? ":" : null;
  const [idPartRaw, filePartRaw] = separator ? trimmed.split(separator, 2) : [trimmed, ""];
  const idPart = idPartRaw ?? "";
  const filePart = filePartRaw ?? "";
  const modId = Number.parseInt(idPart, 10);
  let fileId: number | undefined;

  if (!Number.isFinite(modId) || modId <= 0) {
    logWarn(`Invalid CurseForge mod id: ${raw}`);
    return null;
  }

  if (filePart) {
    fileId = Number.parseInt(filePart, 10);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      logWarn(`Invalid CurseForge file id: ${raw}`);
      return null;
    }
  }

  return fileId === undefined ? { modId, raw: trimmed } : { modId, fileId, raw: trimmed };
}

function parseModList(entries: string[]): ModRequest[] {
  const parsed = entries.map(parseModSpec).filter((entry): entry is ModRequest => !!entry);
  const deduped = new Map<string, ModRequest>();

  for (const entry of parsed) {
    const key = `${entry.modId}:${entry.fileId ?? "latest"}`;
    deduped.set(key, entry);
  }

  return Array.from(deduped.values());
}

function loadModList(): ModRequest[] {
  if (!CURSEFORGE_MOD_LIST.length) return [];
  return parseModList(CURSEFORGE_MOD_LIST);
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

function extractDependencies(
  dependencies: Array<{ modId?: number; relationType?: number }>
): CurseForgeDependency[] {
  const result: CurseForgeDependency[] = [];
  for (const dependency of dependencies) {
    const modId = dependency.modId ?? 0;
    const relationType = dependency.relationType ?? 0;
    if (!Number.isFinite(modId) || modId <= 0) continue;
    result.push({ modId, relationType });
  }
  return result;
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

function parseReleaseChannel(raw: string): CurseForgeReleaseChannel {
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "release" || normalized === "stable") {
    return "release";
  }
  if (
    normalized === "beta" ||
    normalized === "pre-release" ||
    normalized === "pre release" ||
    normalized === "prerelease"
  ) {
    return "beta";
  }
  if (normalized === "alpha") {
    return "alpha";
  }
  if (normalized === "any" || normalized === "all" || normalized === "*") {
    return "any";
  }

  logWarn(
    `Invalid CURSEFORGE_RELEASE_CHANNEL="${raw}". Falling back to "release" (stable-only files).`
  );
  return "release";
}

function normalizeReleaseType(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (
    value === CURSEFORGE_RELEASE_TYPE_RELEASE ||
    value === CURSEFORGE_RELEASE_TYPE_BETA ||
    value === CURSEFORGE_RELEASE_TYPE_ALPHA
  ) {
    return value;
  }
  return CURSEFORGE_RELEASE_TYPE_ALPHA;
}

function releaseTypeLabel(releaseType: number): string {
  if (releaseType === CURSEFORGE_RELEASE_TYPE_RELEASE) return "release";
  if (releaseType === CURSEFORGE_RELEASE_TYPE_BETA) return "beta";
  return "alpha";
}

function matchesReleaseChannel(
  releaseType: number,
  desiredChannel: CurseForgeReleaseChannel
): boolean {
  if (desiredChannel === "any") return true;
  if (desiredChannel === "alpha") {
    return (
      releaseType === CURSEFORGE_RELEASE_TYPE_RELEASE ||
      releaseType === CURSEFORGE_RELEASE_TYPE_BETA ||
      releaseType === CURSEFORGE_RELEASE_TYPE_ALPHA
    );
  }
  if (desiredChannel === "beta") {
    return (
      releaseType === CURSEFORGE_RELEASE_TYPE_RELEASE ||
      releaseType === CURSEFORGE_RELEASE_TYPE_BETA
    );
  }
  return releaseType === CURSEFORGE_RELEASE_TYPE_RELEASE;
}

export class CurseForgeProvider extends ModInstallerProvider<CurseForgeStateEntry> {
  async install(): Promise<void> {
    const modList = loadModList();
    if (!modList.length) {
      logInfo("CurseForge mod install enabled, but no mods were specified");
      if (!CURSEFORGE_MODS_DIR) return;

      const cache = loadModState();
      const providerState = getProviderState(cache, "curseforge");
      const removedFiles = this.removeCachedFiles(providerState.entries, CURSEFORGE_MODS_DIR);
      if (removedFiles.length > 0) {
        logInfo(`Removed ${removedFiles.length} cached mod file(s)`);
      }
      providerState.entries = {};
      saveModState(cache);
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
      fatal("CURSEFORGE_API_KEY is required for CurseForge mod installation");
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
    const cache = loadModState();
    const providerState = getProviderState(cache, "curseforge");

    logInfo(`Installing ${modList.length} CurseForge mod(s) into ${CURSEFORGE_MODS_DIR}`);

    const resolvedMods = await this.resolveMods(modList);

    const desiredFiles = new Set(resolvedMods.map((file) => file.fileName));
    const desiredModIds = new Set(resolvedMods.map((file) => String(file.modId)));

    const removedFiles = this.pruneStaleEntries(
      providerState.entries,
      CURSEFORGE_MODS_DIR,
      desiredModIds,
      desiredFiles
    );
    for (const fileName of removedFiles) {
      logInfo(`Removed stale mod file: ${fileName}`);
    }

    saveModState(cache);

    for (const fileInfo of resolvedMods) {
      const targetPath = resolve(CURSEFORGE_MODS_DIR, fileInfo.fileName);
      const cacheEntry = providerState.entries[String(fileInfo.modId)];

      if (
        cacheEntry &&
        cacheEntry.fileId === fileInfo.fileId &&
        cacheEntry.fileName === fileInfo.fileName &&
        existsSync(targetPath)
      ) {
        const valid = await this.validateFile(targetPath, {
          hashes: fileInfo.hashes,
          fileLength: fileInfo.fileLength,
        });
        if (valid) {
          logInfo(
            `Mod ${fileInfo.modName ?? fileInfo.modId} (${fileInfo.modId}) already installed (${fileInfo.fileName})`
          );
          continue;
        }
      }

      if (existsSync(targetPath)) {
        const valid = await this.validateFile(targetPath, {
          hashes: fileInfo.hashes,
          fileLength: fileInfo.fileLength,
        });
        if (valid) {
          logInfo(
            `Mod ${fileInfo.modName ?? fileInfo.modId} (${fileInfo.modId}) already installed (${fileInfo.fileName})`
          );
          providerState.entries[String(fileInfo.modId)] = {
            modId: fileInfo.modId,
            fileId: fileInfo.fileId,
            fileName: fileInfo.fileName,
            fileLength: fileInfo.fileLength,
            hashes: fileInfo.hashes,
            installedAt: new Date().toISOString(),
          };
          saveModState(cache);
          continue;
        }
        logWarn(
          `Mod ${fileInfo.modName} (${fileInfo.modId}) checksum mismatch, re-downloading`
        );
      }

      logInfo(
        `Downloading mod ${fileInfo.modName} (${fileInfo.modId}) file ${fileInfo.fileId}...`
      );
      await this.downloadFile(
        fileInfo.downloadUrl!,
        targetPath,
        `Mod ${fileInfo.modName} (${fileInfo.modId})`
      );

      const valid = await this.validateFile(targetPath, {
        hashes: fileInfo.hashes,
        fileLength: fileInfo.fileLength,
      });
      if (!valid) {
        rmSync(targetPath, { force: true });
        logWarn(
          `Checksum validation failed for mod ${fileInfo.modName} (${fileInfo.modId}), removed file`
        );
        continue;
      }

      providerState.entries[String(fileInfo.modId)] = {
        modId: fileInfo.modId,
        fileId: fileInfo.fileId,
        fileName: fileInfo.fileName,
        fileLength: fileInfo.fileLength,
        hashes: fileInfo.hashes,
        installedAt: new Date().toISOString(),
      };

      saveModState(cache);
      logInfo(
        `Installed mod ${fileInfo.modName} (${fileInfo.modId}) (${fileInfo.fileName})`
      );
    }
  }

  getModDir(): string {
    return CURSEFORGE_MODS_DIR;
  }

  private async resolveMods(modList: ModRequest[]): Promise<CurseForgeFile[]> {
    const resolved = new Map<number, CurseForgeFile>();
    const queued = new Set<number>();
    const pending: ModRequest[] = [...modList];

    for (const mod of modList) {
      queued.add(mod.modId);
    }

    while (pending.length > 0) {
      const mod = pending.shift();
      if (!mod) continue;

      const existing = resolved.get(mod.modId);
      if (existing && (mod.fileId === undefined || existing.fileId === mod.fileId)) {
        continue;
      }

      try {
        const fileInfo = await this.getModFile(mod.modId, mod.fileId);

        if (!fileInfo.downloadUrl) {
          // Keep the refactor, but preserve the nicer manual-download guidance from HEAD.
          const modLabel = `${fileInfo.modName} (${fileInfo.modId})`;
          if (fileInfo.fileName) {
            const targetPath = resolve(CURSEFORGE_MODS_DIR, fileInfo.fileName);
            if (existsSync(targetPath)) {
              logInfo(`Mod ${modLabel} already installed (${fileInfo.fileName})`);
              resolved.set(mod.modId, fileInfo);
              continue;
            }
          }

          const manualUrl = `${CURSEFORGE_MOD_URL}${fileInfo.modSlug}/files/${fileInfo.fileId}`
          logWarn(`Mod ${modLabel} file ${fileInfo.fileId} prevents automatic downloading`);
          logWarn(
            ` - You can download the mod manually from ${manualUrl} and place it in the ${CURSEFORGE_MODS_DIR} directory`
          );
          continue;
        }

        this.warnIfIncompatible(fileInfo);
        resolved.set(mod.modId, fileInfo);

        for (const dependencyModId of this.getRequiredDependencies(fileInfo)) {
          if (queued.has(dependencyModId)) continue;
          queued.add(dependencyModId);
          pending.push({ modId: dependencyModId, raw: `dependency:${mod.modId}` });
          logDebug(`Queued required dependency ${dependencyModId} for mod ${mod.modId}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) {
          fatal("CurseForge API request unauthorized. Check CURSEFORGE_API_KEY.");
        }
        logWarn(`Failed to resolve mod ${mod.modId}: ${error}`);
      }
    }

    return Array.from(resolved.values());
  }

  private async getModFile(modId: number, fileId?: number): Promise<CurseForgeFile> {
    // HEAD improvement: always fetch mod metadata so we can log friendly names and build manual URLs.
    const modResponse = await this.fetchJsonWithRetries<{ data: any }>(
      `${CURSEFORGE_API_BASE}/mods/${modId}`,
      `CurseForge mod lookup (${modId})`,
      {
        headers: this.getHeaders(),
        onResponseError: (response, body) => this.handleResponseError(response, body),
      }
    );

    const modName = modResponse.data.name;
    const modSlug = modResponse.data.slug;

    if (fileId) {
      const response = await this.fetchJsonWithRetries<{ data: any }>(
        `${CURSEFORGE_API_BASE}/mods/${modId}/files/${fileId}`,
        `CurseForge file lookup (${modId}:${fileId})`,
        {
          headers: this.getHeaders(),
          onResponseError: (response, body) => this.handleResponseError(response, body),
        }
      );
      return {
        modId,
        modName,
        modSlug,
        fileId: response.data.id,
        fileName: response.data.fileName,
        downloadUrl: response.data.downloadUrl,
        fileLength: response.data.fileLength ?? 0,
        releaseType: normalizeReleaseType(response.data.releaseType),
        hashes: extractHashes(response.data.hashes ?? []),
        gameVersions: response.data.gameVersions ?? [],
        dependencies: extractDependencies(response.data.dependencies ?? []),
      };
    }

    const response = await this.fetchJsonWithRetries<{ data: any[] }>(
      `${CURSEFORGE_API_BASE}/mods/${modId}/files?index=0&pageSize=50`,
      `CurseForge file list (${modId})`,
      {
        headers: this.getHeaders(),
        onResponseError: (response, body) => this.handleResponseError(response, body),
      }
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

    const versionCandidates = versionFiltered.length ? versionFiltered : files;

    const releaseFiltered = versionCandidates.filter((file) =>
      matchesReleaseChannel(
        normalizeReleaseType(file.releaseType),
        CURSEFORGE_RELEASE_CHANNEL
      )
    );

    if (!releaseFiltered.length) {
      throw new Error(
        `No mod files matched release channel "${CURSEFORGE_RELEASE_CHANNEL_RAW}" for mod ${modId}`
      );
    }

    const candidates = releaseFiltered;

    const latest = candidates.reduce((current, next) => {
      if (!current) return next;
      const currentDate = new Date(current.fileDate ?? 0).getTime();
      const nextDate = new Date(next.fileDate ?? 0).getTime();
      return nextDate >= currentDate ? next : current;
    }, candidates[0]);

    return {
      modId,
      modName,
      modSlug,
      fileId: latest.id,
      fileName: latest.fileName,
      downloadUrl: latest.downloadUrl,
      fileLength: latest.fileLength ?? 0,
      releaseType: normalizeReleaseType(latest.releaseType),
      hashes: extractHashes(latest.hashes ?? []),
      gameVersions: latest.gameVersions ?? [],
      dependencies: extractDependencies(latest.dependencies ?? []),
    };
  }

  private warnIfIncompatible(fileInfo: CurseForgeFile): void {
    if (!matchesReleaseChannel(fileInfo.releaseType, CURSEFORGE_RELEASE_CHANNEL)) {
      logWarn(
        `Mod ${fileInfo.modName ?? fileInfo.modId} (${fileInfo.modId}) file ${fileInfo.fileId} is ${releaseTypeLabel(fileInfo.releaseType)} but CURSEFORGE_RELEASE_CHANNEL is "${CURSEFORGE_RELEASE_CHANNEL_RAW}"`
      );
    }

    if (!fileInfo.gameVersions.length) return;

    const desiredVersion = CURSEFORGE_GAME_VERSION || HYTALE_PATCHLINE;
    if (!desiredVersion) return;

    const matches = matchesGameVersion(fileInfo.gameVersions, desiredVersion);
    if (!matches) {
      const label = CURSEFORGE_GAME_VERSION || HYTALE_PATCHLINE;
      logWarn(
        `Mod ${fileInfo.modName ?? fileInfo.modId} (${fileInfo.modId}) file ${fileInfo.fileId} does not list game version "${label}"`
      );
    }
  }

  private getRequiredDependencies(fileInfo: CurseForgeFile): number[] {
    const dependencies = fileInfo.dependencies ?? [];
    return dependencies
      .filter((dependency) => dependency.relationType === REQUIRED_DEPENDENCY_TYPE)
      .map((dependency) => dependency.modId);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "hytale-server-mod-installer/1.0",
    };

    if (CURSEFORGE_API_KEY) {
      headers["x-api-key"] = CURSEFORGE_API_KEY;
    }

    return headers;
  }

  private handleResponseError(response: Response, body: string): Error | null {
    if (response.status === 401 || response.status === 403) {
      return new Error(
        `CurseForge API request unauthorized (HTTP ${response.status}). ${
          body || "Check CURSEFORGE_API_KEY."
        }`
      );
    }
    return null;
  }
}
