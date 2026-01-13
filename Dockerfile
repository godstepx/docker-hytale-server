# syntax=docker/dockerfile:1

# =============================================================================
# Hytale Dedicated Server Docker Image
# =============================================================================
# Multi-stage build for minimal production image
# Base: Eclipse Temurin JRE 25 on Alpine Linux
# Features:
#   - TypeScript/Bun compiled binaries (no bash/curl/jq dependencies)
#   - Official Hytale Downloader CLI integration
#   - OAuth2 Device Authorization for first-time setup
#   - Non-root user for security
# =============================================================================

ARG JAVA_VERSION=25
ARG ALPINE_VERSION=3.20

# =============================================================================
# Stage 1: Bun builder - compile TypeScript to standalone binaries
# =============================================================================
FROM oven/bun:1-alpine AS builder

WORKDIR /build

# Copy package files
COPY package.json bun.lock* tsconfig.json ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/

# Build standalone binaries
RUN mkdir -p dist && \
    bun build ./src/entrypoint.ts --compile --target=bun-linux-x64-baseline --outfile dist/entrypoint && \
    bun build ./src/healthcheck.ts --compile --target=bun-linux-x64-baseline --outfile dist/healthcheck

# Verify binaries were created
RUN ls -lh dist/ && \
    test -f dist/entrypoint && \
    test -f dist/healthcheck

# =============================================================================
# Stage 2: Base image with minimal dependencies
# =============================================================================
FROM eclipse-temurin:${JAVA_VERSION}-jre-alpine AS base

# Install minimal runtime dependencies
# Only tini needed now (bash, curl, jq, unzip removed!)
# hadolint ignore=DL3018
RUN apk add --no-cache \
    tini \
    && rm -rf /var/cache/apk/*

# =============================================================================
# Stage 3: Production image
# =============================================================================
FROM base AS production

LABEL org.opencontainers.image.title="Hytale Dedicated Server"
LABEL org.opencontainers.image.description="Self-hosted Hytale Dedicated Server with TypeScript/Bun binaries"
LABEL org.opencontainers.image.source="https://github.com/godstepx/docker-hytale-server"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
ARG UID=1000
ARG GID=1000
RUN addgroup -g ${GID} hytale \
    && adduser -D -u ${UID} -G hytale -h /opt/hytale hytale

# Setup directories
WORKDIR /opt/hytale

# Copy compiled binaries from builder
COPY --from=builder --chmod=755 /build/dist/entrypoint /opt/hytale/bin/entrypoint
COPY --from=builder --chmod=755 /build/dist/healthcheck /opt/hytale/bin/healthcheck

# Create data directory with correct permissions
RUN mkdir -p /data /data/logs /data/backups \
    && chown -R hytale:hytale /data /opt/hytale /data/logs /data/backups

# Environment defaults
ENV DATA_DIR=/data \
    # Download options
    DOWNLOAD_MODE=auto \
    HYTALE_CLI_URL="https://downloader.hytale.com/hytale-downloader.zip" \
    LAUNCHER_PATH="" \
    HYTALE_PATCHLINE=release \
    FORCE_DOWNLOAD=false \
    CHECK_UPDATES=false \
    # Java options
    JAVA_XMS=1G \
    JAVA_XMX=4G \
    # Server options
    SERVER_PORT=5520 \
    BIND_ADDRESS=0.0.0.0 \
    AUTH_MODE=authenticated \
    ENABLE_BACKUPS=false \
    BACKUP_FREQUENCY=30 \
    BACKUP_DIR=/data/backups \
    DISABLE_SENTRY=false \
    DRY_RUN=false \
    LOG_LEVEL=INFO \
    TZ=UTC

# Expose UDP port (QUIC)
EXPOSE 5520/udp

# Volume for persistent data
VOLUME ["/data"]

# Health check - verify process is running and port is listening
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD /opt/hytale/bin/healthcheck

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Run as non-root user
USER hytale

# Start server with compiled binary
CMD ["/opt/hytale/bin/entrypoint"]

# Graceful shutdown
STOPSIGNAL SIGTERM
