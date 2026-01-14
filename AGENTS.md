# AGENTS.md

This document orients contributors and AI agents working on this repo. It captures
the key project concepts and default guidelines. Update as needed.

## Project Summary
- Purpose: Docker image for self-hosting Hytale Dedicated Servers with flexible
  server file management (launcher copy, CLI download, or manual).
- Runtime: Alpine Linux with Eclipse Temurin JRE (Java 25 by default).
- Implementation: TypeScript compiled to standalone Bun binaries (no bash/curl/jq/unzip dependencies).
- Entry: `/opt/hytale/bin/entrypoint` inside the container (compiled binary).
- Security: runs as non-root user (UID/GID 1000).
- Data: persistent `/data` volume.
- Image: Published to `ghcr.io/godstepx/docker-hytale-server`
- Dev Tools: `just` for task automation (see Justfile)

## Core Concepts
- Download modes:
  - `manual`: user provides `/data/server` and `/data/Assets.zip`.
  - `launcher`: copy from `LAUNCHER_PATH`.
  - `cli`: official Hytale Downloader CLI + OAuth device flow.
  - `auto`: try launcher, then CLI, else manual instructions.
- Bundled CLI:
  - Pre-downloaded at build time to `/opt/hytale/cli/` (read-only).
  - Eliminates runtime CLI download - only server files require OAuth.
  - Falls back to `/data/.hytale-cli/` if bundled CLI not found.
- Version tracking: `/data/.version` JSON with source, patchline, timestamp.
- Auth caches:
  - Downloader CLI tokens in `/data/.auth` (persisted in volume).
- AOT cache support: `/data/server/HytaleServer.aot` used if present (Java 25+).
- Health checks:
  - `/opt/hytale/bin/healthcheck` binary checks Java process and UDP port 5520.
- Logs: `/data/logs` (PID file: `/data/server.pid`).

## Repository Layout
- `Dockerfile`: multi-stage build (Bun compilation + CLI download + production), env defaults, healthcheck, non-root user.
- `Justfile`: development task runner (build, test, lint, format, etc.).
- `src/setup.ts`: setup script (download -> validate -> write java command) - compiled to binary. Contains documented JVM flags.
- `src/entrypoint.sh`: shell wrapper that runs setup, then execs Java (avoids Bun ARM64 crashes).
- `src/download.ts`: download/copy server files + version tracking - imported by entrypoint.
- `src/config.ts`: centralized configuration with BUNDLED_CLI_DIR and USER_CLI_DIR paths.
- `src/healthcheck.ts`: health checks for Docker - compiled to binary.
- `src/log-utils.ts`: logging module (imported by other TypeScript modules).
- `package.json`: Bun project manifest with build scripts.
- `tsconfig.json`: TypeScript compiler configuration.
- `README.md`: user-facing usage instructions and env vars.
- `tests/test-integration.sh`: integration tests for Docker container.

## Container Runtime Flow
1. Entrypoint binary (`/opt/hytale/bin/entrypoint`) sets up `/data` and `/data/server`.
2. Download module ensures server files are present (by mode: cli, launcher, or manual).
3. Java starts `HytaleServer.jar` with assets and command-line args.
4. SIGTERM -> graceful shutdown (30s timeout); SIGKILL if needed.
5. Hytale manages its own `config.json` files in `/data`.

**Technical Implementation:**
- TypeScript compiled to standalone Bun binaries during Docker build.
- Only 2 binaries: `entrypoint` (includes download module) and `healthcheck`.
- Binaries are self-contained (no Node.js/Bun runtime needed in production image).
- Uses Bun's built-in APIs: `fetch()` for HTTP, native JSON parsing, system `unzip` for extraction.
- Process management via `Bun.spawn()` for external commands (Java, Hytale CLI, system utils).
- Internal modules use standard TypeScript imports (bundled, no process spawning).

## Server Command-Line Flags (Verified)
All flags documented via `java -jar HytaleServer.jar --help`:
- `--assets <Path>`: Asset directory
- `--bind <InetSocketAddress>`: Address to listen on (default: 0.0.0.0:5520)
- `--auth-mode <authenticated|offline>`: Authentication mode (default: authenticated)
- `--backup`: Enable automatic backups
- `--backup-dir <Path>`: Backup directory
- `--backup-frequency <Integer>`: Backup interval in minutes (default: 30)
- `--allow-op`: Allow operator commands
- `--accept-early-plugins`: Acknowledge loading early plugins (unsupported)
- `--disable-sentry`: Disable crash reporting

