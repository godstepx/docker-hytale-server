# Hytale Server Docker Image

🐳 Docker image for self-hosting Hytale Dedicated Servers. 

> [!TIP]
> **New to Hytale hosting?** Use our web-based config generator: [setuphytale.com](https://setuphytale.com)

## Quick Start (Docker Compose)

The recommended way to run the Hytale server is using **Docker Compose**.

1. **Create a `docker-compose.yml` file:**

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
      - hytale-data:/data
    environment:
      - JAVA_XMX=4G
      - HOME=/data

volumes:
  hytale-data:
```

---

## 🛠️ Development & Building

If you want to build the image yourself or push it to your own registry:

```bash
# Build the image
docker build -t ghcr.io/your-user/docker-hytale-server:latest .

# Push to GitHub Packages (requires login)
docker push ghcr.io/your-user/docker-hytale-server:latest
```

> [!NOTE]
> Make sure your GitHub package visibility is set to **Public** so others can pull it!

2. **Start the server (first time):**

> [!IMPORTANT]
> On first launch, you **must** watch the logs to see the authentication link!

```bash
# First time: Run in foreground to see the auth link
docker compose up

# Or if already started with -d, watch the logs:
docker logs -f hytale-server
```

You will see an authorization URL in the logs:
```
Please visit the following URL to authenticate:
https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=XXXXXXXX
```

Open this link in your browser and log in with your Hytale account. The server will continue automatically after authorization.

3. **After authorization - run in background:**
```bash
# Stop with Ctrl+C, then restart in background
docker compose up -d
```

4. **Server registration (optional):**
If your server needs to register with Hytale's API, check the container logs for a `SERVER_AUTH.url` link.

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
