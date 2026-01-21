import { DOWNLOAD_INITIAL_BACKOFF } from "./config.ts";

export function parseBoolEnvValue(value: string, envKey: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  console.warn(`[WARN] Invalid boolean for ${envKey}: ${value}`);
  return null;
}

export function parseNumberEnvValue(value: string, envKey: string): number | null {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  console.warn(`[WARN] Invalid number for ${envKey}: ${value}`);
  return null;
}

export function calculateBackoff(attempt: number, initialBackoff?: number): number {
  const baseBackoff = (initialBackoff ?? DOWNLOAD_INITIAL_BACKOFF) * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 5);
  return baseBackoff + jitter;
}
