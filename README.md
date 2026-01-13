# Hytale Server Docker Image

🐳 Docker image for self-hosting Hytale Dedicated Servers with automatic download via official Hytale CLI.

## Features

- **Official Hytale Downloader CLI** - automatic server file download
- **OAuth2 Device Authorization** - one-time browser auth, then automatic
- **Non-root user** (UID 1000) for security
- **AOT cache support** for faster startup
- **Graceful shutdown** with SIGTERM handling
- **Health checks** for orchestration

## Quick Start

### First Run (Interactive - Required for OAuth)

```bash
docker run -it -v hytale-data:/data ghcr.io/godstepx/hytale-server:latest
```

You will see:
```
===================================================================
DEVICE AUTHORIZATION
===================================================================
Visit: https://accounts.hytale.com/device
Enter code: ABCD-1234
===================================================================
```

1. Open the URL in your browser
2. Log in with your Hytale account
3. Enter the code
4. Wait for download (~3.5 GB)
5. Server starts automatically

### Subsequent Runs

After first auth, token is cached:
```bash
docker run -d -v hytale-data:/data ghcr.io/godstepx/hytale-server:latest
```

## Docker Compose

```yaml
services:
  hytale:
    image: ghcr.io/godstepx/hytale-server:latest
    container_name: hytale-server
    restart: unless-stopped
    stdin_open: true  # For first-run auth
    tty: true
    ports:
      - "5520:5520/udp"
    volumes:
      - ./data:/data
    environment:
      - JAVA_XMS=1G
      - JAVA_XMX=4G
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JAVA_XMS` | `1G` | Initial heap size |
| `JAVA_XMX` | `4G` | Maximum heap size |
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `HYTALE_PATCHLINE` | `release` | `release` or `pre-release` |
| `ENABLE_BACKUPS` | `false` | Enable auto backups |
| `BACKUP_FREQUENCY` | `30` | Backup interval (minutes) |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |
| `DISABLE_SENTRY` | `false` | Disable crash reporting |

## Ports

- **5520/udp** - Hytale uses QUIC protocol (UDP, not TCP!)

## Volumes

- `/data` - Persistent server data, worlds, configs, auth cache

## License

MIT
