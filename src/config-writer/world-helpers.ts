import { resolve } from "path";
import deepmerge from "@fastify/deepmerge";
import { logWarn } from "../log-utils.ts";
import { buildNestedPatch } from "./utils.ts";
import { DATA_DIR, UNIVERSE_PATH } from "../config.ts";
import { parseBoolEnvValue, parseNumberEnvValue } from "../utils.ts";
import type {
  HytaleItemsLossMode,
  HytaleWorldConfig,
  HytaleWorldConfigEnv,
  HytaleWorldSettingEnv,
} from "../types/hytale-config.ts";
import type { Path } from "../types/config-writer.ts";
import type {
  HytaleWorldEnsureKey,
  HytaleWorldSettingParse,
  HytaleWorldSettingValue,
} from "../types/config-writer-world.ts";

const WORLD_CONFIG_ENV_PREFIX = "WORLD_CONFIG_JSON_";
const WORLD_ENV_PREFIX = "WORLD_";

function isItemsLossMode(value: string): value is HytaleItemsLossMode {
  return value === "None" || value === "All" || value === "Configured";
}

const DEFAULT_WORLD_GEN: HytaleWorldConfig["WorldGen"] = { Type: "Hytale", Name: "Default" };
const DEFAULT_WORLD_MAP: HytaleWorldConfig["WorldMap"] = { Type: "WorldGen" };
const DEFAULT_CHUNK_STORAGE: HytaleWorldConfig["ChunkStorage"] = { Type: "Hytale" };
const DEFAULT_RESOURCE_STORAGE: HytaleWorldConfig["ResourceStorage"] = { Type: "Hytale" };
const DEFAULT_DEATH: NonNullable<HytaleWorldConfig["Death"]> = {
  RespawnController: { Type: "HomeOrSpawnPoint" },
  ItemsLossMode: "Configured",
  ItemsAmountLossPercentage: 50.0,
  ItemsDurabilityLossPercentage: 10.0,
};
const ENSURE_DEFAULTS: Record<
  HytaleWorldEnsureKey,
  { path: Path<HytaleWorldConfig>; value: object }
> = {
  WorldGen: { path: "WorldGen", value: DEFAULT_WORLD_GEN },
  WorldMap: { path: "WorldMap", value: DEFAULT_WORLD_MAP },
  ChunkStorage: { path: "ChunkStorage", value: DEFAULT_CHUNK_STORAGE },
  ResourceStorage: { path: "ResourceStorage", value: DEFAULT_RESOURCE_STORAGE },
  Death: { path: "Death", value: DEFAULT_DEATH },
  ClientEffects: { path: "ClientEffects", value: {} },
};

const merge = deepmerge({ all: true });

const WORLD_SETTING_MAP: Record<
  string,
  { path: Path<HytaleWorldConfig>; parse: HytaleWorldSettingParse; ensure?: HytaleWorldEnsureKey }
