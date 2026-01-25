import { buildCleanEnv } from "./clean-env.ts";

export async function runJsonRunner(
  scriptPath: string,
  env: Record<string, string>
): Promise<unknown> {
  const proc = Bun.spawn([
    process.execPath,
    "run",
    scriptPath,
  ], {
    stdout: "pipe",
    stderr: "pipe",
    env: buildCleanEnv(env),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (process.env.DISABLE_JSON_RUNNER_LOGS !== "true") {
    if (stdout.trim()) {
      console.log(`[runJsonRunner stdout] ${stdout.trim()}`);
    }
    if (stderr.trim()) {
      console.log(`[runJsonRunner stderr] ${stderr.trim()}`);
    }
  }

  if (exitCode !== 0) {
    throw new Error(stderr || stdout);
  }

  return JSON.parse(stdout.trim());
}
