export type CurseForgeStateEntry = {
  modId: number;
  fileId: number;
  fileName: string;
  fileLength: number;
  hashes: Record<string, string>;
  installedAt: string;
};
