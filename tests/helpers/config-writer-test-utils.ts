import { readFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { expect } from "bun:test";
import { buildCleanEnv } from "./clean-env.ts";

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = sortValue(entryValue);
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

export function expectSnapshot(value: unknown): void {
  expect(stableStringify(value)).toMatchSnapshot();
}

export async function runOverrideWriter(env: Record<string, string>): Promise<unknown> {
  const dataDir = resolve(tmpdir(), `hytale-config-override-${Date.now()}`);
  const proc = Bun.spawn([
    process.execPath,
    "run",
    "tests/helpers/config-writer-runner.ts",
  ], {
    stdout: "pipe",
    stderr: "pipe",
    env: buildCleanEnv({
      TEST_DATA_DIR: dataDir,
      ...env,
    }),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  rmSync(dataDir, { recursive: true, force: true });

  if (exitCode !== 0) {
    throw new Error(stderr || stdout);
  }

  return JSON.parse(stdout.trim());
}

export async function runConfigWriter(env: Record<string, string>): Promise<unknown> {
  const dataDir = resolve(tmpdir(), `hytale-config-${Date.now()}`);
  const proc = Bun.spawn([
    process.execPath,
    "run",
    "tests/helpers/config-writer-runner.ts",
  ], {
    stdout: "pipe",
    stderr: "pipe",
    env: buildCleanEnv({
      TEST_DATA_DIR: dataDir,
      ...env,
    }),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  rmSync(dataDir, { recursive: true, force: true });

  if (exitCode !== 0) {
    throw new Error(stderr || stdout);
  }

  return JSON.parse(stdout.trim());
}
