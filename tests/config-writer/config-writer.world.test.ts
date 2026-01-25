import "./env.ts";
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import {
  expectSnapshot,
  runConfigWriter,
  runOverrideWriter,
} from "../helpers/config-writer-test-utils.ts";
import { buildConfigWriterEnv } from "./env.ts";

describe("config writer (world)", () => {
  test("patch", async () => {
    const baseConfig = {
      Version: 4,
      WorldGen: { Type: "Hytale", Name: "Default" },
      WorldMap: { Type: "WorldGen" },
      ChunkStorage: { Type: "Hytale" },
      IsTicking: true,
      IsBlockTicking: true,
      IsPvpEnabled: false,
      IsFallDamageEnabled: true,
      IsGameTimePaused: false,
      IsSpawningNPC: true,
      IsSpawnMarkersEnabled: true,
      IsAllNPCFrozen: false,
      GameplayConfig: "Default",
      IsCompassUpdating: true,
      IsSavingPlayers: true,
      IsSavingChunks: true,
      SaveNewChunks: true,
      IsUnloadingChunks: true,
      IsObjectiveMarkersEnabled: true,
      DeleteOnUniverseStart: false,
      DeleteOnRemove: false,
      Death: {
        RespawnController: { Type: "HomeOrSpawnPoint" },
        ItemsLossMode: "Configured",
        ItemsAmountLossPercentage: 50.0,
        ItemsDurabilityLossPercentage: 10.0,
      },
      ResourceStorage: { Type: "Hytale" },
    };
    const output = await runConfigWriter({
      WRITER_KIND: "world",
      WRITER_ACTION: "patch",
      WORLD_BASE_CONFIG_JSON: JSON.stringify(baseConfig, null, 2),
      WORLD_NAMES: "default",
      ...buildConfigWriterEnv(resolve(tmpdir(), "hytale-config-writer-world")),
    });
    expectSnapshot(output);
  });

  test("override", async () => {
    const output = await runOverrideWriter({
      WRITER_KIND: "world",
      WORLD_NAMES: "default",
      WORLD_CONFIG_JSON_default: JSON.stringify({
        Version: 10,
        WorldGen: { Type: "Custom", Name: "Override" },
        WorldMap: { Type: "Override" },
        ChunkStorage: { Type: "Override" },
        IsTicking: false,
        IsBlockTicking: false,
        IsPvpEnabled: false,
        IsFallDamageEnabled: false,
        IsGameTimePaused: true,
        IsSpawningNPC: false,
        IsSpawnMarkersEnabled: false,
        IsAllNPCFrozen: false,
        GameplayConfig: "Override",
        IsCompassUpdating: false,
        IsSavingPlayers: false,
        IsSavingChunks: false,
        SaveNewChunks: false,
        IsUnloadingChunks: false,
        IsObjectiveMarkersEnabled: false,
        DeleteOnUniverseStart: true,
        DeleteOnRemove: true,
        ResourceStorage: { Type: "Override" },
      }),
    });

    expectSnapshot(output);
  });

  test("override ignores settings", async () => {
    const baseOverride = {
      Version: 4,
      WorldGen: { Type: "Hytale", Name: "Default" },
      WorldMap: { Type: "WorldGen" },
      ChunkStorage: { Type: "Hytale" },
      IsTicking: true,
      IsBlockTicking: true,
      IsPvpEnabled: false,
      IsFallDamageEnabled: true,
      IsGameTimePaused: false,
      IsSpawningNPC: true,
      IsSpawnMarkersEnabled: true,
      IsAllNPCFrozen: false,
      GameplayConfig: "Override",
      IsCompassUpdating: true,
      IsSavingPlayers: true,
      IsSavingChunks: true,
      SaveNewChunks: true,
      IsUnloadingChunks: true,
      IsObjectiveMarkersEnabled: true,
      DeleteOnUniverseStart: false,
      DeleteOnRemove: false,
      Death: {
        RespawnController: { Type: "HomeOrSpawnPoint" },
        ItemsLossMode: "Configured",
        ItemsAmountLossPercentage: 50.0,
        ItemsDurabilityLossPercentage: 10.0,
      },
      ResourceStorage: { Type: "Hytale" },
    };

    const output = await runOverrideWriter({
      WRITER_KIND: "world",
      WORLD_NAMES: "default",
      WORLD_CONFIG_JSON_default: JSON.stringify(baseOverride),
      WORLD_DEFAULT_IS_PVP_ENABLED: "true",
      WORLD_DEFAULT_GAMEPLAY_CONFIG: "Hardcore",
    });

    expectSnapshot(output);
  });

  test("multiple worlds", async () => {
    const baseConfig = {
      Version: 4,
      WorldGen: { Type: "Hytale", Name: "Default" },
      WorldMap: { Type: "WorldGen" },
      ChunkStorage: { Type: "Hytale" },
      IsTicking: true,
      IsBlockTicking: true,
      IsPvpEnabled: false,
      IsFallDamageEnabled: true,
      IsGameTimePaused: false,
      IsSpawningNPC: true,
      IsSpawnMarkersEnabled: true,
      IsAllNPCFrozen: false,
      GameplayConfig: "Default",
      IsCompassUpdating: true,
      IsSavingPlayers: true,
      IsSavingChunks: true,
      SaveNewChunks: true,
      IsUnloadingChunks: true,
      IsObjectiveMarkersEnabled: true,
      DeleteOnUniverseStart: false,
      DeleteOnRemove: false,
      Death: {
        RespawnController: { Type: "HomeOrSpawnPoint" },
        ItemsLossMode: "Configured",
        ItemsAmountLossPercentage: 50.0,
        ItemsDurabilityLossPercentage: 10.0,
      },
      ResourceStorage: { Type: "Hytale" },
    };
    const output = await runConfigWriter({
      WRITER_KIND: "world",
      WRITER_ACTION: "multiple",
      WORLD_NAMES: "alpha,beta",
      WORLD_BASE_CONFIG_JSON: JSON.stringify(baseConfig, null, 2),
      WORLD_ALPHA_IS_PVP_ENABLED: "true",
      WORLD_BETA_IS_PVP_ENABLED: "false",
      WORLD_BETA_CLIENT_EFFECTS_BLOOM_POWER: "7",
      ...buildConfigWriterEnv(resolve(tmpdir(), "hytale-config-writer-worlds")),
    });

    expectSnapshot(output);
  });
});
