import "./env.ts";
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { expectSnapshot, runConfigWriter, runOverrideWriter } from "../helpers/config-writer-test-utils.ts";
import { buildConfigWriterEnv } from "./env.ts";

describe("config writer (whitelist)", () => {
  test("patch", async () => {
    const baseConfig = { enabled: false, list: [] as string[] };
    const output = await runConfigWriter({
      WRITER_KIND: "whitelist",
      WRITER_ACTION: "patch",
      BASE_CONFIG_JSON: JSON.stringify(baseConfig, null, 2),
      ...buildConfigWriterEnv(resolve(tmpdir(), "hytale-config-writer-whitelist")),
    });
    expectSnapshot(output);
  });

  test("override", async () => {
    const output = await runOverrideWriter({
      WRITER_KIND: "whitelist",
      WHITELIST_JSON: JSON.stringify({
        enabled: true,
        list: ["override"],
      }),
    });

    expectSnapshot(output);
  });
});
