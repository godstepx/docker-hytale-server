import type { HytaleItemsLossMode } from "./HytaleItemsLossMode.ts";

export interface HytaleWorldConfig {
  Version: number;
  Seed?: number;
  WorldGen: {
    Type: string;
    Name: string;
  };
  WorldMap: {
    Type: string;
  };
  ChunkStorage: {
    Type: string;
  };
  IsTicking: boolean;
  IsBlockTicking: boolean;
  IsPvpEnabled: boolean;
  IsFallDamageEnabled: boolean;
  IsGameTimePaused: boolean;
  GameTime?: string;
  ClientEffects?: {
    SunHeightPercent?: number;
    SunAngleDegrees?: number;
    BloomIntensity?: number;
    BloomPower?: number;
    SunIntensity?: number;
    SunshaftIntensity?: number;
    SunshaftScaleFactor?: number;
  };
  IsSpawningNPC: boolean;
  IsSpawnMarkersEnabled: boolean;
  IsAllNPCFrozen: boolean;
  GameplayConfig: string;
  Death?: {
    RespawnController?: {
      Type?: string;
    };
    ItemsLossMode?: HytaleItemsLossMode;
    ItemsAmountLossPercentage?: number;
    ItemsDurabilityLossPercentage?: number;
  };
  IsCompassUpdating: boolean;
  IsSavingPlayers: boolean;
  IsSavingChunks: boolean;
  SaveNewChunks: boolean;
  IsUnloadingChunks: boolean;
  IsObjectiveMarkersEnabled: boolean;
  DeleteOnUniverseStart: boolean;
  DeleteOnRemove: boolean;
  ResourceStorage: {
    Type: string;
  };
}
