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
  ghcr.io/godstepx/hytale-server:latest
```

### Option B: Direct Docker Run
```bash
docker run -d \
  --name hytale-server \
  -v hytale-data:/data \
  -p 5520:5520/udp \
  ghcr.io/godstepx/hytale-server:latest
```

---

## Advanced Features

### Command Piping
Send console commands to the running server without attaching:
```bash
# Example: Send /help or /whitelist
echo "/help" > /path/to/your/volume/server.input
```

### Automatic Authentication
The server intelligently detects if a session is active. It will only export `SERVER_AUTH.url` if a new login is required. Sessions are persisted in the `/data` volume.

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
| `CHECK_UPDATES` | `false` | Check for updates on startup (prints latest version) |
| `DOWNLOAD_MAX_RETRIES` | `5` | Max retry attempts for CLI download |
| `DOWNLOAD_INITIAL_BACKOFF` | `2` | Initial backoff seconds between retries |
| **Java Options** |||
| `JAVA_XMS` | `1G` | Initial heap size |
| `JAVA_XMX` | `4G` | Maximum heap size |
| `JAVA_OPTS` | - | Additional JVM options (space-separated) |
| **Server Options** |||
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `BIND_ADDRESS` | `0.0.0.0` | Address to bind the server to |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |
| `ENABLE_BACKUPS` | `false` | Enable automatic backups |
| `BACKUP_FREQUENCY` | `30` | Backup interval (minutes) |
| `BACKUP_DIR` | `/data/backups` | Backup directory |
| `DISABLE_SENTRY` | `false` | Disable crash reporting |
| `ACCEPT_EARLY_PLUGINS` | `false` | Enable early plugins (unsupported, may cause stability issues) |
| `ALLOW_OP` | `false` | Allow operator commands |
| **Logging & Debug** |||
| `CONTAINER_LOG_LEVEL` | `INFO` | Container log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `DRY_RUN` | `false` | Simulate startup without actually running the server |
| `DATA_DIR` | `/data` | Base directory for all server data |

### Server Command-Line Flags

All flags are documented in the official Hytale server. To see the complete list:

```bash
# Note: Server JAR is at /data/server/HytaleServer.jar in a running container
# To see help, you need server files downloaded first
docker run --rm -v hytale-data:/data ghcr.io/godstepx/hytale-server:latest java -jar /data/server/HytaleServer.jar --help
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

### Token Passthrough (GSP/Advanced)

Skip the interactive auth flow by passing tokens directly:

| Variable | Description |
|----------|-------------|
| `HYTALE_SERVER_SESSION_TOKEN` | Session token (JWT) |
| `HYTALE_SERVER_IDENTITY_TOKEN` | Identity token (JWT) |

```yaml
environment:
  HYTALE_SERVER_SESSION_TOKEN: "eyJhbGciOiJFZERTQSIs..."
  HYTALE_SERVER_IDENTITY_TOKEN: "eyJhbGciOiJFZERTQSIs..."
```

For token acquisition, see the [Server Provider Authentication Guide](https://support.hytale.com/hc/en-us/articles/45326769436187).

## Volumes

- `/data` - Everything persistent (Worlds, Configs, Logs, Auth)
  - `/data/server.input` - Named pipe for console commands
  - `/data/universe/` - World saves
  - `/data/config.json` - Server configuration (managed by Hytale)
  - `/data/.auth/` - CLI auth cache (OAuth tokens)
  - `/data/backups/` - Automatic backups (if enabled)

### Bundled CLI

The Hytale Downloader CLI is **pre-bundled** in the image at `/opt/hytale/cli/` (read-only). This eliminates the need to download the CLI at runtime. OAuth authentication tokens are still stored in `/data/.auth/` for persistence across container restarts.

## Updating

### Check for Updates
```bash
docker run --rm -v hytale-data:/data -e FORCE_DOWNLOAD=true ghcr.io/godstepx/hytale-server:latest
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
just test               # Run all tests (TypeScript + integration)
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

# Run tests
just test

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
bun run src/setup.ts         # Setup script (includes download)
bun run src/healthcheck.ts   # Health check script

# Build binaries locally
bun run build

# Format code
bun run format

# Type check
bun run lint
```

**Note:** The Docker build uses a multi-stage process that compiles TypeScript to standalone binaries, eliminating the need for bash, curl, jq, and unzip in the production image!

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
