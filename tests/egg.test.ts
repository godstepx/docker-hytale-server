import { readFileSync } from "fs";
import { join } from "path";
import { expect, test } from "bun:test";

const eggPath = join(import.meta.dir, "..", "pterodactyl", "egg-hytale-docker.json");
const egg = JSON.parse(readFileSync(eggPath, "utf-8"));

test("egg meta and name", () => {
  expect(egg.meta.version).toBe("PTDL_v2");
  expect(egg.name).toContain("Hytale");
});

test("docker image configured", () => {
  expect(egg.docker_images["ghcr.io/godstepx/docker-hytale-server:latest"]).toBeDefined();
});

test("startup command", () => {
  expect(egg.startup).toBe("/opt/hytale/bin/entrypoint");
  const startupConfig = JSON.parse(egg.config.startup);
  expect(startupConfig.done).toBe("Server files ready!");
});

test("required variables present", () => {
  const getVar = (key: string) => egg.variables.find((v: any) => v.env_variable === key);
  expect(getVar("SERVER_PORT")?.default_value).toBe("5520");
  expect(getVar("DATA_DIR")?.default_value).toBe("/home/container");
  expect(getVar("DOWNLOAD_MODE")?.default_value).toBe("cli");
});
