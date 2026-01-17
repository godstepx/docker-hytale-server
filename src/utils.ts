import { DOWNLOAD_INITIAL_BACKOFF } from "./config.ts";

export function calculateBackoff(attempt: number, initialBackoff?: number): number {
  const baseBackoff = (initialBackoff ?? DOWNLOAD_INITIAL_BACKOFF) * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 5);
  return baseBackoff + jitter;
}
