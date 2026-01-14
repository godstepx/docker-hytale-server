# Hytale Server Docker Image

🐳 Docker image for self-hosting Hytale Dedicated Servers. 

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
    stdin_open: true
    tty: true
    ports:
      - "5520:5520/udp"
    volumes:
      - ./data:/data
      # Linux only: avoid "Failed to get hardware UUID" at startup
      - /etc/machine-id:/etc/machine-id:ro
    environment:
      JAVA_XMX: "4G"
      JAVA_XMS: "1G"
```

### 2. First Start (Authentication Required)

> [!IMPORTANT]
> On first launch, you must authenticate with your Hytale account.

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

## 🚀 Easy Setup with Hytale Compose

Instead of writing YAML by hand, use [Hytale Compose](https://github.com/godstepx/hytale-compose) to generate perfect configurations:

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
The server detects existing tokens and only starts device auth when needed. Sessions are persisted in the `/data` volume.

### Graceful Shutdown
The image handles `SIGTERM` to save world data before exiting.

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
| `CHECK_UPDATES` | `true` | Check for updates on startup (prints latest version) |
| `SKIP_CLI_UPDATE_CHECK` | `false` | Skip CLI self-update/version check |
| `DOWNLOAD_MAX_RETRIES` | `5` | Max retry attempts for CLI download |
| `DOWNLOAD_INITIAL_BACKOFF` | `2` | Initial backoff seconds between retries |
| **Java Options** |||
| `JAVA_XMS` | `1G` | Initial heap size |
| `JAVA_XMX` | `4G` | Maximum heap size |
| `JAVA_OPTS` | - | Additional JVM options (space-separated) |
| `ENABLE_AOT_CACHE` | `true` | Use AOT cache for faster startup (Java 25+) |
| **Server Options** |||
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `BIND_ADDRESS` | `0.0.0.0` | Address to bind the server to |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |
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
| `DEFAULT_GAME_MODE` | `Adventure` | Default game mode |
| `DISPLAY_TMP_TAGS_IN_STRINGS` | `false` | Display temporary tags in strings |
| `PLAYER_STORAGE_TYPE` | `Hytale` | Player storage type |
| `HYTALE_CONFIG_JSON` | - | Full JSON override for config.json |
| **Whitelist Configuration** |||
| `WHITELIST_ENABLED` | `false` | Enable whitelist |
| `WHITELIST_LIST` | - | Comma-separated list of player UUIDs |
| `WHITELIST_JSON` | - | Full JSON override for whitelist.json |
| **Advanced Options** |||
| `TRANSPORT_TYPE` | - | Transport protocol (e.g., `QUIC`, `TCP`) |
| `BOOT_COMMANDS` | - | Commands to run on boot (comma-separated) |
| `ADDITIONAL_MODS_DIR` | - | Additional mods directory path |
| `ADDITIONAL_PLUGINS_DIR` | - | Additional early plugins directory path |
| `SERVER_LOG_LEVEL` | - | Server log level (e.g., `root=DEBUG`) |
| `HYTALE_OWNER_NAME` | - | Display name for server owner |
| **Mod Installation (CurseForge)** |||
| `MOD_INSTALL_MODE` | `off` | `off` or `curseforge` |
| `CURSEFORGE_MOD_LIST` | - | Comma-separated CurseForge mod IDs (`12345` or `12345:67890`) |
| `CURSEFORGE_API_KEY` | - | CurseForge API key (required when `MOD_INSTALL_MODE=curseforge`) |
| `CURSEFORGE_GAME_VERSION` | `Early Access` | Hytale version label used to pick matching files |
| `CURSEFORGE_MODS_DIR` | `/data/curseforge-mods` | CurseForge mods directory (added as extra `--mods` path) |
| **Logging & Debug** |||
| `CONTAINER_LOG_LEVEL` | `INFO` | Container log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `DRY_RUN` | `false` | Simulate startup without actually running the server |
| `DATA_DIR` | `/data` | Base directory for all server data |

### Server Command-Line Flags

All flags are documented in the official Hytale server. To see the complete list:

```bash
# Note: Server JAR is at /data/server/HytaleServer.jar in a running container
# To see help, you need server files downloaded first
docker run --rm -v hytale-data:/data ghcr.io/godstepx/docker-hytale-server:latest java -jar /data/server/HytaleServer.jar --help
```

**Authentication Modes:**
- `authenticated` (default): Requires server authentication. Use `/auth login device` in console after first startup
- `offline`: No authentication required (for testing only)

**Backup Configuration:**
Set `ENABLE_BACKUPS=true` to enable automatic backups. Backups are saved to `/data/backups` by default every 30 minutes. Adjust with `BACKUP_FREQUENCY` and `BACKUP_DIR`.

**Operator Commands:**
Set `ALLOW_OP=true` to enable operator commands on the server.

**Early Plugins (Unsupported):**
Set `ACCEPT_EARLY_PLUGINS=true` to acknowledge loading early plugins. This is unsupported and may cause stability issues.

### Automatic Mod Installation (CurseForge)

Enable automatic mod installation by setting `MOD_INSTALL_MODE=curseforge`. Mods are installed into `CURSEFORGE_MODS_DIR` (default: `/data/curseforge-mods`), cached to avoid re-downloading, and stale cached mods are removed when they are no longer listed. This directory is added as an extra `--mods` path, so the default `mods` directory is still loaded too.

The server always loads the default `mods` directory under `/data/mods`. Use that directory for your own custom jars, and use `CURSEFORGE_MODS_DIR` for auto-installed mods.
CurseForge API access requires an API key; set `CURSEFORGE_API_KEY` or the container will exit on startup when `MOD_INSTALL_MODE=curseforge`.
Set `CURSEFORGE_GAME_VERSION` to target a specific Hytale version label (ex: `Early Access`) when choosing the latest file.

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

### Authentication & Token Management

The container automatically manages OAuth tokens for persistent authentication:

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_AUTH_ON_START` | `true` | Start device auth flow if no tokens available |
| `OAUTH_REFRESH_CHECK_INTERVAL` | `86400000` | Background OAuth refresh interval in ms (24h) |
| `OAUTH_REFRESH_THRESHOLD_DAYS` | `7` | Refresh OAuth tokens when this many days left |
| `LOG_RETENTION_DAYS` | `7` | Delete server logs older than this (0 = disable) |