**Authentication:** Server authentication happens AFTER startup via console command:
```/auth login device```

Reference: https://support.hytale.com/hc/en-us/articles/45326769420827

## JVM Tuning

The entrypoint uses optimized G1GC flags for game server workloads. Key settings:
- G1GC with 200ms max pause target (low-latency focus)
- 30-40% young generation sizing (reduces minor GC frequency)
- 8MB heap regions (balanced for 4-16GB heaps)
- AOT cache support (`-XX:AOTCache`) for faster startup on Java 25+
- Full rationale documented in `src/setup.ts` comments

Based on Aikar's flags (widely used for Minecraft servers), adapted for Hytale.

## Environment Variables (Key)
- Download: `DOWNLOAD_MODE`, `HYTALE_CLI_URL`, `LAUNCHER_PATH`,
  `HYTALE_PATCHLINE`, `FORCE_DOWNLOAD`, `CHECK_UPDATES`.
- Paths: `BUNDLED_CLI_DIR` (default: `/opt/hytale/cli`), `DATA_DIR` (default: `/data`).
- Java: `JAVA_XMS`, `JAVA_XMX`, `JAVA_OPTS`, `ENABLE_AOT_CACHE`.
- Server: `SERVER_PORT`, `BIND_ADDRESS`, `AUTH_MODE`, `DISABLE_SENTRY`,
  `ENABLE_BACKUPS`, `BACKUP_FREQUENCY`, `BACKUP_DIR`, `ACCEPT_EARLY_PLUGINS`, `ALLOW_OP`.
- Logging: `CONTAINER_LOG_LEVEL`.
- Misc: `DRY_RUN`, `TZ`.

## Data Layout

### Image paths (read-only)
- `/opt/hytale/bin/`: compiled entrypoint and healthcheck binaries.
- `/opt/hytale/cli/`: **bundled Hytale Downloader CLI** (pre-downloaded at build time).

### Volume /data (persistent, writable)
- `/data/server/`: server binaries (`HytaleServer.jar`, AOT cache).
- `/data/Assets.zip`: game assets.
- `/data/universe/`: world saves.
- `/data/config.json`: server config (managed by Hytale).
- `/data/.auth/`: downloader auth cache (OAuth tokens).
- `/data/.hytale-cli/`: fallback CLI location (backward compatibility, rarely used).
- `/data/.version`: installed version metadata.
- `/data/logs/`: server logs.
- `/data/backups/`: automatic backups (if enabled).

## Testing / Validation
- This repo uses `just` as a task runner for common development tasks.
- Suggested manual checks:
  - Install dependencies: `just install` (or `bun install`)
  - Type check: `just lint-ts`
  - Build: `just build` (compiles TypeScript in Docker)
  - Run (dry): `just run`
  - Run all tests: `just test` (TypeScript + integration)
  - Lint: `just lint` (TypeScript + Dockerfile)
  - Healthcheck: run container and verify `HEALTHY`.
  
### Development Workflow
- Source code is in `src/` directory (TypeScript).
- Run locally with Bun: `bun run src/setup.ts`
- Build binaries locally: `bun run build` (creates `dist/` directory).
- Docker build uses multi-stage process to compile binaries.

## Guidelines for Changes (Baseline)
- Prefer small, focused edits; update README if behavior changes.
- Write TypeScript with strict type checking enabled.
- Use Bun APIs where possible (fetch, file I/O, process spawning).
- Preserve non-root runtime and data permissions.
- Avoid breaking env var compatibility; document new vars.
- Use `/data` for persistent state; avoid writing elsewhere.
- Favor `download.ts` for new download flows (do not bake server files).
- Keep log output consistent via `log-utils.ts` module.
- Run `bun run format` before committing to ensure consistent code style.

## Agent-Specific Notes
- When changing runtime behavior, update:
  - `README.md` for user-facing docs.
  - `Dockerfile` env defaults if new vars are added.
  - `src/` TypeScript modules if flow changes.
- When adding new TypeScript modules:
  - Import log-utils for consistent logging.
  - Add build script to `package.json` if creating a new binary.
  - Update Dockerfile to copy the new binary.
  - Follow existing patterns for error handling and DRY_RUN mode.

## TODO / Open Areas
- Version comparison is not implemented (only prints latest available version).

## Editing This File
This file is intended to be updated over time. Replace or refine guidelines,
add project-specific conventions, or remove sections that no longer apply.
