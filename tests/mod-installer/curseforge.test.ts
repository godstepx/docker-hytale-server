import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { runJsonRunner } from "../helpers/run-json-runner.ts";

const apiKey = process.env.CURSEFORGE_API_KEY;
const shouldRun = !!apiKey;
const requiredMods = ["1430352", "1431506"];
const requiredDependency = "1423634";

describe("mod installer curseforge", () => {
  (shouldRun ? test : test.skip)("installs mods from CurseForge", async () => {
    const dir = resolve(tmpdir(), `hytale-curseforge-${Date.now()}`);
    const modsDir = resolve(dir, "curseforge-mods");
    mkdirSync(modsDir, { recursive: true });

    const output = await runJsonRunner("tests/helpers/curseforge-runner.ts", {
      DATA_DIR: dir,
      CURSEFORGE_MODS_DIR: modsDir,
      CURSEFORGE_API_KEY: apiKey ?? "",
      CURSEFORGE_MOD_LIST: requiredMods.join(","),
      DRY_RUN: "false",
      MOD_INSTALL_MODE: "curseforge",
    }) as { files: string[]; entries: Record<string, unknown> };

    expect(output.files.length).toBeGreaterThan(0);
    const entryKeys = Object.keys(output.entries);
    for (const modId of requiredMods) {
      expect(entryKeys).toContain(modId);
    }
    expect(entryKeys).toContain(requiredDependency);

    rmSync(dir, { recursive: true, force: true });
  }, { timeout: 30000 });
});
