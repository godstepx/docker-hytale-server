import type { HytaleWorldConfig, HytaleWorldSettingEnv } from "../types/hytale-config.ts";
import { JsonFileWriter } from "./json-file-writer.ts";
import { buildEnsureDefaults, buildWorldPatch, getDefaultWorldConfig, mergeWorldPatch } from "./world-helpers.ts";

export class WorldFileWriter extends JsonFileWriter<HytaleWorldConfig> {
  protected filePath: string;
  protected fileLabel: string;
  protected overrideEnvKey: string;

  private overrideJson: string | null;
  private settings: HytaleWorldSettingEnv[];

  constructor(
    worldName: string,
    filePath: string,
    overrideEnvKey: string,
    overrideJson: string | null,
    settings: HytaleWorldSettingEnv[]
  ) {
    super();
    this.filePath = filePath;
    this.fileLabel = `world config (${worldName})`;
    this.overrideEnvKey = overrideEnvKey;
    this.overrideJson = overrideJson;
    this.settings = settings;
  }

  protected getDefaultConfig(): HytaleWorldConfig {
    return getDefaultWorldConfig();
  }

  protected getOverrideJson(): string | null {
    return this.overrideJson;
  }

  protected hasPatchEnvVars(): boolean {
    return this.settings.length > 0;
  }

  protected patchConfig(): Partial<HytaleWorldConfig> {
    const { patch, patchedFields, ensures } = buildWorldPatch(this.settings);
    this.patchedFields = patchedFields;
    const defaultsPatch = buildEnsureDefaults(ensures);
    return mergeWorldPatch(defaultsPatch, patch);
  }
}
