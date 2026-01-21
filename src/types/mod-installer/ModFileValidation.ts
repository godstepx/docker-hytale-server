import type { ModFileHashMap } from "./ModFileHashMap.ts";

export type ModFileValidation = {
  hashes?: ModFileHashMap;
  fileLength?: number;
};
