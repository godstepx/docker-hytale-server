import { logInfo, logDebug, logWarn } from "../log-utils.ts";
import { safeParseJson, writeJsonFile } from "./utils.ts";
import type { ConfigWriter } from "../types/config-writer.ts";

export abstract class MultiJsonWriter implements ConfigWriter {
  protected abstract writerLabel: string;
  abstract write(): void;

  protected shouldSkip(hasChanges: boolean): boolean {
    if (hasChanges) return false;
    this.logNoChanges();
    return true;
  }

  protected logNoChanges(): void {
    logDebug(`${this.writerLabel}: no changes`);
  }

  protected logWritten(message: string): void {
    logInfo(`${this.writerLabel}: ${message}`);
  }

  protected parseOverride<T>(
    overrideEnvKey: string,
    overrideJson: string,
    invalidMessage: string
  ): T | null {
    const parsed = safeParseJson<T>(overrideJson, overrideEnvKey);
    if (parsed) return parsed;
    logWarn(invalidMessage);
    return null;
  }

  protected writeOverride<T extends object | string | number | boolean | null>(
    filePath: string,
    data: T,
    successMessage: string
  ): void {
    writeJsonFile(filePath, data);
    this.logWritten(successMessage);
  }
}
