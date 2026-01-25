import type { CurseForgeDependency } from "./CurseForgeDependency.ts";

export type CurseForgeFile = {
  modId: number;
  fileId: number;
  fileName: string;
  downloadUrl: string;
  fileLength: number;
  hashes: Record<string, string>;
  gameVersions: string[];
  dependencies?: CurseForgeDependency[];
};
