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
| `JAVA_XMX` | `4G` | Maximum heap size |
| `JAVA_XMS` | `1G` | Initial heap size |
| `DOWNLOAD_MODE` | `auto` | `auto`, `cli`, `launcher`, or `manual` |
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |
| `ENABLE_AOT` | `true` | Enable/Disable AOT cache |
| `DOWNLOAD_MAX_RETRIES` | `5` | How many times to retry the Hytale downloader before failing |
| `DOWNLOAD_INITIAL_BACKOFF` | `2` | Initial backoff (seconds) between retries; grows exponentially |

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
just build              # Build the Docker image (compiles TypeScript in Docker)
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
bun run src/entrypoint.ts
bun run src/download.ts
bun run src/healthcheck.ts

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
