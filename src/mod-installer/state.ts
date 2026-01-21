import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { DATA_DIR } from "../config.ts";
import type { LegacyModState, ModProviderMap, ModState, ProviderState } from "../types/mod-installer.ts";

const MOD_STATE_FILE = resolve(DATA_DIR, ".mods-state.json");
const LEGACY_STATE_FILE = resolve(DATA_DIR, ".mods-cache.json");

export function loadModState(): ModState<ModProviderMap> {
  if (!existsSync(MOD_STATE_FILE)) {
    return loadLegacyState();
  }

  try {
    const content = readFileSync(MOD_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as ModState<ModProviderMap>;
    if (!parsed.providers) return loadLegacyState();
    return parsed;
  } catch {
    return loadLegacyState();
  }
}

export function saveModState(cache: ModState<ModProviderMap>): void {
  writeFileSync(MOD_STATE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

function loadLegacyState(): ModState<ModProviderMap> {
  if (!existsSync(LEGACY_STATE_FILE)) {
    return { providers: {} };
  }

  try {
    const content = readFileSync(LEGACY_STATE_FILE, "utf-8");
    const parsed: LegacyModState = JSON.parse(content);
    if (!parsed.mods) return { providers: {} };
    const migrated: ModState<ModProviderMap> = {
      providers: {
        curseforge: { entries: parsed.mods as ProviderState<ModProviderMap["curseforge"]>["entries"] },
      },
    };
    writeFileSync(MOD_STATE_FILE, JSON.stringify(migrated, null, 2), "utf-8");
    return migrated;
  } catch {
    return { providers: {} };
  }
}

export function getProviderState<K extends keyof ModProviderMap>(
  state: ModState<ModProviderMap>,
  providerId: K
): ProviderState<ModProviderMap[K]> {
  const existing = state.providers[providerId];
  if (existing) {
    return existing;
  }
  const created: ProviderState<ModProviderMap[K]> = { entries: {} };
  state.providers[providerId] = created;
  return created;
}
