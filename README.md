# Hytale Server Docker Image

🐳 Docker image for self-hosting Hytale Dedicated Servers with automatic updates, OAuth handling, and easy configuration.

> **New to Hytale hosting?** Use the config generator at [setuphytale.com](https://setuphytale.com)

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

```bash
docker compose up
```

An **authentication URL** will appear in the logs - open it in your browser and log in with your Hytale account.

### 3. Run in Background

```bash
docker compose up -d
docker logs -f hytale-server
```

---

## Environment Variables

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `JAVA_XMX` | `4G` | Maximum heap size |
| `JAVA_XMS` | `1G` | Initial heap size |
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |

### Updates

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_UPDATE` | `false` | Automatically download new server versions on startup |
| `CHECK_UPDATES` | `true` | Check for available updates (logs only if AUTO_UPDATE=false) |
| `FORCE_DOWNLOAD` | `false` | Force re-download server files |

### Advanced

| Variable | Default | Description |
|----------|---------|-------------|
| `DOWNLOAD_MODE` | `auto` | `auto`, `cli`, `launcher`, or `manual` |
| `ENABLE_AOT_CACHE` | `true` | Use AOT cache for faster startup |
| `DOWNLOAD_MAX_RETRIES` | `5` | Retry count for downloads |

### Token Passthrough (Hosting Providers)

Skip interactive auth by passing tokens directly:

| Variable | Description |
|----------|-------------|
| `HYTALE_SERVER_SESSION_TOKEN` | Session token (JWT) |
| `HYTALE_SERVER_IDENTITY_TOKEN` | Identity token (JWT) |
| `HYTALE_OWNER_UUID` | Profile UUID |

---

## Features

- **OAuth Device Flow** - Automatic authentication via browser
- **Auto-Updates** - Download new versions automatically with `AUTO_UPDATE=true`
- **Token Persistence** - Sessions saved across restarts
- **Dual Console Input** - Works with Portainer Attach AND file-based input
- **Graceful Shutdown** - Saves world data on `docker stop`
- **Health Checks** - Built-in container health monitoring

## Console Commands

Send commands without attaching:
```bash
echo "/help" > ./data/server.input
```

Or attach directly:
```bash
docker attach hytale-server
```

## Volumes

| Path | Description |
|------|-------------|
| `/data` | All persistent data |
| `/data/universe/` | World saves |
| `/data/.auth/` | OAuth tokens |
| `/data/server.input` | Console input pipe |

## Building

```bash
docker build -t ghcr.io/your-user/docker-hytale-server:latest .
```

## License

MIT
