import { describe, test, expect } from "bun:test";
import { createHash } from "crypto";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { ModInstallerProvider } from "../../src/mod-installer/provider.ts";

class TestProvider extends ModInstallerProvider<Record<string, never>> {
  async install(): Promise<void> {
    return;
  }

  getModDir(): string {
    return "";
  }

  pickPreferredHashPublic(hashes: Record<string, string>): { algo: string; value: string } | null {
    return this.pickPreferredHash(hashes);
  }

  validateFilePublic(path: string, validation: { hashes?: Record<string, string>; fileLength?: number }): Promise<boolean> {
    return this.validateFile(path, validation);
  }

  pruneStaleEntriesPublic<T extends { fileName: string }>(
    entries: Record<string, T>,
    modsDir: string,
    desiredKeys: Set<string>,
    desiredFiles: Set<string>
  ): string[] {
    return this.pruneStaleEntries(entries, modsDir, desiredKeys, desiredFiles);
  }

  removeCachedFilesPublic<T extends { fileName: string }>(
    entries: Record<string, T>,
    modsDir: string
  ): string[] {
    return this.removeCachedFiles(entries, modsDir);
  }
}

describe("mod installer provider", () => {
  const provider = new TestProvider();

  test("pickPreferredHash respects priority", () => {
    const result = provider.pickPreferredHashPublic({
      md5: "md5",
      sha1: "sha1",
      sha256: "sha256",
    });
    expect(result).toEqual({ algo: "sha256", value: "sha256" });
  });

  test("validateFile supports hash and size checks", async () => {
    const dir = resolve(tmpdir(), `hytale-mod-provider-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const filePath = resolve(dir, "test.bin");
    writeFileSync(filePath, Buffer.from("payload"));

    const hash = createHash("sha256").update("payload").digest("hex");
    const byHash = await provider.validateFilePublic(filePath, { hashes: { sha256: hash } });
    expect(byHash).toBe(true);

    const bySize = await provider.validateFilePublic(filePath, { fileLength: 7 });
    expect(bySize).toBe(true);

    const mismatch = await provider.validateFilePublic(filePath, { fileLength: 3 });
    expect(mismatch).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("pruneStaleEntries removes stale entries and files", () => {
    const dir = resolve(tmpdir(), `hytale-mod-provider-prune-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const keepPath = resolve(dir, "keep.jar");
    const stalePath = resolve(dir, "stale.jar");
    writeFileSync(keepPath, "keep");
    writeFileSync(stalePath, "stale");

    const entries = {
      keep: { fileName: "keep.jar" },
      stale: { fileName: "stale.jar" },
    };

    const removed = provider.pruneStaleEntriesPublic(
      entries,
      dir,
      new Set(["keep"]),
      new Set(["keep.jar"])
    );

    expect(removed).toEqual(["stale.jar"]);
    expect(entries.stale).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });

  test("removeCachedFiles removes all entries", () => {
    const dir = resolve(tmpdir(), `hytale-mod-provider-remove-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "a.jar"), "a");
    writeFileSync(resolve(dir, "b.jar"), "b");

    const entries = {
      a: { fileName: "a.jar" },
      b: { fileName: "b.jar" },
    };

    const removed = provider.removeCachedFilesPublic(entries, dir);
    expect(removed).toEqual(["a.jar", "b.jar"]);

    rmSync(dir, { recursive: true, force: true });
  });
});
