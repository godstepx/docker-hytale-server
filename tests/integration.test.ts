import { describe, test, expect } from "bun:test";
import { mkdirSync, copyFileSync, rmSync, existsSync, chmodSync } from "fs";
import { resolve } from "path";

const TEST_IMAGE = process.env.HYTALE_TEST_IMAGE || "docker-hytale-server:test";
const DEFAULT_TEST_DATA_DIR = resolve(process.cwd(), "hytale-data");
const DEFAULT_SERVER_JAR = resolve(DEFAULT_TEST_DATA_DIR, "server", "HytaleServer.jar");
const DEFAULT_ASSETS_ZIP = resolve(DEFAULT_TEST_DATA_DIR, "Assets.zip");
const SERVER_JAR = process.env.HYTALE_TEST_SERVER_JAR || DEFAULT_SERVER_JAR;
const ASSETS_ZIP = process.env.HYTALE_TEST_ASSETS_ZIP || DEFAULT_ASSETS_ZIP;
const RUN_DOCKER_TESTS = process.env.RUN_DOCKER_TESTS === "true";

async function runDockerAsync(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode: exitCode ?? 1,
  };
}

async function buildImage(): Promise<void> {
  const result = await runDockerAsync(["build", "-t", TEST_IMAGE, "."]);
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed: ${result.stderr || result.stdout}`);
  }
}

function createDataDir(withFiles: boolean): string {
  const dataDir = resolve(
    process.cwd(),
    "integration-data",
    `hytale-it-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const serverDir = resolve(dataDir, "server");
  mkdirSync(serverDir, { recursive: true });
  chmodSync(dataDir, 0o755);
  chmodSync(serverDir, 0o755);
  if (withFiles) {
    if (!existsSync(SERVER_JAR)) {
      throw new Error(`Server jar not found at ${SERVER_JAR}`);
    }
    if (!existsSync(ASSETS_ZIP)) {
      throw new Error(`Assets zip not found at ${ASSETS_ZIP}`);
    }
    const targetJar = resolve(serverDir, "HytaleServer.jar");
    const targetAssets = resolve(dataDir, "Assets.zip");
    copyFileSync(SERVER_JAR, targetJar);
    copyFileSync(ASSETS_ZIP, targetAssets);
    chmodSync(targetJar, 0o644);
    chmodSync(targetAssets, 0o644);
  }
  return dataDir;
}


async function waitForLog(containerName: string, pattern: RegExp, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await runDockerAsync(["logs", containerName]);
    if (pattern.test(`${result.stdout}\n${result.stderr}`)) {
      return true;
    }
    await Bun.sleep(500);
  }
  return false;
}

async function stopContainer(containerName: string): Promise<void> {
  await runDockerAsync(["rm", "-f", containerName]);
}

async function getContainerLogs(containerName: string): Promise<string> {
  const result = await runDockerAsync(["logs", containerName]);
  return `${result.stdout}\n${result.stderr}`.trim();
}

let buildPromise: Promise<void> | null = null;

async function ensureImageBuilt(): Promise<void> {
  if (!RUN_DOCKER_TESTS) return;
  if (!buildPromise) {
    buildPromise = buildImage();
  }
  await buildPromise;
}

const dockerDescribe = RUN_DOCKER_TESTS ? describe : describe.skip;

dockerDescribe("docker integration", () => {
  test("cli mode (dry run)", async () => {
    await ensureImageBuilt();
    const dataDir = createDataDir(false);

    const result = await runDockerAsync([
      "run",
      "--rm",
      "-v",
      `${dataDir}:/data`,
      "-e",
      "DRY_RUN=true",
      "-e",
      "DOWNLOAD_MODE=cli",
      TEST_IMAGE,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(`docker run failed: ${result.stderr || result.stdout}`);
    }
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output.includes("[DRY_RUN] Would obtain Hytale server files")).toBeTrue();
    expect(output.includes("[DRY_RUN] Would run: java")).toBeTrue();

    rmSync(dataDir, { recursive: true, force: true });
  }, { timeout: 30000 });

  test("manual mode (uses local files)", async () => {
    await ensureImageBuilt();
    const dataDir = createDataDir(true);
    const containerName = `hytale-it-manual-${Date.now()}`;

    try {
      const runResult = await runDockerAsync([
        "run",
        "-d",
        "--name",
        containerName,
        "-v",
        `${dataDir}:/data`,
        "-e",
        "DOWNLOAD_MODE=manual",
        "-e",
        "AUTH_MODE=offline",
        "-e",
        "AUTO_AUTH_ON_START=false",
        TEST_IMAGE,
      ]);

      if (runResult.exitCode !== 0) {
        throw new Error(`container failed to start: ${runResult.stderr || runResult.stdout}`);
      }

      const started = await waitForLog(containerName, /Hytale Server Booted!/, 120000);
      if (!started) {
        const logs = await getContainerLogs(containerName);
        throw new Error(`Server did not boot in time. Logs:\n${logs}`);
      }
    } finally {
      await stopContainer(containerName);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, { timeout: 150000 });
});
