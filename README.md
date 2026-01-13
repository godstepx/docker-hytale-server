# Hytale Server Docker Image

🐳 Docker image for self-hosting Hytale Dedicated Servers with flexible server file management.

## Features

- **Automated Authentication** - Auto-triggers `/auth login device` and exports links
- **Command Piping** - Send console commands via `/data/server.input`
- **Multiple download methods** - CLI, launcher copy, or manual
- **Non-root user** (UID 1000) for security
- **AOT cache support** for faster startup
- **Graceful shutdown** with SIGTERM handling
- **Health checks** for orchestration
- **Version tracking** for easy updates

## Quick Start

### Option 1: Copy from Hytale Launcher (Easiest)

If you have Hytale installed on your machine, copy the server files:

**Find your launcher files:**
- **Windows:** `%appdata%\Hytale\install\release\package\game\latest`
- **Linux:** `$XDG_DATA_HOME/Hytale/install/release/package/game/latest`
- **MacOS:** `~/Application Support/Hytale/install/release/package/game/latest`

**Method A: Mount launcher directory directly**
```bash
docker run -d \
  -v "/path/to/Hytale/install/release/package/game/latest:/launcher:ro" \
  -e LAUNCHER_PATH=/launcher \
  -v hytale-data:/data \
  -p 5520:5520/udp \
  ghcr.io/godstepx/hytale-server:latest
```

**Method B: Copy files to volume**
```bash
# Create volume and copy files
docker volume create hytale-data
docker run --rm -v hytale-data:/data alpine mkdir -p /data/server

# Copy from your launcher installation
docker cp ./Server/. hytale-container:/data/server/
docker cp ./Assets.zip hytale-container:/data/Assets.zip

# Start server
docker run -d -v hytale-data:/data -p 5520:5520/udp ghcr.io/godstepx/hytale-server:latest
```

Use the official Hytale CLI for automated downloads.

1. Create a `docker-compose.yml` (see below) and run:
```bash
docker compose up -d
```

3. Complete Device Authorization using the generated link:
   - Check `AUTH_LINK.url` in your directory for the download authorization link.
   - Check `SERVER_AUTH.url` for the server registration link.
   - Open the URL in your browser, log in, and enter the code.

4. The server will automatically detect the authorization and proceed.

### Server Authentication

The server automatically triggers `/auth login device` on first boot. 
You can find the login link in [SERVER_AUTH.url](./SERVER_AUTH.url). 
Once authenticated, the session is persisted in the volume and won't be requested again unless it expires.

## Docker Compose

To start with Docker Compose, run:
```bash
docker compose up -d
```

```yaml
services:
  hytale:
    image: ghcr.io/godstepx/hytale-server:latest
    container_name: hytale-server
    restart: unless-stopped
    stdin_open: true
    tty: true
    ports:
      - "5520:5520/udp"
    volumes:
      - hytale-data:/data
      # Optional: Mount launcher for offline setup
      # - /path/to/Hytale/install/release/package/game/latest:/launcher:ro
    environment:
      - JAVA_XMS=1G
      - JAVA_XMX=4G
      # Optional: Use launcher files instead of CLI download
      # - LAUNCHER_PATH=/launcher

volumes:
  hytale-data:
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| **Download Options** |||
| `DOWNLOAD_MODE` | `auto` | `auto`, `cli`, `launcher`, or `manual` |
| `HYTALE_CLI_URL` | `https://downloader.hytale.com/hytale-downloader.zip` | URL to Hytale Downloader CLI |
| `LAUNCHER_PATH` | - | Path to mounted launcher directory (skips download) |
| `HYTALE_PATCHLINE` | `release` | `release` or `pre-release` |
| `FORCE_DOWNLOAD` | `false` | Force re-download even if files exist |
| **Java Options** |||
| `JAVA_XMS` | `1G` | Initial heap size |
| `JAVA_XMX` | `4G` | Maximum heap size |
| **Server Options** |||
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |
| `ENABLE_BACKUPS` | `false` | Enable auto backups |
| `BACKUP_FREQUENCY` | `30` | Backup interval (minutes) |
| `DISABLE_SENTRY` | `false` | Disable crash reporting |

## Ports

- **5520/udp** - Hytale uses QUIC protocol (UDP, not TCP!)

## Volumes

- `/data` - Persistent server data, worlds, configs, CLI cache
  - `/data/server/` - Server JAR and binaries
  - `/data/server.input` - Named pipe for sending console commands
  - `/data/Assets.zip` - Game assets
  - `/data/universe/` - World saves
  - `/data/config.json` - Server configuration
  - `/data/.hytale-cli/` - Downloader CLI (if used)
  - `/data/.auth/` - CLI auth cache

## Updating

### Check for Updates
```bash
docker run --rm -v hytale-data:/data -e FORCE_DOWNLOAD=true ghcr.io/godstepx/hytale-server:latest
```

### View Installed Version
```bash
docker run --rm -v hytale-data:/data alpine cat /data/.version
```

## License

MIT
