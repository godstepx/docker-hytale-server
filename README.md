# Hytale Server Docker Image

🐳 Docker image for self-hosting Hytale Dedicated Servers with flexible server file management.

## Features

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

### Option 2: Hytale Downloader CLI (Recommended for Production)

Use the official Hytale CLI for automated downloads. Requires OAuth2 authentication on first run.

1. Get the CLI download URL from the [Hytale Server Manual](https://support.hytale.com/hc/en-us/articles/Hytale-Server-Manual)

2. Start the container (interactive for first download):
```bash
docker run -it \
  -v hytale-data:/data \
  -p 5520:5520/udp \
  ghcr.io/godstepx/hytale-server:latest
```

3. Complete Device Authorization when prompted:
```
Please visit the following URL to authenticate:
https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=ABCD1234
Authorization code: ABCD1234
```

   - Open the URL in your browser
   - You must be logged into your Hytale account
   - Enter the code to authorize this download
   - **Note:** This is a one-time verification per download, similar to Netflix device auth

4. After download completes, server files are cached. Future starts don't need re-auth:
```bash
docker run -d -v hytale-data:/data -p 5520:5520/udp ghcr.io/godstepx/hytale-server:latest
```

### Server Authentication

After the server starts, authenticate it via the server console:
```
> /auth login device
```
This is separate from the download auth and registers your server with Hytale's API.

## Docker Compose

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
| `HYTALE_CLI_URL` | `https://downloader.hytale.com/...` | URL to Hytale Downloader CLI (auto-detected) |
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
