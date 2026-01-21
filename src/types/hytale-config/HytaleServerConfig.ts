import type { HytaleGameMode } from "./HytaleGameMode.ts";

export interface HytaleServerConfig {
  Version: number;
  ServerName: string;
  MOTD: string;
  Password: string;
  MaxPlayers: number;
  MaxViewRadius: number;
  LocalCompressionEnabled: boolean;
  Defaults: {
    World: string;
    GameMode: HytaleGameMode;
  };
  ConnectionTimeouts: {
    JoinTimeouts: Record<string, unknown>;
  };
  RateLimit: Record<string, unknown>;
  Modules: Record<string, unknown>;
  LogLevels: Record<string, unknown>;
  Mods: Record<string, unknown>;
  DisplayTmpTagsInStrings: boolean;
  PlayerStorage: {
    Type: string;
  };
}
