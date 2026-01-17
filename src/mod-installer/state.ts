import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve as resolvePath } from "path";
import { DATA_DIR } from "../config.ts";
import type { ProviderMap } from "./index.ts";

export type ProviderState<T> = {
  entries: Record<string, T>;
};

export type ModState = {
  providers: { [K in keyof ProviderMap]?: ProviderState<ProviderMap[K]> };
};

const MOD_STATE_FILE = resolvePath(DATA_DIR, ".mods-state.json");
const LEGACY_STATE_FILE = resolvePath(DATA_DIR, ".mods-cache.json");

type LegacyModState = {
  mods: Record<string, unknown>;
};

export function loadModState(): ModState {
  if (!existsSync(MOD_STATE_FILE)) {
    return loadLegacyState();
  }

  try {
    const content = readFileSync(MOD_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as ModState;
    if (!parsed.providers) return loadLegacyState();
    return parsed;
  } catch {
    return loadLegacyState();
  }
}

export function saveModState(cache: ModState): void {
  writeFileSync(MOD_STATE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

function loadLegacyState(): ModState {
  if (!existsSync(LEGACY_STATE_FILE)) {
    return { providers: {} };
  }

  try {
    const content = readFileSync(LEGACY_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as LegacyModState;
    if (!parsed.mods) return { providers: {} };
    const migrated: ModState = {
      providers: {
        curseforge: { entries: parsed.mods as ProviderState<ProviderMap["curseforge"]>["entries"] },
      },
    };
    writeFileSync(MOD_STATE_FILE, JSON.stringify(migrated, null, 2), "utf-8");
    return migrated;
  } catch {
    return { providers: {} };
  }
}

export function getProviderState<K extends keyof ProviderMap>(
  state: ModState,
  providerId: K
): ProviderState<ProviderMap[K]> {
  const existing = state.providers[providerId];
  if (existing) {
    return existing as ProviderState<ProviderMap[K]>;
  }
  const created: ProviderState<ProviderMap[K]> = { entries: {} };
  state.providers[providerId] = created as ProviderState<ProviderMap[K]>;
  return created;
}
