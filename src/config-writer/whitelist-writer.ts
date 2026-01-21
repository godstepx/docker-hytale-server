import { resolve } from "path";
import {
  DATA_DIR,
  WHITELIST_ENABLED,
  WHITELIST_LIST,
  WHITELIST_JSON,
} from "../config.ts";
import { hasEnvVars } from "./utils.ts";
import { JsonFileWriter } from "./json-file-writer.ts";
import { HytaleWhitelistConfig } from "../types/hytale-config.ts";

const WHITELIST_FILE = resolve(DATA_DIR, "whitelist.json");

const WHITELIST_ENV_KEYS = ["WHITELIST_JSON", "WHITELIST_ENABLED", "WHITELIST_LIST"];

export class WhitelistJsonWriter extends JsonFileWriter<HytaleWhitelistConfig> {
  protected filePath = WHITELIST_FILE;
  protected fileLabel = "whitelist.json";
  protected overrideEnvKey = "WHITELIST_JSON";

  protected getDefaultConfig(): HytaleWhitelistConfig {
    return {
      enabled: WHITELIST_ENABLED,
      list: WHITELIST_LIST,
    };
  }

  protected getOverrideJson(): string | null {
    return WHITELIST_JSON || null;
  }

  protected hasPatchEnvVars(): boolean {
    return hasEnvVars(WHITELIST_ENV_KEYS);
  }

  protected patchConfig(): Partial<HytaleWhitelistConfig> {
    const patch: Partial<HytaleWhitelistConfig> = {};

    this.applyIfSet("WHITELIST_ENABLED", patch, "enabled", WHITELIST_ENABLED);
    this.applyIfSet("WHITELIST_LIST", patch, "list", WHITELIST_LIST);

    return patch;
  }
}