**How it works:**
1. On first start, you'll see a device auth URL - visit it to authenticate
2. Tokens are stored in `/data/.auth/` and persist across restarts
3. Background refresh keeps tokens alive indefinitely (even 30+ day runs)
4. The Hytale server handles game session refresh internally

### Token Passthrough (GSP/Hosting Providers)

Skip the interactive auth flow by passing tokens directly:

| Variable | Description |
|----------|-------------|
| `HYTALE_SERVER_SESSION_TOKEN` | Session token (JWT) |
| `HYTALE_SERVER_IDENTITY_TOKEN` | Identity token (JWT) |
| `HYTALE_OWNER_UUID` | Profile UUID for session |

```yaml
environment:
  HYTALE_SERVER_SESSION_TOKEN: "eyJhbGciOiJFZERTQSIs..."
  HYTALE_SERVER_IDENTITY_TOKEN: "eyJhbGciOiJFZERTQSIs..."
  HYTALE_OWNER_UUID: "123e4567-e89b-12d3-a456-426614174000"
```

For token acquisition, see the Official Hytale Documentation [Server Provider Authentication Guide](https://support.hytale.com/hc/en-us/articles/45328341414043-Server-Provider-Authentication-Guide).

## Volumes

- `/data` - Everything persistent (Worlds, Configs, Logs, Auth)
  - `/data/universe/` - World saves
  - `/data/config.json` - Server configuration (auto-generated from env vars or managed by Hytale)
  - `/data/whitelist.json` - Whitelist configuration (auto-generated from env vars)
  - `/data/.auth/` - CLI auth cache (OAuth tokens)
  - `/data/logs/` - Server logs
  - `/data/backups/` - Automatic backups (if enabled)
  - `/data/.version` - Installed version metadata

### Bundled CLI

The Hytale Downloader CLI is **pre-bundled** in the image at `/opt/hytale/cli/` (read-only). This eliminates the need to download the CLI at runtime. OAuth authentication tokens are still stored in `/data/.auth/` for persistence across container restarts.

## Updating

### Check for Updates
```bash
docker run --rm -v hytale-data:/data -e FORCE_DOWNLOAD=true ghcr.io/godstepx/docker-hytale-server:latest
```

### View Installed Version
```bash
docker run --rm -v hytale-data:/data alpine cat /data/.version
```

## Development

This project uses [Just](https://github.com/casey/just) as a command runner for common development tasks. The server scripts are written in TypeScript and compiled to standalone binaries using Bun.

### Prerequisites
- Docker
- [Just](https://github.com/casey/just#installation) (`brew install just` on macOS)
- [Bun](https://bun.sh) (for local development and testing)
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
