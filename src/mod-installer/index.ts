import { MOD_INSTALL_MODE } from "../config.ts";
import { logWarn } from "../log-utils.ts";
import { curseForgeProvider } from "./curseforge.ts";
import type { ModProvider } from "./types.ts";

const modProviders: Record<string, ModProvider> = {
  curseforge: curseForgeProvider,
};

export async function installMods(): Promise<void> {
  const provider = modProviders[MOD_INSTALL_MODE];
  if (!provider) {
    if (MOD_INSTALL_MODE !== "off") {
      logWarn(`Unsupported MOD_INSTALL_MODE=${MOD_INSTALL_MODE}, skipping mod installation`);
    }
    return;
  }

  await provider.install();
}

export function getModDir(): string | null {
  const provider = modProviders[MOD_INSTALL_MODE];
  if (!provider) return null;
  return provider.getModDir();
}