> = {
  VERSION: { path: "Version", parse: "number" },
  SEED: { path: "Seed", parse: "number" },
  WORLD_GEN_TYPE: { path: "WorldGen.Type", parse: "string", ensure: "WorldGen" },
  WORLD_GEN_NAME: { path: "WorldGen.Name", parse: "string", ensure: "WorldGen" },
  WORLD_MAP_TYPE: { path: "WorldMap.Type", parse: "string", ensure: "WorldMap" },
  CHUNK_STORAGE_TYPE: { path: "ChunkStorage.Type", parse: "string", ensure: "ChunkStorage" },
  RESOURCE_STORAGE_TYPE: { path: "ResourceStorage.Type", parse: "string", ensure: "ResourceStorage" },
  GAMEPLAY_CONFIG: { path: "GameplayConfig", parse: "string" },
  DEATH_RESPAWN_CONTROLLER_TYPE: {
    path: "Death.RespawnController.Type",
    parse: "string",
    ensure: "Death",
  },
  DEATH_ITEMS_LOSS_MODE: { path: "Death.ItemsLossMode", parse: "itemsLossMode", ensure: "Death" },
  DEATH_ITEMS_AMOUNT_LOSS_PERCENTAGE: {
    path: "Death.ItemsAmountLossPercentage",
    parse: "number",
    ensure: "Death",
  },
  DEATH_ITEMS_DURABILITY_LOSS_PERCENTAGE: {
    path: "Death.ItemsDurabilityLossPercentage",
    parse: "number",
    ensure: "Death",
  },
  IS_TICKING: { path: "IsTicking", parse: "bool" },
  IS_BLOCK_TICKING: { path: "IsBlockTicking", parse: "bool" },
  IS_PVP_ENABLED: { path: "IsPvpEnabled", parse: "bool" },
  IS_FALL_DAMAGE_ENABLED: { path: "IsFallDamageEnabled", parse: "bool" },
  IS_GAME_TIME_PAUSED: { path: "IsGameTimePaused", parse: "bool" },
  CLIENT_EFFECTS_SUN_HEIGHT_PERCENT: {
    path: "ClientEffects.SunHeightPercent",
    parse: "number",
    ensure: "ClientEffects",
  },
  CLIENT_EFFECTS_SUN_ANGLE_DEGREES: {
    path: "ClientEffects.SunAngleDegrees",
    parse: "number",
    ensure: "ClientEffects",
  },
  CLIENT_EFFECTS_BLOOM_INTENSITY: {
    path: "ClientEffects.BloomIntensity",
    parse: "number",
    ensure: "ClientEffects",
  },
  CLIENT_EFFECTS_BLOOM_POWER: {
    path: "ClientEffects.BloomPower",
    parse: "number",
    ensure: "ClientEffects",
  },
  CLIENT_EFFECTS_SUN_INTENSITY: {
    path: "ClientEffects.SunIntensity",
    parse: "number",
    ensure: "ClientEffects",
  },
  CLIENT_EFFECTS_SUNSHAFT_INTENSITY: {
    path: "ClientEffects.SunshaftIntensity",
    parse: "number",
    ensure: "ClientEffects",
  },
  CLIENT_EFFECTS_SUNSHAFT_SCALE_FACTOR: {
    path: "ClientEffects.SunshaftScaleFactor",
    parse: "number",
    ensure: "ClientEffects",
  },
  IS_SPAWNING_NPC: { path: "IsSpawningNPC", parse: "bool" },
  IS_SPAWN_MARKERS_ENABLED: { path: "IsSpawnMarkersEnabled", parse: "bool" },
  IS_ALL_NPC_FROZEN: { path: "IsAllNPCFrozen", parse: "bool" },
  IS_COMPASS_UPDATING: { path: "IsCompassUpdating", parse: "bool" },
  IS_SAVING_PLAYERS: { path: "IsSavingPlayers", parse: "bool" },
  IS_SAVING_CHUNKS: { path: "IsSavingChunks", parse: "bool" },
  SAVE_NEW_CHUNKS: { path: "SaveNewChunks", parse: "bool" },
  IS_UNLOADING_CHUNKS: { path: "IsUnloadingChunks", parse: "bool" },
  IS_OBJECTIVE_MARKERS_ENABLED: { path: "IsObjectiveMarkersEnabled", parse: "bool" },
  DELETE_ON_UNIVERSE_START: { path: "DeleteOnUniverseStart", parse: "bool" },
  DELETE_ON_REMOVE: { path: "DeleteOnRemove", parse: "bool" },
};

export function getUniverseDir(): string {
  return UNIVERSE_PATH ? UNIVERSE_PATH : resolve(DATA_DIR, "universe");
}

export function getWorldsDir(): string {
  return resolve(getUniverseDir(), "worlds");
}

export function getDefaultWorldConfig(): HytaleWorldConfig {
  return {
    Version: 4,
    WorldGen: DEFAULT_WORLD_GEN,
    WorldMap: DEFAULT_WORLD_MAP,
    ChunkStorage: DEFAULT_CHUNK_STORAGE,
    IsTicking: true,
    IsBlockTicking: true,
    IsPvpEnabled: false,
    IsFallDamageEnabled: true,
    IsGameTimePaused: false,
    IsSpawningNPC: true,
    IsSpawnMarkersEnabled: true,
    IsAllNPCFrozen: false,
    GameplayConfig: "Default",
    IsCompassUpdating: true,
    IsSavingPlayers: true,
    IsSavingChunks: true,
    SaveNewChunks: true,
    IsUnloadingChunks: true,
    IsObjectiveMarkersEnabled: true,
    DeleteOnUniverseStart: false,
    DeleteOnRemove: false,
    Death: DEFAULT_DEATH,
    ResourceStorage: DEFAULT_RESOURCE_STORAGE,
  };
}

