export function buildCleanEnv(overrides: Record<string, string>): Record<string, string> {
  const keepKeys = [
    "HOME",
    "PATH",
    "TMPDIR",
    "TEMP",
    "TMP",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "BUN_INSTALL",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
  ];

  const base: Record<string, string> = {};
  for (const key of keepKeys) {
    const value = process.env[key];
    if (value) {
      base[key] = value;
    }
  }

  return { ...base, ...overrides };
}
