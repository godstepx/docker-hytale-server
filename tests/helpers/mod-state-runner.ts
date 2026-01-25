import type { ModProviderMap } from "../../src/types/mod-installer.ts";

const dataDir = process.env.DATA_DIR;
const action = process.env.STATE_ACTION;
const providerId = process.env.PROVIDER_ID || "curseforge";

if (!dataDir || !action) {
  console.error("DATA_DIR and STATE_ACTION are required");
  process.exit(1);
}

process.env.DATA_DIR = dataDir;

async function main(): Promise<void> {
  const { loadModState, saveModState, getProviderState } = await import(
    "../../src/mod-installer/state.ts"
  );

  if (action === "load") {
    const state = loadModState();
    console.log(JSON.stringify(state));
    return;
  }

  if (action === "save") {
    const raw = process.env.STATE_JSON;
    if (!raw) {
      console.error("STATE_JSON is required for save");
      process.exit(1);
    }
    const parsed = JSON.parse(raw);
    saveModState(parsed);
    console.log(JSON.stringify({ ok: true }));
    return;
  }

  if (action === "get-provider") {
    const state = loadModState();
    const provider = getProviderState(state, providerId as keyof ModProviderMap);
    console.log(JSON.stringify({ state, provider }));
    return;
  }

  console.error(`Unknown STATE_ACTION=${action}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
