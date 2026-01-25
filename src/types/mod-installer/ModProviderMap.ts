import type { CurseForgeStateEntry } from "./curseforge/CurseForgeStateEntry.ts";
import type { ModProvider } from "./ModProvider.ts";
import type { ProviderMap } from "./ProviderMap.ts";

export type ModProviderMap = ProviderMap<{
  curseforge: ModProvider<CurseForgeStateEntry>;
}>;
