const action = process.env.SETUP_ACTION;
const dataDir = process.env.DATA_DIR;

if (!action) {
  console.error("SETUP_ACTION is required");
  process.exit(1);
}

if (dataDir) {
  process.env.DATA_DIR = dataDir;
}

async function main(): Promise<void> {
  const { buildJavaArgs } = await import("../../src/setup.ts");

  if (action === "java-args") {
    const args = buildJavaArgs(null);
    console.log(JSON.stringify(args));
    return;
  }

  console.error(`Unknown SETUP_ACTION=${action}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
