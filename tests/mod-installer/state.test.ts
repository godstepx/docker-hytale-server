import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { runJsonRunner } from "../helpers/run-json-runner.ts";

describe("mod installer state", () => {
  test("loads empty state when missing", async () => {
    const dir = resolve(tmpdir(), `hytale-mod-state-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const output = await runJsonRunner("tests/helpers/mod-state-runner.ts", {
      DATA_DIR: dir,
      STATE_ACTION: "load",
    });

    expect(output).toEqual({ providers: {} });
    rmSync(dir, { recursive: true, force: true });
  });

  test("migrates legacy cache", async () => {
    const dir = resolve(tmpdir(), `hytale-mod-state-legacy-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const legacy = {
      mods: {
        "123": {
          modId: 123,
          fileId: 456,
          fileName: "mod.jar",
          fileLength: 100,
          hashes: { sha1: "abc" },
          installedAt: "2020-01-01T00:00:00Z",
        },
      },
    };
    writeFileSync(resolve(dir, ".mods-cache.json"), JSON.stringify(legacy, null, 2));

    const output = await runJsonRunner("tests/helpers/mod-state-runner.ts", {
      DATA_DIR: dir,
      STATE_ACTION: "load",
    });

    expect(output).toEqual({
      providers: {
        curseforge: {
          entries: legacy.mods,
        },
      },
    });
    expect(existsSync(resolve(dir, ".mods-state.json"))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("getProviderState creates provider entry", async () => {
    const dir = resolve(tmpdir(), `hytale-mod-state-provider-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const output = await runJsonRunner("tests/helpers/mod-state-runner.ts", {
      DATA_DIR: dir,
      STATE_ACTION: "get-provider",
      PROVIDER_ID: "curseforge",
    }) as { state: { providers: Record<string, unknown> }; provider: unknown };

    expect(Object.keys(output.state.providers)).toEqual(["curseforge"]);
    expect(output.provider).toEqual({ entries: {} });

    expect(existsSync(resolve(dir, ".mods-state.json"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("saveModState writes state file", async () => {
    const dir = resolve(tmpdir(), `hytale-mod-state-save-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const state = { providers: { curseforge: { entries: {} } } };

    await runJsonRunner("tests/helpers/mod-state-runner.ts", {
      DATA_DIR: dir,
      STATE_ACTION: "save",
      STATE_JSON: JSON.stringify(state),
    });

    const fileContent = JSON.parse(readFileSync(resolve(dir, ".mods-state.json"), "utf-8"));
    expect(fileContent).toEqual(state);

    rmSync(dir, { recursive: true, force: true });
  });
});
