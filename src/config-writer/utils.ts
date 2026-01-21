import { readFileSync, writeFileSync } from "fs";
import { logInfo, logDebug, logWarn } from "../log-utils.ts";
import { DRY_RUN, isEnvSet } from "../config.ts";
import { DeepPatch } from "../types/config-writer.ts";

export function safeParseJson<T>(json: string, description: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    logWarn(`Failed to parse ${description}: ${error}`);
    return null;
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, data: object | string | number | boolean | null): void {
  const content = JSON.stringify(data, null, 2);
  if (DRY_RUN) {
    logInfo(`[DRY_RUN] Would write to ${filePath}:`);
    logDebug(content);
    return;
  }
  writeFileSync(filePath, content, "utf-8");
}

export function hasEnvVars(keys: string[]): boolean {
  return keys.some((key) => isEnvSet(key));
}

export function buildNestedPatch<T>(pathParts: string[], value: T): DeepPatch<T> {
  const [head, ...rest] = pathParts;
  if (!head) return {};
  if (rest.length === 0) {
    return { [head]: value };
  }
  return { [head]: buildNestedPatch(rest, value) };
}
