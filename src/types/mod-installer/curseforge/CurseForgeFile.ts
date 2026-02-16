import type { CurseForgeDependency } from "./CurseForgeDependency.ts";

export type CurseForgeFile = {
  modId: number;
  modName: string;
  modSlug: string;
  fileId: number;
  fileName: string;
  downloadUrl: string;
  fileLength: number;
  releaseType: number;
  hashes: Record<string, string>;
  gameVersions: string[];
  dependencies?: CurseForgeDependency[];
};
