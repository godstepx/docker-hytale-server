import { MOD_INSTALL_MODE } from "../config.ts";
import { logWarn } from "../log-utils.ts";
import { curseForgeProvider } from "./curseforge.ts";
import type { ProviderStateOf, ModProvider } from "./types.ts";

const modProviders = {
  curseforge: curseForgeProvider,
} satisfies Record<string, ModProvider<unknown>>;

export type ProviderMap = {
  [K in keyof typeof modProviders]: ProviderStateOf<(typeof modProviders)[K]>;
};

function getProvider(id: string): (typeof modProviders)[keyof typeof modProviders] | null {
  if (id in modProviders) {
    return modProviders[id as keyof typeof modProviders];
  }
  return null;
}

export async function installMods(): Promise<void> {
  const provider = getProvider(MOD_INSTALL_MODE);
  if (!provider) {
    if (MOD_INSTALL_MODE !== "off") {
      logWarn(`Unsupported MOD_INSTALL_MODE=${MOD_INSTALL_MODE}, skipping mod installation`);
    }
    return;
  }

  await provider.install();
}

export function getModDir(): string | null {
  const provider = getProvider(MOD_INSTALL_MODE);
  if (!provider) return null;
  return provider.getModDir();
}
