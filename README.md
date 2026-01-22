# Hytale Server Docker Image

<p align="center"><img src="assets/hybuild.png" alt="Hybuild" width="320"></p>

[![GitHub stars](https://img.shields.io/github/stars/godstepx/docker-hytale-server?style=for-the-badge&logo=github&logoColor=white)](https://github.com/godstepx/docker-hytale-server)
[![GitHub last commit](https://img.shields.io/github/last-commit/godstepx/docker-hytale-server?style=for-the-badge&logo=git&logoColor=white)](https://github.com/godstepx/docker-hytale-server)
[![License](https://img.shields.io/github/license/godstepx/docker-hytale-server?style=for-the-badge&logo=github&logoColor=white)](https://github.com/godstepx/docker-hytale-server/blob/main/LICENSE)

🐳 Docker image for self-hosting Hytale Dedicated Servers with account login (OAuth), flexible download modes, and easy configuration.

> [!TIP]
> **New to Hytale hosting?** Use our web-based config generator: [setuphytale.com](https://setuphytale.com)

## Quick Start

### 1. Create `docker-compose.yml`

```yaml
services:
  hytale:
    image: ghcr.io/godstepx/docker-hytale-server:latest
    container_name: hytale-server
    restart: unless-stopped
    ports:
      - "5520:5520/udp"
    volumes:
      - ./data:/data
      # Optional (Linux): mount host machine-id to avoid startup UUID warnings
      - /etc/machine-id:/etc/machine-id:ro
    environment:
      JAVA_XMX: "4G"
      JAVA_XMS: "1G"
      # Optional: enable JDWP debug on port 5005
      # JAVA_DEBUG: "true"
    # Required for interactive auth prompts and CLI progress output
    stdin_open: true
    tty: true
```

### 2. First Start (Authentication Required)

> [!IMPORTANT]
> On first launch, you must authenticate with a Hytale account that has a purchased copy of the game.

```bash
# Start and watch the logs
docker compose up
```

You will see an **authentication URL** in the logs:
```
Please visit the following URL to authenticate:
https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=XXXXXXXX
```

**Open this URL in your browser** and log in with your Hytale account. The server will continue automatically.
You'll be prompted in the console to log in. This usually happens after the server files are downloaded (often on the second run).

### 3. Run in Background

After successful authentication, stop with `Ctrl+C` and restart in background:

```bash
docker compose up -d
```

### 4. View Logs

```bash
docker logs -f hytale-server
```

---

## Features

- **Account Login** (OAuth) - Browser-based auth on first run with token persistence
- **Flexible Downloads** - `auto`, `cli`, `launcher`, or `manual` modes
- **Bundled CLI** - Pre-bundled Hytale Downloader CLI in the image
- **Config Generation** - `config.json` and `whitelist.json` from env vars
- **CurseForge Mods** - Optional auto-install with cache support
- **Graceful Shutdown** - Handles `SIGTERM` and shuts down cleanly
- **Health Checks** - Built-in container health check

---

## 🛠️ Development & Building

If you want to build the image yourself:

```bash
# Build with pre-bundled CLI
just build

# Or manually:
docker build -t ghcr.io/your-user/docker-hytale-server:latest .
docker push ghcr.io/your-user/docker-hytale-server:latest
```

---

## 🚀 Easy Setup with setuphytale.com

Instead of writing YAML by hand, use [setuphytale.com](https://setuphytale.com) to generate configurations:

- ✨ **5-step wizard** for server configuration
- 📊 **Performance presets** (Basic, Large, High Performance)
- ✅ **Real-time validation**
- 📦 **Download ready-to-run ZIP**

Visit **[setuphytale.com](https://setuphytale.com)** to get started.

---

## Alternative Setup Methods

### Option A: Mounting Launcher Files (Offline Setup)
If you already have Hytale installed, you can skip the download by mounting your launcher files:

```bash
docker run -d \
  -v "/path/to/Hytale/install/release/package/game/latest:/launcher:ro" \
  -e LAUNCHER_PATH=/launcher \
  -v hytale-data:/data \
  -p 5520:5520/udp \
  ghcr.io/godstepx/docker-hytale-server:latest
```

### Option B: Direct Docker Run
```bash
docker run -d \
  --name hytale-server \
  -v hytale-data:/data \
  -p 5520:5520/udp \
  ghcr.io/godstepx/docker-hytale-server:latest
```

---

## Advanced Features

### Automatic Authentication
The server detects existing tokens and only starts login when needed. Sessions are persisted in the `/data` volume (OAuth).

### Graceful Shutdown
The image handles `SIGTERM` to save world data before exiting.

### Diagnostics Mode
Set `DIAGNOSTICS=true` to run basic startup checks for port validity, `/tmp` writability, cgroup memory limit vs `JAVA_XMX`, and UDP buffer size. If `/tmp` is not writable, startup will fail.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| **Download Options** |||
| `DOWNLOAD_MODE` | `auto` | `auto`, `cli`, `launcher`, or `manual` |
| `HYTALE_CLI_URL` | `https://downloader.hytale.com/hytale-downloader.zip` | URL to Hytale Downloader CLI |
| `LAUNCHER_PATH` | - | Path to mounted launcher directory (skips download) |
| `HYTALE_PATCHLINE` | `release` | `release` or `pre-release` |
| `FORCE_DOWNLOAD` | `false` | Force re-download even if files exist |
| `CHECK_UPDATES` | `true` | Check for updates on startup (auto-downloads newer versions in CLI mode (or auto if CLI is the detected mode)) |
| `SKIP_CLI_UPDATE_CHECK` | `false` | Skip CLI self-update/version check |
| `DOWNLOAD_MAX_RETRIES` | `5` | Max retry attempts for CLI download |
| `DOWNLOAD_INITIAL_BACKOFF` | `2` | Initial backoff seconds between retries |
| **Java Options** |||
| `JAVA_XMS` | `1G` | Initial heap size |
| `JAVA_XMX` | `4G` | Maximum heap size |
| `JAVA_OPTS` | - | Additional JVM options (space-separated) |
| `JAVA_DEBUG` | `false` | Enable JDWP debug on port 5005 |
| `ENABLE_AOT_CACHE` | `true` | Use AOT cache for faster startup (Java 25+) |
| `ENABLE_JVM_TUNING` | `true` | Enable built-in G1GC tuning flags |
| `JVM_GC` | `g1` | GC preset: `g1` (default), `g1-extended`, `zgc`, or `shenandoah` (may fail if unsupported by the JRE build) |
| **Server Options** |||
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `BIND_ADDRESS` | `0.0.0.0` | Address to bind the server to |
| `AUTH_MODE` | `authenticated` | `authenticated`, `offline`, or `insecure` |
| `ENABLE_BACKUPS` | `false` | Enable automatic backups |
| `BACKUP_FREQUENCY` | `30` | Backup interval (minutes) |
| `BACKUP_DIR` | `/data/backups` | Backup directory |
| `BACKUP_MAX_COUNT` | `5` | Maximum number of backups to keep |
| `DISABLE_SENTRY` | `false` | Disable crash reporting |
| `ACCEPT_EARLY_PLUGINS` | `false` | Enable early plugins (unsupported, may cause stability issues) |
| `ALLOW_OP` | `false` | Allow operator commands |
| **Server Configuration (config.json)** |||
| `SERVER_NAME` | `Hytale Server` | Server name displayed in browser |
| `SERVER_MOTD` | - | Message of the day |
| `SERVER_PASSWORD` | - | Server password (empty = no password) |
| `MAX_PLAYERS` | `100` | Maximum player count |
| `MAX_VIEW_RADIUS` | `32` | Maximum view distance |
| `LOCAL_COMPRESSION_ENABLED` | `false` | Enable local compression |
| `DEFAULT_WORLD` | `default` | Default world name |
| `DEFAULT_GAME_MODE` | `Adventure` | Default game mode (`Adventure`, `Creative`) |
| `DISPLAY_TMP_TAGS_IN_STRINGS` | `false` | Display temporary tags in strings |
| `PLAYER_STORAGE_TYPE` | `Hytale` | Player storage type |
| `HYTALE_CONFIG_JSON` | - | Full JSON override for config.json |
| `WORLD_CONFIG_JSON_<WORLD_NAME>` | - | Full JSON override for a world config (suffix is lowercased to `/data/universe/worlds/<world>/config.json`) |
| `WORLD_<WORLD_NAME>_<SETTING>` | - | Per-world config setting (see World Configuration) |
| **Whitelist Configuration** |||
| `WHITELIST_ENABLED` | `false` | Enable whitelist |
| `WHITELIST_LIST` | - | Comma/newline-separated list of player UUIDs |
| `WHITELIST_JSON` | - | Full JSON override for whitelist.json |
| **Advanced Options** |||
| `TRANSPORT_TYPE` | - | Transport protocol (e.g., `QUIC`, `TCP`) |
| `BOOT_COMMANDS` | - | Commands to run on boot (comma-separated) |
| `ADDITIONAL_MODS_DIR` | - | Additional mods directory path |
| `ADDITIONAL_PLUGINS_DIR` | - | Additional early plugins directory path |
| `SERVER_LOG_LEVEL` | - | Server log level (e.g., `root=DEBUG`) |
| `BARE_MODE` | `false` | Start in bare mode |
| `CLIENT_PID` | - | Client PID |
| `DISABLE_ASSET_COMPARE` | `false` | Disable asset compare |
| `DISABLE_CPB_BUILD` | `false` | Disable CPB build |
| `DISABLE_FILE_WATCHER` | `false` | Disable file watcher |
| `EVENT_DEBUG` | `false` | Enable event debug |
| `FORCE_NETWORK_FLUSH` | - | Force network flush setting |
| `GENERATE_SCHEMA` | `false` | Generate schema on startup |
| `MIGRATE_WORLDS` | - | Migrate worlds path |
| `MIGRATIONS` | - | Migrations path |
| `PREFAB_CACHE` | - | Prefab cache path |
| `SHUTDOWN_AFTER_VALIDATE` | `false` | Shutdown after validate |
| `SINGLEPLAYER` | `false` | Start in singleplayer mode |
| `UNIVERSE_PATH` | - | Universe path |
| `VALIDATE_ASSETS` | `false` | Validate assets |
| `VALIDATE_PREFABS` | - | Validate prefabs path |
| `VALIDATE_WORLD_GEN` | `false` | Validate world gen |
| `SHOW_VERSION` | `false` | Print version and exit |
| `WORLD_GEN` | - | World gen path |
| **Mod Installation (CurseForge)** |||
| `MOD_INSTALL_MODE` | `off` | `off` or `curseforge` |
| `CURSEFORGE_MOD_LIST` | - | Comma/newline-separated CurseForge mod IDs (`12345` or `12345:67890`) |
| `CURSEFORGE_API_KEY` | - | CurseForge API key (required when `MOD_INSTALL_MODE=curseforge`) |
| `CURSEFORGE_GAME_VERSION` | `Early Access` | Hytale version label used to pick matching files |
| `CURSEFORGE_MODS_DIR` | `/data/curseforge-mods` | CurseForge mods directory (added as extra `--mods` path) |
| **Logging & Debug** |||
| `CONTAINER_LOG_LEVEL` | `INFO` | Container log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `DRY_RUN` | `false` | Simulate startup without actually running the server |
| `DIAGNOSTICS` | `false` | Run basic startup diagnostics (port validity, /tmp writable, memory limit, UDP buffer) |
| `NO_COLOR` | `false` | Disable colored log output |
| `DATA_DIR` | `/data` | Base directory for all server data |
| **World Configuration (Basics)** |||
| `WORLD_<WORLD_NAME>_VERSION` | `4` | World config version |
| `WORLD_<WORLD_NAME>_SEED` | `auto` | World seed (number) |
| `WORLD_<WORLD_NAME>_WORLD_GEN_TYPE` | `Hytale` | World generation type |
| `WORLD_<WORLD_NAME>_WORLD_GEN_NAME` | `Default` | World generation name |
| `WORLD_<WORLD_NAME>_WORLD_MAP_TYPE` | `WorldGen` | World map type |
| `WORLD_<WORLD_NAME>_CHUNK_STORAGE_TYPE` | `Hytale` | Chunk storage type |
| `WORLD_<WORLD_NAME>_RESOURCE_STORAGE_TYPE` | `Hytale` | Resource storage type |
| `WORLD_<WORLD_NAME>_GAMEPLAY_CONFIG` | `Default` | Gameplay config preset |
| `WORLD_<WORLD_NAME>_IS_PVP_ENABLED` | `false` | Enable PvP |
| `WORLD_<WORLD_NAME>_IS_FALL_DAMAGE_ENABLED` | `true` | Enable fall damage |
| `WORLD_<WORLD_NAME>_IS_GAME_TIME_PAUSED` | `false` | Pause game time |
| `WORLD_<WORLD_NAME>_IS_SPAWNING_NPC` | `true` | Enable NPC spawning |
| `WORLD_<WORLD_NAME>_IS_SPAWN_MARKERS_ENABLED` | `true` | Enable spawn markers |
| `WORLD_<WORLD_NAME>_IS_ALL_NPC_FROZEN` | `false` | Freeze all NPCs |
| `WORLD_<WORLD_NAME>_IS_SAVING_PLAYERS` | `true` | Enable player saving |
| `WORLD_<WORLD_NAME>_IS_SAVING_CHUNKS` | `true` | Enable chunk saving |
| `WORLD_<WORLD_NAME>_IS_UNLOADING_CHUNKS` | `true` | Enable chunk unloading |
| **World Configuration (Advanced)** |||
| `WORLD_<WORLD_NAME>_DEATH_RESPAWN_CONTROLLER_TYPE` | `HomeOrSpawnPoint` | Respawn controller type |
| `WORLD_<WORLD_NAME>_DEATH_ITEMS_LOSS_MODE` | `Configured` | Item loss mode (`None`, `All`, `Configured`) |
| `WORLD_<WORLD_NAME>_DEATH_ITEMS_AMOUNT_LOSS_PERCENTAGE` | `50` | Item loss percentage |
| `WORLD_<WORLD_NAME>_DEATH_ITEMS_DURABILITY_LOSS_PERCENTAGE` | `10` | Item durability loss percentage |
| `WORLD_<WORLD_NAME>_IS_TICKING` | `true` | Enable world ticking |
| `WORLD_<WORLD_NAME>_IS_BLOCK_TICKING` | `true` | Enable block ticking |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_SUN_HEIGHT_PERCENT` | `100` | Client sun height percent |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_SUN_ANGLE_DEGREES` | `0` | Client sun angle degrees |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_BLOOM_INTENSITY` | `0.30000001192092896` | Client bloom intensity |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_BLOOM_POWER` | `8` | Client bloom power |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_SUN_INTENSITY` | `0.25` | Client sun intensity |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_SUNSHAFT_INTENSITY` | `0.30000001192092896` | Client sunshaft intensity |
| `WORLD_<WORLD_NAME>_CLIENT_EFFECTS_SUNSHAFT_SCALE_FACTOR` | `4` | Client sunshaft scale factor |
| `WORLD_<WORLD_NAME>_IS_COMPASS_UPDATING` | `true` | Enable compass updates |
| `WORLD_<WORLD_NAME>_SAVE_NEW_CHUNKS` | `true` | Save new chunks |
| `WORLD_<WORLD_NAME>_IS_OBJECTIVE_MARKERS_ENABLED` | `true` | Enable objective markers |
| `WORLD_<WORLD_NAME>_DELETE_ON_UNIVERSE_START` | `false` | Delete on universe start |
| `WORLD_<WORLD_NAME>_DELETE_ON_REMOVE` | `false` | Delete on remove |


### Server Command-Line Flags

All flags are documented in the official Hytale server. To see the complete list:

```bash
# To see help, you need server files downloaded first
docker run --rm -v hytale-data:/data ghcr.io/godstepx/docker-hytale-server:latest java -jar /data/server/HytaleServer.jar --help
```

**Authentication Modes:**
- `authenticated` (default): Requires server authentication. Use `/auth login device` in console after first startup. By default, the container will prompt you to sign in if no cached credentials are found (`AUTO_AUTH_ON_START=true`, OAuth).
- `offline`: No authentication required (for testing only)
- `insecure`: Disables authentication (for development/testing only)

**Backup Configuration:**
Set `ENABLE_BACKUPS=true` to enable automatic backups. Backups are saved to `/data/backups` by default every 30 minutes. Adjust with `BACKUP_FREQUENCY` and `BACKUP_DIR`.

**Operator Commands:**
Set `ALLOW_OP=true` to enable operator commands on the server.

**Early Plugins (Unsupported):**
Set `ACCEPT_EARLY_PLUGINS=true` to acknowledge loading early plugins. This is unsupported and may cause stability issues.

### Automatic Mod Installation (CurseForge)

Enable automatic mod installation by setting `MOD_INSTALL_MODE=curseforge`. Mods are installed into `CURSEFORGE_MODS_DIR` (default: `/data/curseforge-mods`), state is tracked in `/data/.mods-state.json` to avoid re-downloading, and stale cached mods are removed when they are no longer listed. This directory is added as an extra `--mods` path, so the default `mods` directory is still loaded too.

The server always loads the default `mods` directory under `/data/mods`. Use that directory for your own custom jars, and use `CURSEFORGE_MODS_DIR` for auto-installed mods.
CurseForge API access requires an API key; set `CURSEFORGE_API_KEY` or the container will exit on startup when `MOD_INSTALL_MODE=curseforge`.
Set `CURSEFORGE_GAME_VERSION` to target a specific Hytale version label (ex: `Early Access`) when choosing the latest file.
Required CurseForge dependencies are auto-resolved recursively; if a dependency lacks a matching `CURSEFORGE_GAME_VERSION`, the latest file is still used with a warning.

**Mod list format:**
- `12345` (latest file)
- `12345:67890` (specific file ID)

**Example: Environment Variables**
```yaml
environment:
  MOD_INSTALL_MODE: "curseforge"
  CURSEFORGE_API_KEY: "your-api-key"
  CURSEFORGE_GAME_VERSION: "Early Access"
  CURSEFORGE_MOD_LIST: "12345,67890:111222"
```

### Server Configuration (config.json & whitelist.json)

The container can automatically generate or patch `config.json` and `whitelist.json` at startup using environment variables.

**Behavior:**
- If file doesn't exist: created with defaults
- If file exists and env vars are set: only the specified fields are patched
- `HYTALE_CONFIG_JSON` / `WHITELIST_JSON`: full file override (replaces entire file)
- `WORLD_CONFIG_JSON_<WORLD_NAME>` overrides `/data/universe/worlds/<world>/config.json` (uses `UNIVERSE_PATH` when set)
- `WORLD_<WORLD_NAME>_<SETTING>` patches per-world config fields (suffix is lowercased)
- `Death` and `ClientEffects` blocks are only created when their env vars are provided

**Example: Basic Server Configuration**
```yaml
environment:
  SERVER_NAME: "My Awesome Server"
  SERVER_MOTD: "Welcome to the party!"
  MAX_PLAYERS: "50"
  DEFAULT_GAME_MODE: "Adventure"
  WHITELIST_ENABLED: "true"
  WHITELIST_LIST: "uuid-1,uuid-2,uuid-3"
```

**Example: Full JSON Override**
```yaml
environment:
  HYTALE_CONFIG_JSON: '{"Version": 3, "ServerName": "Custom", "MOTD": "", "Password": "", "MaxPlayers": 100, "MaxViewRadius": 32, "LocalCompressionEnabled": false, "Defaults": {"World": "default", "GameMode": "Adventure"}, "ConnectionTimeouts": {"JoinTimeouts": {}}, "RateLimit": {}, "Modules": {}, "LogLevels": {}, "Mods": {}, "DisplayTmpTagsInStrings": false, "PlayerStorage": {"Type": "Hytale"}}'
```

**Example: Per-World Config Override**
```yaml
environment:
  WORLD_CONFIG_JSON_DEFAULT: '{"Difficulty": "Hard", "Gameplay": {"FriendlyFire": true}}'
```

**Example: Per-World Settings**
```yaml
environment:
  WORLD_DEFAULT_DEATH_ITEMS_LOSS_MODE: "Configured"
  WORLD_DEFAULT_DEATH_ITEMS_AMOUNT_LOSS_PERCENTAGE: "25"
  WORLD_DEFAULT_IS_PVP_ENABLED: "true"
```

### Authentication & Token Management

Once you’ve signed in, the container keeps your login and reuses it on future starts. You normally won’t have to log in again unless the saved credentials expire (OAuth).

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_AUTH_ON_START` | `true` | Start login flow if no tokens available (OAuth) |
| `OAUTH_REFRESH_CHECK_INTERVAL` | `86400000` | Background OAuth refresh interval in ms (24h) |
| `OAUTH_REFRESH_THRESHOLD_DAYS` | `7` | Refresh OAuth tokens when this many days left |
| `LOG_RETENTION_DAYS` | `7` | Delete server logs older than this (0 = disable) |

**How it works:**
1. On first start, you'll see a login URL - visit it to authenticate (OAuth)
2. Tokens are stored in `/data/.auth/` and persist across restarts (OAuth)
3. Background refresh keeps tokens alive indefinitely (even 30+ day runs)
4. The Hytale server handles game session refresh internally

### Token Passthrough (GSP/Hosting Providers)

Skip the interactive auth flow by passing tokens directly:

| Variable | Description |
|----------|-------------|
| `HYTALE_SERVER_SESSION_TOKEN` | Session token (JWT) |
| `HYTALE_SERVER_IDENTITY_TOKEN` | Identity token (JWT) |
| `HYTALE_OWNER_UUID` | Profile UUID for session |
| `HYTALE_OWNER_NAME` | Display name for server owner |

```yaml
environment:
  HYTALE_SERVER_SESSION_TOKEN: "eyJhbGciOiJFZERTQSIs..."
  HYTALE_SERVER_IDENTITY_TOKEN: "eyJhbGciOiJFZERTQSIs..."
  HYTALE_OWNER_UUID: "123e4567-e89b-12d3-a456-426614174000"
  HYTALE_OWNER_NAME: "ServerOwner"
```

For token acquisition, see the Official Hytale Documentation [Server Provider Authentication Guide](https://support.hytale.com/hc/en-us/articles/45328341414043-Server-Provider-Authentication-Guide).

## Volumes

- `/data` - Everything persistent (Worlds, Configs, Logs, Auth)
  - `/data/server/` - Server files (HytaleServer.jar, AOT cache)
  - `/data/Assets.zip` - Game assets
- `/data/universe/` - Universe root
- `/data/universe/worlds/` - World saves and per-world config.json
  - `/data/config.json` - Server configuration (auto-generated from env vars or managed by Hytale)
  - `/data/whitelist.json` - Whitelist configuration (auto-generated from env vars)
  - `/data/.auth/` - CLI auth cache (OAuth tokens)
  - `/data/.mods-state.json` - Mod installer state (auto-managed)
  - `/data/.machine-id` - Persistent machine-id used when host ID is not mounted
  - `/data/logs/` - Server logs
  - `/data/backups/` - Automatic backups (if enabled)
  - `/data/.version` - Installed version metadata

### Bundled CLI

The Hytale Downloader CLI is **pre-bundled** in the image at `/opt/hytale/cli/` (read-only). This eliminates the need to download the CLI at runtime. Auth tokens (OAuth) are still stored in `/data/.auth/` for persistence across container restarts.

If the CLI returns an auth error (for example `invalid_grant` or `403 Forbidden`), the container clears `/data/.auth/credentials.json`. Restart the container to trigger the device login flow again.

## Updating

Updates are checked automatically on startup when `DOWNLOAD_MODE=cli` and `CHECK_UPDATES=true` (default). If a newer version is available, it will download and install it.

To force a re-download even if you are already up to date, set `FORCE_DOWNLOAD=true`.

## Development

This project uses [Just](https://github.com/casey/just) as a command runner for common development tasks. The server scripts are written in TypeScript and compiled to standalone binaries using Bun.

### Prerequisites
- Docker
- [Just](https://github.com/casey/just#installation)
- [Bun](https://bun.sh)
- hadolint (for Dockerfile linting)

### Available Commands

Run `just` or `just --list` to see all available recipes:

```bash
just                    # Show help
just build              # Build the Docker image with pre-bundled CLI
just build-multi        # Build multi-platform image and push to GHCR
just run                # Run container in dry-run mode for testing
just run-interactive    # Start interactive shell in container
just test               # Run TypeScript type checking (alias for lint-ts)
just lint               # Run TypeScript type checking and hadolint
just lint-ts            # Run TypeScript type checking only
just format             # Format TypeScript code with Prettier
just build-binaries     # Build TypeScript binaries locally (development)
just clean              # Remove built images and test data
```

### Quick Start for Contributors

```bash
# Install Bun dependencies
just install

# Build the Docker image (compiles TypeScript binaries inside Docker)
just build

# Run TypeScript type checking
just lint-ts

# Run type checking
just test

# Optional: Docker smoke test (pull/build image first)
./tests/test-options.sh

# Test the container locally
just run

# Access container shell for debugging
just run-interactive
```

### Local Development

The server scripts are written in TypeScript (in `src/`) and compiled to standalone Bun binaries during the Docker build. For local development:

```bash
# Install dependencies
bun install

# Run scripts directly with Bun (for testing)
bun run src/entrypoint.ts      # Main entrypoint (download + auth + start)
bun run src/healthcheck.ts     # Health check script

# Build binaries locally
bun run build

# Format code
bun run format

# Type check
bun run lint
```

**Note:** The Docker build uses a multi-stage process that compiles TypeScript to standalone binaries, eliminating the need for bash, curl, and jq in the production image (unzip is still included).

### Environment Variables

The Justfile uses these variables (can be overridden):
- `IMAGE_NAME` - Docker image name (default: `ghcr.io/godstepx/docker-hytale-server`)
- `IMAGE_TAG` - Image tag (default: `latest`)

Override with environment variables:
```bash
IMAGE_TAG=dev just build
```

## License
MIT
