import { createHash } from "crypto";
import { existsSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import type { ModProvider } from "../types/mod-installer.ts";
import { DOWNLOAD_MAX_RETRIES } from "../config.ts";
import { logWarn } from "../log-utils.ts";
import { calculateBackoff } from "../utils.ts";
import type { ModFileHashMap, ModFileValidation } from "../types/mod-installer.ts";

export abstract class ModInstallerProvider<TState> implements ModProvider<TState> {
  abstract install(): Promise<void>;
  abstract getModDir(): string;

  protected pickPreferredHash(
    hashes: ModFileHashMap,
    preferred: string[] = ["sha256", "sha1", "md5"]
  ): { algo: string; value: string } | null {
    for (const algo of preferred) {
      const value = hashes[algo];
      if (value) return { algo, value };
    }
    return null;
  }

  protected async calculateHash(path: string, algo: string): Promise<string> {
    const data = await Bun.file(path).arrayBuffer();
    const hash = createHash(algo);
    hash.update(Buffer.from(data));
    return hash.digest("hex");
  }

  protected async validateFile(path: string, validation: ModFileValidation): Promise<boolean> {
    if (!existsSync(path)) return false;

    if (validation.hashes) {
      const preferredHash = this.pickPreferredHash(validation.hashes);
      if (preferredHash) {
        const actual = await this.calculateHash(path, preferredHash.algo);
        return actual.toLowerCase() === preferredHash.value.toLowerCase();
      }
    }

    if (validation.fileLength && validation.fileLength > 0) {
      const stats = statSync(path);
      return stats.size === validation.fileLength;
    }

    return true;
  }

  protected async downloadFile(url: string, targetPath: string, label: string): Promise<void> {
    let attempt = 1;
    const tempPath = `${targetPath}.download`;

    while (attempt <= DOWNLOAD_MAX_RETRIES) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = new Uint8Array(await response.arrayBuffer());
        writeFileSync(tempPath, buffer);
        renameSync(tempPath, targetPath);
        return;
      } catch (error) {
        rmSync(tempPath, { force: true });
        if (attempt >= DOWNLOAD_MAX_RETRIES) {
          throw new Error(`${label} download failed (${error})`);
        }
        const backoff = calculateBackoff(attempt);
        logWarn(`${label} download failed (${error}), retrying in ${backoff}s...`);
        await Bun.sleep(backoff * 1000);
        attempt++;
      }
    }
  }

  protected async fetchJsonWithRetries<T>(
    url: string,
    label: string,
    options?: {
      headers?: Record<string, string>;
      onResponseError?: (response: Response, body: string) => Error | null;
    }
  ): Promise<T> {
    let attempt = 1;
    while (attempt <= DOWNLOAD_MAX_RETRIES) {
      try {
        const response = await fetch(url, { headers: options?.headers });
        if (!response.ok) {
          const body = await response.text();
          const maybeError = options?.onResponseError?.(response, body) ?? null;
          if (maybeError) throw maybeError;
          throw new Error(`HTTP ${response.status}: ${response.statusText} ${body || ""}`.trim());
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) {
          throw error;
        }
        if (attempt >= DOWNLOAD_MAX_RETRIES) {
          throw error;
        }
        const backoff = calculateBackoff(attempt);
        logWarn(`${label} failed (${error}), retrying in ${backoff}s...`);
        await Bun.sleep(backoff * 1000);
        attempt++;
      }
    }

    throw new Error(`${label} failed after ${DOWNLOAD_MAX_RETRIES} attempts`);
  }

  protected removeCachedFiles<T extends { fileName: string }>(
    entries: Record<string, T>,
    modsDir: string
  ): string[] {
    const removed: string[] = [];
    for (const entry of Object.values(entries)) {
      const stalePath = `${modsDir}/${entry.fileName}`;
      if (existsSync(stalePath)) {
        rmSync(stalePath, { force: true });
        removed.push(entry.fileName);
      }
    }
    return removed;
  }

  protected pruneStaleEntries<T extends { fileName: string }>(
    entries: Record<string, T>,
    modsDir: string,
    desiredKeys: Set<string>,
    desiredFiles: Set<string>
  ): string[] {
    const removed: string[] = [];
    for (const [key, entry] of Object.entries(entries)) {
      if (!desiredKeys.has(key) || !desiredFiles.has(entry.fileName)) {
        const stalePath = `${modsDir}/${entry.fileName}`;
        if (existsSync(stalePath)) {
          rmSync(stalePath, { force: true });
          removed.push(entry.fileName);
        }
        delete entries[key];
      }
    }
    return removed;
  }
}
