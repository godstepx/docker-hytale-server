import { existsSync } from "fs";
import deepmerge from "@fastify/deepmerge";
import { isEnvSet } from "../config.ts";
import { logInfo, logDebug, logWarn } from "../log-utils.ts";
import { readJsonFile, safeParseJson, writeJsonFile, buildNestedPatch } from "./utils.ts";
import type { ConfigWriter, Path, PathValue } from "../types/config-writer.ts";

const merge = deepmerge({ all: true });

export abstract class JsonFileWriter<T extends object> implements ConfigWriter {
  protected abstract filePath: string;
  protected abstract fileLabel: string;
  protected abstract overrideEnvKey: string;
  protected patchedFields: string[] = [];

  protected abstract getDefaultConfig(): T;
  protected abstract getOverrideJson(): string | null;
  protected abstract hasPatchEnvVars(): boolean;
  protected abstract patchConfig(): Partial<T>;

  write(): void {
    const fileExists = existsSync(this.filePath);

    const overrideJson = this.getOverrideJson();
    if (overrideJson) {
      const parsed = safeParseJson<T>(overrideJson, this.overrideEnvKey);
      if (parsed) {
        writeJsonFile(this.filePath, parsed);
        logInfo(`Using ${this.fileLabel} from ${this.overrideEnvKey} override`);
        return;
      }
      logWarn(`${this.overrideEnvKey} invalid, ignoring`);
    }

    if (!fileExists) {
      writeJsonFile(this.filePath, this.getDefaultConfig());
      logInfo(`Created ${this.fileLabel}`);
      return;
    }

    if (!this.hasPatchEnvVars()) {
      logDebug(`${this.fileLabel} exists, no env vars set, skipping`);
      return;
    }

    const existing = readJsonFile<T>(this.filePath);
    if (!existing) {
      logWarn(`Failed to read existing ${this.fileLabel}, creating new one`);
      writeJsonFile(this.filePath, this.getDefaultConfig());
      return;
    }

    this.patchedFields = [];
    const patch = this.patchConfig();
    if (this.patchedFields.length > 0) {
      const merged = merge(existing, patch);
      writeJsonFile(this.filePath, merged);
      logInfo(`Patched ${this.fileLabel}: ${this.patchedFields.join(", ")}`);
    }
  }

  protected applyIfSet<P extends Path<T>>(
    envKey: string,
    patch: Partial<T>,
    path: P,
    value: PathValue<T, P>
  ): void {
    if (!isEnvSet(envKey)) return;
    const nestedPatch = buildNestedPatch(path.split("."), value);
    const merged = merge(patch, nestedPatch);
    Object.assign(patch, merged);
    this.patchedFields.push(path);
  }
}
