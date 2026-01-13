# syntax=docker/dockerfile:1

# =============================================================================
# Hytale Dedicated Server Docker Image
# =============================================================================
# Multi-stage build for minimal production image
# Base: Eclipse Temurin JRE 25 on Alpine Linux
# Features:
#   - Official Hytale Downloader CLI integration
#   - OAuth2 Device Authorization for first-time setup
#   - Non-root user for security
# =============================================================================

ARG JAVA_VERSION=25
ARG ALPINE_VERSION=3.20

# =============================================================================
# Stage 1: Base image with dependencies
# =============================================================================
FROM eclipse-temurin:${JAVA_VERSION}-jre-alpine AS base

# Install runtime dependencies
# hadolint ignore=DL3018
RUN apk add --no-cache \
    bash \
    curl \
    jq \
    tini \
    unzip \
    gcompat \
    libgcc \
    && rm -rf /var/cache/apk/*

# =============================================================================
# Stage 2: Production image
# =============================================================================
FROM base AS production

LABEL org.opencontainers.image.title="Hytale Dedicated Server"
LABEL org.opencontainers.image.description="Self-hosted Hytale Dedicated Server with auto-download via official Hytale CLI"
LABEL org.opencontainers.image.source="https://github.com/godstepx/docker-hytale-server"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
ARG UID=1000
ARG GID=1000
RUN addgroup -g ${GID} hytale \
    && adduser -D -u ${UID} -G hytale -h /opt/hytale hytale

# Setup directories
WORKDIR /opt/hytale

# Copy scripts
COPY --chmod=755 scripts/ /opt/hytale/scripts/
COPY templates/ /opt/hytale/templates/

# Create data directory with correct permissions
RUN mkdir -p /data /data/logs /data/backups \
    && chown -R hytale:hytale /data /opt/hytale

# Environment defaults
ENV DATA_DIR=/data \
    # Download options
    DOWNLOAD_MODE=auto \
    HYTALE_CLI_URL="" \
    LAUNCHER_PATH="" \
    HYTALE_PATCHLINE=release \
    FORCE_DOWNLOAD=false \
    CHECK_UPDATES=true \
    # Java options
    JAVA_XMS=1G \
    JAVA_XMX=4G \
    # Server options
    SERVER_PORT=5520 \
    BIND_ADDRESS=0.0.0.0 \
    AUTH_MODE=authenticated \
    ENABLE_BACKUPS=false \
    BACKUP_FREQUENCY=30 \
    DISABLE_SENTRY=false \
    DRY_RUN=false \
    TZ=UTC

# Expose UDP port (QUIC)
EXPOSE 5520/udp

# Volume for persistent data
VOLUME ["/data"]

# Health check - verify process is running and port is listening
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD /opt/hytale/scripts/healthcheck.sh

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Run as non-root user
USER hytale

# Start server
CMD ["/opt/hytale/scripts/entrypoint.sh"]

# Graceful shutdown
STOPSIGNAL SIGTERM
