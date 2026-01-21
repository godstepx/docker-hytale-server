import type { CurseForgeStateEntry } from "./curseforge/CurseForgeStateEntry.ts";
import type { ModProvider } from "./ModProvider.ts";

export type ModProviders = {
  curseforge: ModProvider<CurseForgeStateEntry>;
};
