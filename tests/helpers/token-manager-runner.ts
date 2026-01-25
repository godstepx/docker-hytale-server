const dataDir = process.env.DATA_DIR;
const action = process.env.TOKEN_ACTION;

if (!dataDir || !action) {
  console.error("DATA_DIR and TOKEN_ACTION are required");
  process.exit(1);
}

process.env.DATA_DIR = dataDir;

async function main(): Promise<void> {
  const { loadOAuthTokens, saveOAuthTokens, clearTokens } = await import(
    "../../src/token-manager.ts"
  );

  if (action === "load") {
    console.log(JSON.stringify(loadOAuthTokens()));
    return;
  }

  if (action === "save") {
    const raw = process.env.TOKENS_JSON;
    if (!raw) {
      console.error("TOKENS_JSON is required for save");
      process.exit(1);
    }
    saveOAuthTokens(JSON.parse(raw));
    console.log(JSON.stringify(loadOAuthTokens()));
    return;
  }

  if (action === "clear") {
    clearTokens();
    console.log(JSON.stringify(loadOAuthTokens()));
    return;
  }

  console.error(`Unknown TOKEN_ACTION=${action}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
