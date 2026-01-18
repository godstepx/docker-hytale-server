# AGENTS.md

This document orients contributors and AI agents working on this repo. It captures
the key project concepts and default guidelines. Update as needed.

## Project Summary
- Purpose: Docker image for self-hosting Hytale Dedicated Servers with flexible
  server file management (launcher copy, CLI download, or manual).
- Runtime: Alpine Linux with Eclipse Temurin JRE (Java 25 by default).
- Implementation: TypeScript compiled to standalone Bun binaries (no bash/curl/jq; uses system unzip).
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
- Read-only JAR: copied to `/usr/local/lib/hytale/HytaleServer.jar` at startup (mode 444).
- Machine ID: uses `/etc/machine-id` when present; otherwise persists `/data/.machine-id`.

## Repository Layout
- `Dockerfile`: multi-stage build (Bun compilation + CLI download + production), env defaults, healthcheck, non-root user.
- `Justfile`: development task runner (build, test, lint, format, etc.).
- `src/entrypoint.ts`: main entrypoint - downloads files, writes configs, acquires tokens, starts Java, handles signals. Compiled to binary.
- `src/setup.ts`: setup utilities - Java args building, file validation. Imported by entrypoint.
- `src/config-writer.ts`: config.json and whitelist.json generation from env vars. Imported by entrypoint.
- `src/token-manager.ts`: OAuth2 device flow, token refresh, session creation. Imported by entrypoint (not a standalone binary).
- `src/download.ts`: download/copy server files + version tracking - imported by entrypoint.
- `src/mod-installer/`: mod installer providers and state (CurseForge today) - imported by entrypoint.
- `src/config.ts`: centralized configuration with all env var defaults.
- `src/healthcheck.ts`: health checks for Docker - compiled to binary.
- `src/log-utils.ts`: logging module (imported by other TypeScript modules).
- `package.json`: Bun project manifest with build scripts.
- `tsconfig.json`: TypeScript compiler configuration.
- `README.md`: user-facing usage instructions and env vars.
- `tests/test-integration.sh`: integration tests for Docker container.

## Container Runtime Flow
1. Entrypoint binary (`/opt/hytale/bin/entrypoint`) sets up `/data` directories.
2. Config writer generates `config.json` and `whitelist.json` from env vars (if needed).
3. Download module ensures server files are present (by mode: cli, launcher, or manual).
4. Token manager acquires OAuth tokens and creates game session (or uses env vars).
5. Java starts `HytaleServer.jar` with assets, auth tokens, and command-line args.
6. Background OAuth refresh loop keeps tokens alive for indefinite runs (30+ days).
7. SIGTERM -> graceful shutdown (30s timeout); SIGKILL if needed.

**Technical Implementation:**
- TypeScript compiled to standalone Bun binaries during Docker build.
- 2 binaries: `entrypoint` (includes token-manager module) and `healthcheck`.
- Binaries are self-contained (no Node.js/Bun runtime needed in production image).
- Uses Bun's built-in APIs: `fetch()` for HTTP, native JSON parsing, system `unzip` for extraction.
- Process management via `Bun.spawn()` for external commands (Java, Hytale CLI, system utils).
- Internal modules use standard TypeScript imports (bundled, no process spawning).
- OAuth tokens stored in `/data/.auth/.oauth-tokens.json` for persistence across restarts.
- Hytale server handles game session refresh internally when given `--session-token`.

## Server Command-Line Flags (Verified)
All flags documented via `java -jar HytaleServer.jar --help`:
- `--assets <Path>`: Asset directory
- `--bind <InetSocketAddress>`: Address to listen on (default: 0.0.0.0:5520)
- `--auth-mode <authenticated|offline|insecure>`: Authentication mode (default: authenticated)
- `--session-token <token>`: Pre-configured session token (JWT)
- `--identity-token <token>`: Pre-configured identity token (JWT)
- `--owner-uuid <uuid>`: Profile UUID for session
- `--backup`: Enable automatic backups
- `--backup-dir <Path>`: Backup directory
- `--backup-frequency <Integer>`: Backup interval in minutes (default: 30)
- `--backup-max-count <Integer>`: Maximum number of backups to keep (default: 5)
- `--allow-op`: Allow operator commands
- `--accept-early-plugins`: Acknowledge loading early plugins (unsupported)
- `--early-plugins <Path>`: Additional early plugin directories
- `--disable-sentry`: Disable crash reporting
- `--transport <TransportType>`: Transport protocol (default: QUIC)
- `--boot-command <String>`: Run command on boot (can be specified multiple times)
- `--mods <Path>`: Additional mods directories
- `--log <KeyValueHolder>`: Set logger level (e.g., root=DEBUG)
- `--owner-name <String>`: Display name for server owner

**Authentication:** Server can authenticate in two ways:
1. Pre-startup via OAuth tokens passed with `--session-token` and `--identity-token` (used by this image)
2. Post-startup via console command: `/auth login device`

