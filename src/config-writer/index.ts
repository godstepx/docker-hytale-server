import { logInfo } from "../log-utils.ts";
import { ServerConfigWriter } from "./server-config-writer.ts";
import { WhitelistJsonWriter } from "./whitelist-writer.ts";
import { WorldConfigWriter } from "./world-config-writer.ts";

export async function writeConfigFiles(): Promise<void> {
  logInfo("Checking config files...");

  new ServerConfigWriter().write();
  new WhitelistJsonWriter().write();
  new WorldConfigWriter().write();
}
