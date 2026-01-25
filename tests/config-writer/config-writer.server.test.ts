import "./env.ts";
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { expectSnapshot, runConfigWriter, runOverrideWriter } from "../helpers/config-writer-test-utils.ts";
import { buildConfigWriterEnv } from "./env.ts";

describe("config writer (server)", () => {
  test("patch", async () => {
    const baseConfig = {
      Version: 3,
      ServerName: "Base",
      MOTD: "Base",
      Password: "",
      MaxPlayers: 1,
      MaxViewRadius: 5,
      LocalCompressionEnabled: false,
      Defaults: {
        World: "default",
        GameMode: "Adventure",
      },
      ConnectionTimeouts: {
        JoinTimeouts: {},
      },
      RateLimit: {},
      Modules: {},
      LogLevels: {},
      Mods: {},
      DisplayTmpTagsInStrings: false,
      PlayerStorage: {
        Type: "Hytale",
      },
    };

    const output = await runConfigWriter({
      WRITER_KIND: "server",
      WRITER_ACTION: "patch",
      BASE_CONFIG_JSON: JSON.stringify(baseConfig, null, 2),
      ...buildConfigWriterEnv(resolve(tmpdir(), "hytale-config-writer-server")),
    });
    expectSnapshot(output);
  });

  test("override", async () => {
    const output = await runOverrideWriter({
      WRITER_KIND: "server",
      HYTALE_CONFIG_JSON: JSON.stringify({
        Version: 9,
        ServerName: "Override",
        MOTD: "Override",
        Password: "",
        MaxPlayers: 1,
        MaxViewRadius: 1,
        LocalCompressionEnabled: false,
        Defaults: {
          World: "override",
          GameMode: "Adventure",
        },
        ConnectionTimeouts: {
          JoinTimeouts: {},
        },
        RateLimit: {},
        Modules: {},
        LogLevels: {},
        Mods: {},
        DisplayTmpTagsInStrings: false,
        PlayerStorage: {
          Type: "Hytale",
        },
      }),
    });

    expectSnapshot(output);
  });
});
