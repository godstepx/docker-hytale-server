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
| `DOWNLOAD_MODE` | `auto` | `auto`, `cli`, `launcher`, or `manual` |
| `SERVER_PORT` | `5520` | UDP port (QUIC) |
| `AUTH_MODE` | `authenticated` | `authenticated` or `offline` |
| `ENABLE_AOT` | `true` | Enable/Disable AOT cache |

## Volumes

- `/data` - Everything persistent (Worlds, Configs, Logs, Auth)
  - `/data/server.input` - Named pipe for console commands
  - `/data/universe/` - World saves

## License
MIT
