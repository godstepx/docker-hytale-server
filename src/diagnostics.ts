import { accessSync, constants, existsSync, readFileSync } from "fs";
import { JAVA_XMX } from "./config.ts";
import { logInfo, logWarn, logError } from "./log-utils.ts";

function parseMemoryToMiB(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)([kKmMgG])?$/);
  if (!match || !match[1]) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2]?.toLowerCase();
  if (!unit || unit === "m") return amount;
  if (unit === "g") return amount * 1024;
  if (unit === "k") return Math.floor(amount / 1024);
  return null;
}

function getCgroupMemoryLimitMiB(): number | null {
  const v2Path = "/sys/fs/cgroup/memory.max";
  const v1Path = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
  const path = existsSync(v2Path) ? v2Path : existsSync(v1Path) ? v1Path : "";

  if (!path) return null;

  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (raw === "max") return null;
    const bytes = parseInt(raw, 10);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    if (bytes > 9e17) return null;
    return Math.floor(bytes / 1024 / 1024);
  } catch {
    return null;
  }
}

function checkTmpWritable(): void {
  try {
    accessSync("/tmp", constants.W_OK);
  } catch {
    logError("/tmp is not writable");
    throw new Error("/tmp must be writable for Java to run correctly");
  }
}

function checkMemoryLimit(): void {
  const xmxMiB = parseMemoryToMiB(JAVA_XMX);
  const limitMiB = getCgroupMemoryLimitMiB();

  if (limitMiB === null) return;
  if (xmxMiB === null) {
    logWarn("Could not parse JAVA_XMX; skipping cgroup memory check");
    return;
  }

  if (xmxMiB > limitMiB) {
    logWarn(`JAVA_XMX (${xmxMiB} MiB) exceeds container memory limit (${limitMiB} MiB)`);
  }
}

function checkUdpBufferSize(): void {
  const path = "/proc/sys/net/core/rmem_max";
  if (!existsSync(path)) {
    logWarn("Cannot read UDP buffer size from /proc/sys/net/core/rmem_max");
    return;
  }

  try {
    const value = parseInt(readFileSync(path, "utf-8").trim(), 10);
    if (Number.isFinite(value) && value < 2_097_152) {
      logWarn(`UDP receive buffer is low (${value}); QUIC performance may suffer`);
    }
  } catch {
    logWarn("Failed to read UDP buffer size");
  }
}

export function runDiagnostics(): void {
  logInfo("Diagnostics enabled: running basic checks...");
  checkTmpWritable();
  checkMemoryLimit();
  checkUdpBufferSize();
  logInfo("Diagnostics complete");
}
