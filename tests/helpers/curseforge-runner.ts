import { existsSync, readdirSync } from "fs";

const dataDir = process.env.DATA_DIR;
const modsDir = process.env.CURSEFORGE_MODS_DIR;

if (!dataDir || !modsDir) {
  console.error("DATA_DIR and CURSEFORGE_MODS_DIR are required");
  process.exit(1);
}

process.env.DATA_DIR = dataDir;

async function main(): Promise<void> {
  const { CurseForgeProvider } = await import("../../src/mod-installer/curseforge.ts");
  const { loadModState } = await import("../../src/mod-installer/state.ts");

  const provider = new CurseForgeProvider();
  await provider.install();

  const files = existsSync(modsDir) ? readdirSync(modsDir) : [];
  const state = loadModState();
  const entries = state.providers.curseforge?.entries ?? {};

  console.log(JSON.stringify({ modsDir, files, entries }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
