import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const dataDir = process.env.TEST_DATA_DIR;
const writerKind = process.env.WRITER_KIND;
const writerAction = process.env.WRITER_ACTION || "override";
const worldNames = (process.env.WORLD_NAMES || "default")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

if (!dataDir || !writerKind) {
  console.error("TEST_DATA_DIR and WRITER_KIND are required");
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;
process.env.DRY_RUN = "false";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

async function main(): Promise<void> {
  if (writerKind === "server") {
    if (writerAction === "patch") {
      const base = process.env.BASE_CONFIG_JSON;
      if (!base) {
        console.error("BASE_CONFIG_JSON is required for patch");
        process.exit(1);
      }
      writeFileSync(resolve(dataDir, "config.json"), base);
    }

    const { ServerConfigWriter } = await import("../../src/config-writer/server-writer.ts");
    new ServerConfigWriter().write();
    const output = readJson(resolve(dataDir, "config.json"));
    console.log(JSON.stringify(output));
    return;
  }

  if (writerKind === "whitelist") {
    if (writerAction === "patch") {
      const base = process.env.BASE_CONFIG_JSON;
      if (!base) {
        console.error("BASE_CONFIG_JSON is required for patch");
        process.exit(1);
      }
      writeFileSync(resolve(dataDir, "whitelist.json"), base);
    }

    const { WhitelistJsonWriter } = await import("../../src/config-writer/whitelist-writer.ts");
    new WhitelistJsonWriter().write();
    const output = readJson(resolve(dataDir, "whitelist.json"));
    console.log(JSON.stringify(output));
    return;
  }

  if (writerKind === "world") {
    const { getDefaultWorldConfig, getWorldsDir } = await import(
      "../../src/config-writer/world-helpers.ts"
    );
    const worldsDir = getWorldsDir();

    if (writerAction === "patch") {
      const base = process.env.WORLD_BASE_CONFIG_JSON;
      if (!base) {
        console.error("WORLD_BASE_CONFIG_JSON is required for patch");
        process.exit(1);
      }
      for (const worldName of worldNames) {
        const worldDir = resolve(worldsDir, worldName);
        mkdirSync(worldDir, { recursive: true });
        writeFileSync(resolve(worldDir, "config.json"), base);
      }
    } else if (writerAction === "multiple") {
      const base = process.env.WORLD_BASE_CONFIG_JSON;
      const configJson = base ?? JSON.stringify(getDefaultWorldConfig());
      for (const worldName of worldNames) {
        const worldDir = resolve(worldsDir, worldName);
        mkdirSync(worldDir, { recursive: true });
        writeFileSync(resolve(worldDir, "config.json"), configJson);
      }
    }

    const { WorldConfigWriter } = await import("../../src/config-writer/world-writer.ts");
    new WorldConfigWriter().write();
    if (worldNames.length > 1) {
      const result: Record<string, unknown> = {};
      for (const worldName of worldNames) {
        result[worldName] = readJson(resolve(worldsDir, worldName, "config.json"));
      }
      console.log(JSON.stringify(result));
      return;
    }
    const [worldName] = worldNames;
    const output = readJson(resolve(worldsDir, worldName, "config.json"));
    console.log(JSON.stringify(output));
    return;
  }

  console.error(`Unknown WRITER_KIND=${writerKind}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