The server auto-refreshes game session tokens when started with `--session-token`.

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
- Paths: `DATA_DIR` (default: `/data`).
- Java: `JAVA_XMS`, `JAVA_XMX`, `JAVA_OPTS`, `ENABLE_AOT_CACHE`, `ENABLE_JVM_TUNING`, `JVM_GC` (`g1`, `g1-extended`, `zgc`, `shenandoah`).
  - `shenandoah` requires `-XX:+UnlockExperimentalVMOptions` and may not be available in all Temurin builds.
- Server: `SERVER_PORT`, `BIND_ADDRESS`, `AUTH_MODE`, `DISABLE_SENTRY`,
  `ENABLE_BACKUPS`, `BACKUP_FREQUENCY`, `BACKUP_DIR`, `BACKUP_MAX_COUNT`, `ACCEPT_EARLY_PLUGINS`, `ALLOW_OP`.
- Config generation: `HYTALE_CONFIG_JSON`, `SERVER_NAME`, `SERVER_MOTD`, `SERVER_PASSWORD`,
  `MAX_PLAYERS`, `MAX_VIEW_RADIUS`, `LOCAL_COMPRESSION_ENABLED`, `DEFAULT_WORLD`,
  `DEFAULT_GAME_MODE`, `DISPLAY_TMP_TAGS_IN_STRINGS`, `PLAYER_STORAGE_TYPE`.
- Whitelist: `WHITELIST_ENABLED`, `WHITELIST_LIST` (comma/newline-separated), `WHITELIST_JSON`.
- Advanced: `TRANSPORT_TYPE`, `BOOT_COMMANDS`, `ADDITIONAL_MODS_DIR`, `ADDITIONAL_PLUGINS_DIR`,
  `SERVER_LOG_LEVEL`, `HYTALE_OWNER_NAME`,
  `BARE_MODE`, `CLIENT_PID`, `DISABLE_ASSET_COMPARE`, `DISABLE_CPB_BUILD`, `DISABLE_FILE_WATCHER`,
  `EVENT_DEBUG`, `FORCE_NETWORK_FLUSH`, `GENERATE_SCHEMA`, `MIGRATE_WORLDS`, `MIGRATIONS`,
  `PREFAB_CACHE`, `SHUTDOWN_AFTER_VALIDATE`, `SINGLEPLAYER`, `UNIVERSE_PATH`, `VALIDATE_ASSETS`,
  `VALIDATE_PREFABS`, `VALIDATE_WORLD_GEN`, `SHOW_VERSION`, `WORLD_GEN`.
- Mods (CurseForge): `MOD_INSTALL_MODE`, `CURSEFORGE_MODS_DIR`, `CURSEFORGE_MOD_LIST`,
  `CURSEFORGE_API_KEY`, `CURSEFORGE_GAME_VERSION`.
- Auth tokens (for hosting providers): `HYTALE_SERVER_SESSION_TOKEN`, `HYTALE_SERVER_IDENTITY_TOKEN`, `HYTALE_OWNER_UUID`.
- Auth behavior: `AUTO_AUTH_ON_START` (default: true), `OAUTH_REFRESH_CHECK_INTERVAL` (default: 24h), `OAUTH_REFRESH_THRESHOLD_DAYS` (default: 7).
- Logging: `CONTAINER_LOG_LEVEL`, `LOG_RETENTION_DAYS` (default: 7, deletes old server logs), `NO_COLOR`.
- Misc: `DRY_RUN`.

## Data Layout

### Image paths (read-only)
- `/opt/hytale/bin/`: compiled binaries (entrypoint, healthcheck).
- `/opt/hytale/cli/`: **bundled Hytale Downloader CLI** (pre-downloaded at build time).
- `/usr/local/lib/hytale/`: read-only server JAR copy.

### Volume /data (persistent, writable)
- `/data/server/`: server binaries (`HytaleServer.jar`, AOT cache).
- `/data/Assets.zip`: game assets.
- `/data/universe/`: world saves.
- `/data/config.json`: server config (auto-generated from env vars or managed by Hytale).
- `/data/whitelist.json`: whitelist config (auto-generated from env vars).
- `/data/curseforge-mods/`: CurseForge mods directory (auto-installed mods).
- `/data/mods/`: default mods directory (user-managed).
- `/data/.auth/`: OAuth token storage for persistent authentication.
  - `.oauth-tokens.json`: OAuth access/refresh tokens (30-day refresh token TTL).
- `/data/.hytale-cli/`: fallback CLI location (backward compatibility, rarely used).
- `/data/.version`: installed version metadata.
- `/data/.mods-state.json`: mod installer state (auto-managed).
- `/data/.machine-id`: persistent machine-id used when host ID is not mounted.
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
- Run locally with Bun:
  - `bun run src/entrypoint.ts` - main entry point
  - `bun run src/healthcheck.ts` - health check script
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

## Editing This File
This file is intended to be updated over time. Replace or refine guidelines,
add project-specific conventions, or remove sections that no longer apply.