function applyPatch(
  patch: object,
  path: string,
  value: HytaleWorldSettingValue,
  patchedFields: string[]
): void {
  const nestedPatch = buildNestedPatch(path.split("."), value);
  const merged = merge(patch, nestedPatch);
  Object.assign(patch, merged);
  patchedFields.push(path);
}

export function buildWorldPatch(settings: HytaleWorldSettingEnv[]): {
  patch: object;
  patchedFields: string[];
  ensures: Set<HytaleWorldEnsureKey>;
} {
  const patch: object = {};
  const patchedFields: string[] = [];
  const ensures = new Set<HytaleWorldEnsureKey>();

  for (const setting of settings) {
    const definition = WORLD_SETTING_MAP[setting.setting];
    if (!definition) {
      logWarn(`Unknown world setting ${setting.envKey}`);
      continue;
    }
    if (definition.ensure) {
      ensures.add(definition.ensure);
    }

    let parsed: HytaleWorldSettingValue;
    switch (definition.parse) {
      case "string":
        parsed = setting.value;
        break;
      case "number":
        {
          const parsedNumber = parseNumberEnvValue(setting.value, setting.envKey);
          if (parsedNumber === null) continue;
          parsed = parsedNumber;
        }
        break;
      case "bool":
        {
          const parsedBool = parseBoolEnvValue(setting.value, setting.envKey);
          if (parsedBool === null) continue;
          parsed = parsedBool;
        }
        break;
      case "itemsLossMode": {
        const value = setting.value;
        if (!isItemsLossMode(value)) {
          logWarn(`Invalid ItemsLossMode for ${setting.envKey}: ${setting.value}`);
          continue;
        }
        parsed = value;
        break;
      }
      default:
        continue;
    }

    applyPatch(patch, definition.path, parsed, patchedFields);
  }

  return { patch, patchedFields, ensures };
}

export function buildEnsureDefaults(ensures: Set<HytaleWorldEnsureKey>): object {
  let defaultsPatch: object = {};

  for (const ensureKey of ensures) {
    const entry = ENSURE_DEFAULTS[ensureKey];
    if (!entry) continue;
    defaultsPatch = merge(
      defaultsPatch,
      buildNestedPatch(entry.path.split("."), entry.value)
    );
  }

  return defaultsPatch;
}

function collectEnvEntries<T>(
  shouldInclude: (envKey: string) => boolean,
  buildEntry: (envKey: string, value: string) => T | null
): T[] {
  const entries: T[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!shouldInclude(key)) continue;
    if (value === undefined) continue;
    const entry = buildEntry(key, value);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

export function getWorldConfigEnvs(): HytaleWorldConfigEnv[] {
  return collectEnvEntries(
    (envKey) => envKey.startsWith(WORLD_CONFIG_ENV_PREFIX),
    (envKey, value) => {
      if (!value) return null;
      const suffix = envKey.slice(WORLD_CONFIG_ENV_PREFIX.length);
      if (!suffix) {
        logWarn(`Ignoring ${envKey}: missing world name suffix`);
        return null;
      }

      return {
        envKey,
        worldName: suffix.toLowerCase(),
        json: value,
      };
    }
  );
}

export function getWorldSettingEnvs(): HytaleWorldSettingEnv[] {
  return collectEnvEntries(
    (envKey) =>
      envKey.startsWith(WORLD_ENV_PREFIX) && !envKey.startsWith(WORLD_CONFIG_ENV_PREFIX),
    (envKey, value) => {
      const remainder = envKey.slice(WORLD_ENV_PREFIX.length);
      const separatorIndex = remainder.indexOf("_");
      if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
        logWarn(`Ignoring ${envKey}: expected WORLD_<WORLD_NAME>_<SETTING>`);
        return null;
      }

      const worldName = remainder.slice(0, separatorIndex).toLowerCase();
      const setting = remainder.slice(separatorIndex + 1).toUpperCase();
      return {
        envKey,
        worldName,
        setting,
        value,
      };
    }
  );
}

export function mergeWorldPatch<T extends object>(base: T, patch: object): T {
  return merge(base, patch) as T;
}
