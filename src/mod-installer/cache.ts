import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve as resolvePath } from "path";
import { DATA_DIR } from "../config.ts";

export type ModCache = {
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

const MOD_CACHE_FILE = resolvePath(DATA_DIR, ".mods-cache.json");

export function loadModCache(): ModCache {
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

export function saveModCache(cache: ModCache): void {
  writeFileSync(MOD_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}
