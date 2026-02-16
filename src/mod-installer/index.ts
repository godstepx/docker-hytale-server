import { MOD_INSTALL_MODE } from "../config.ts";
import { logWarn } from "../log-utils.ts";
import { CurseForgeProvider } from "./curseforge.ts";
import type { ModProvider } from "../types/mod-installer.ts";

export const modProviders: Record<string, ModProvider<unknown>> = {
  curseforge: new CurseForgeProvider(),
};

function getProvider(id: string): (typeof modProviders)[keyof typeof modProviders] | null {
  const provider = modProviders[id];
  return provider ?? null;
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
