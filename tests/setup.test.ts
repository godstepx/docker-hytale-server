import { describe, test, expect } from "bun:test";
import { runJsonRunner } from "./helpers/run-json-runner.ts";

describe("setup java args", () => {
  test("buildJavaArgs includes env flags", async () => {
    const output = await runJsonRunner("tests/helpers/setup-runner.ts", {
      SETUP_ACTION: "java-args",
      JAVA_XMS: "1G",
      JAVA_XMX: "2G",
      JAVA_OPTS: "-Dfoo=bar -Dquoted='hello world' -Ddouble=\"x y\"",
      JVM_GC: "zgc",
      JAVA_DEBUG: "true",
      ENABLE_JVM_TUNING: "true",
      BIND_ADDRESS: "127.0.0.1",
      SERVER_PORT: "5521",
      AUTH_MODE: "offline",
      DISABLE_SENTRY: "true",
      ALLOW_OP: "true",
      ENABLE_BACKUPS: "true",
      BACKUP_DIR: "/data/backups",
      BACKUP_FREQUENCY: "15",
      BACKUP_MAX_COUNT: "3",
      TRANSPORT_TYPE: "TCP",
      BOOT_COMMANDS: "say one, say two",
      ADDITIONAL_MODS_DIR: "/data/mods-extra",
      ADDITIONAL_PLUGINS_DIR: "/data/plugins-extra",
      SERVER_LOG_LEVEL: "root=DEBUG",
    });

    expect(output).toMatchSnapshot();
  });
});
