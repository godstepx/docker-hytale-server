import { resolve } from "path";
import {
  DATA_DIR,
  // config.json env vars
  HYTALE_CONFIG_JSON,
  SERVER_NAME,
  SERVER_MOTD,
  SERVER_PASSWORD,
  MAX_PLAYERS,
  MAX_VIEW_RADIUS,
  LOCAL_COMPRESSION_ENABLED,
  DEFAULT_WORLD,
  DEFAULT_GAME_MODE,
  DISPLAY_TMP_TAGS_IN_STRINGS,
  PLAYER_STORAGE_TYPE,
} from "../config.ts";
import { hasEnvVars } from "./utils.ts";
import { JsonFileWriter } from "./json-file-writer.ts";
import { HytaleServerConfig } from "../types/hytale-config.ts";

const CONFIG_FILE = resolve(DATA_DIR, "config.json");

const CONFIG_ENV_KEYS = [
  "HYTALE_CONFIG_JSON",
  "SERVER_NAME",
  "SERVER_MOTD",
  "SERVER_PASSWORD",
  "MAX_PLAYERS",
  "MAX_VIEW_RADIUS",
  "LOCAL_COMPRESSION_ENABLED",
  "DEFAULT_WORLD",
  "DEFAULT_GAME_MODE",
  "DISPLAY_TMP_TAGS_IN_STRINGS",
  "PLAYER_STORAGE_TYPE",
];

export class ServerConfigWriter extends JsonFileWriter<HytaleServerConfig> {
  protected filePath = CONFIG_FILE;
  protected fileLabel = "config.json";
  protected overrideEnvKey = "HYTALE_CONFIG_JSON";

  protected getDefaultConfig(): HytaleServerConfig {
    return {
      Version: 3,
      ServerName: SERVER_NAME,
      MOTD: SERVER_MOTD,
      Password: SERVER_PASSWORD,
      MaxPlayers: MAX_PLAYERS,
      MaxViewRadius: MAX_VIEW_RADIUS,
      LocalCompressionEnabled: LOCAL_COMPRESSION_ENABLED,
      Defaults: {
        World: DEFAULT_WORLD,
        GameMode: DEFAULT_GAME_MODE,
      },
      ConnectionTimeouts: {
        JoinTimeouts: {},
      },
      RateLimit: {},
      Modules: {},
      LogLevels: {},
      Mods: {},
      DisplayTmpTagsInStrings: DISPLAY_TMP_TAGS_IN_STRINGS,
      PlayerStorage: {
        Type: PLAYER_STORAGE_TYPE,
      },
    };
  }

  protected getOverrideJson(): string | null {
    return HYTALE_CONFIG_JSON || null;
  }

  protected hasPatchEnvVars(): boolean {
    return hasEnvVars(CONFIG_ENV_KEYS);
  }

  protected patchConfig(): Partial<HytaleServerConfig> {
    const patch: Partial<HytaleServerConfig> = {};

    this.applyIfSet("SERVER_NAME", patch, "ServerName", SERVER_NAME);

    this.applyIfSet("SERVER_MOTD", patch, "MOTD", SERVER_MOTD);

    this.applyIfSet("SERVER_PASSWORD", patch, "Password", SERVER_PASSWORD);

    this.applyIfSet("MAX_PLAYERS", patch, "MaxPlayers", MAX_PLAYERS);

    this.applyIfSet("MAX_VIEW_RADIUS", patch, "MaxViewRadius", MAX_VIEW_RADIUS);

    this.applyIfSet("LOCAL_COMPRESSION_ENABLED", patch, "LocalCompressionEnabled", LOCAL_COMPRESSION_ENABLED);

    this.applyIfSet("DEFAULT_WORLD", patch, "Defaults.World", DEFAULT_WORLD);

    this.applyIfSet("DEFAULT_GAME_MODE", patch, "Defaults.GameMode", DEFAULT_GAME_MODE);

    this.applyIfSet(
      "DISPLAY_TMP_TAGS_IN_STRINGS",
      patch,
      "DisplayTmpTagsInStrings",
      DISPLAY_TMP_TAGS_IN_STRINGS
    );

    this.applyIfSet("PLAYER_STORAGE_TYPE", patch, "PlayerStorage.Type", PLAYER_STORAGE_TYPE);

    return patch;
  }
}
