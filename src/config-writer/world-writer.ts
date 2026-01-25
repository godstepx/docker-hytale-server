import { mkdirSync } from "fs";
import { resolve } from "path";
import { logWarn } from "../log-utils.ts";
import { DRY_RUN } from "../config.ts";
import { MultiJsonWriter } from "./multi-json-writer.ts";
import { WorldFileWriter } from "./world-file-writer.ts";
import type { HytaleWorldConfigEnv, HytaleWorldSettingEnv } from "../types/hytale-config.ts";
import { getWorldConfigEnvs, getWorldSettingEnvs, getWorldsDir } from "./world-helpers.ts";

export class WorldConfigWriter extends MultiJsonWriter {
  protected writerLabel = "world config";

  write(): void {
    const worldConfigs = getWorldConfigEnvs();
    const worldSettings = getWorldSettingEnvs();
    if (this.shouldSkip(worldConfigs.length > 0 || worldSettings.length > 0)) {
      return;
    }

    const worldsDir = getWorldsDir();
    const overridesByWorld = new Map<string, HytaleWorldConfigEnv>();
    for (const entry of worldConfigs) {
      overridesByWorld.set(entry.worldName, entry);
    }

    const settingsByWorld = new Map<string, HytaleWorldSettingEnv[]>();
    for (const entry of worldSettings) {
      const list = settingsByWorld.get(entry.worldName) ?? [];
      list.push(entry);
      settingsByWorld.set(entry.worldName, list);
    }

    const worldNames = new Set<string>([
      ...overridesByWorld.keys(),
      ...settingsByWorld.keys(),
    ]);

    for (const worldName of worldNames) {
      const override = overridesByWorld.get(worldName);
      const settings = settingsByWorld.get(worldName) ?? [];
      const worldDir = resolve(worldsDir, worldName);
      const worldConfigPath = resolve(worldDir, "config.json");

      if (override && settings.length > 0) {
        logWarn(`Ignoring world settings for ${worldName} due to ${override.envKey}`);
      }

      if (!DRY_RUN) {
        mkdirSync(worldDir, { recursive: true });
      }

      const writer = new WorldFileWriter(
        worldName,
        worldConfigPath,
        override?.envKey ?? "WORLD_CONFIG_JSON",
        override?.json ?? null,
        override ? [] : settings
      );
      writer.write();
    }
  }
}
