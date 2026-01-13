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
- Version tracking: `/data/.version` JSON with source, patchline, timestamp.
- Auth caches:
  - Downloader CLI tokens in `/data/.auth`.
  - CLI binaries in `/data/.hytale-cli`.
- AOT cache support: `/data/server/HytaleServer.aot` used if present.
- Health checks:
  - `scripts/healthcheck.sh` checks Java process and UDP port 5520.
- Logs: `/data/logs` (PID file: `/data/server.pid`).

## Repository Layout
- `Dockerfile`: multi-stage build (Bun compilation + production), env defaults, healthcheck, non-root user.
- `Justfile`: development task runner (build, test, lint, format, etc.).
- `src/entrypoint.ts`: main boot flow (download -> start server) - compiled to binary.
- `src/download.ts`: download/copy server files + version tracking - compiled to binary.
- `src/generate-config.ts`: JSON config generation from env (template-based) - compiled to binary.
- `src/healthcheck.ts`: health checks for Docker - compiled to binary.
- `src/log-utils.ts`: logging module (imported by other TypeScript modules).
- `templates/server-config.template.json`: base config template.
- `package.json`: Bun project manifest with build scripts.
- `tsconfig.json`: TypeScript compiler configuration.
- `README.md`: user-facing usage instructions and env vars.
- `tests/test-integration.sh`: integration tests for Docker container.

## Container Runtime Flow
1. Entrypoint binary (`/opt/hytale/bin/entrypoint`) sets up `/data` and `/data/server`.
2. Download binary (`/opt/hytale/bin/download`) ensures server files are present (by mode).
3. (Optional) config generation via generate-config binary (currently commented out).
4. Java starts `HytaleServer.jar` with assets and args.
5. SIGTERM -> graceful shutdown (30s timeout); SIGKILL if needed.

**Technical Implementation:**
- All scripts are TypeScript compiled to standalone Bun binaries during Docker build.
- Binaries are self-contained (no Node.js/Bun runtime needed in production image).
- Uses Bun's built-in APIs: `fetch()` for HTTP, native JSON parsing, `fflate` for unzipping.
- Process management via `Bun.spawn()` for better control and error handling.

## Environment Variables (Key)
- Download: `DOWNLOAD_MODE`, `HYTALE_CLI_URL`, `LAUNCHER_PATH`,
  `HYTALE_PATCHLINE`, `FORCE_DOWNLOAD`, `CHECK_UPDATES`.
- Java: `JAVA_XMS`, `JAVA_XMX`, `JAVA_OPTS`.
- Server: `SERVER_PORT`, `BIND_ADDRESS`, `AUTH_MODE`, `DISABLE_SENTRY`,
  `ENABLE_BACKUPS`, `BACKUP_FREQUENCY`, `BACKUP_DIR`.
- Logging: `LOG_LEVEL`.
- Misc: `DRY_RUN`, `TZ`.

## Data Layout (Volume /data)
- `/data/server/`: server binaries (`HytaleServer.jar`, AOT cache).
- `/data/Assets.zip`: game assets.
- `/data/universe/`: world saves.
- `/data/config.json`: server config (optional).
- `/data/.hytale-cli/`: downloader binaries.
- `/data/.auth/`: downloader auth cache.
- `/data/.version`: installed version metadata.
- `/data/logs/`: server logs.

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
- Run locally with Bun: `bun run src/entrypoint.ts`
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
- If you add new assets/templates, place them under `templates/`.
- When adding new TypeScript modules:
  - Import log-utils for consistent logging.
  - Add build script to `package.json` if creating a new binary.
  - Update Dockerfile to copy the new binary.
  - Follow existing patterns for error handling and DRY_RUN mode.

## TODO / Open Areas
- Config generation is currently disabled in `entrypoint.sh`.
- Version comparison is not implemented (only prints latest).

## Editing This File
This file is intended to be updated over time. Replace or refine guidelines,
add project-specific conventions, or remove sections that no longer apply.
