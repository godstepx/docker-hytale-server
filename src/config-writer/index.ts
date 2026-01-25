import { logInfo } from "../log-utils.ts";
import { ServerConfigWriter } from "./server-writer.ts";
import { WhitelistJsonWriter } from "./whitelist-writer.ts";
import { WorldConfigWriter } from "./world-writer.ts";

export async function writeConfigFiles(): Promise<void> {
  logInfo("Checking config files...");

  new ServerConfigWriter().write();
  new WhitelistJsonWriter().write();
  new WorldConfigWriter().write();
}
