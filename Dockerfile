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

ARG JAVA_VERSION=25.0.1_8
ARG ALPINE_VERSION=3.20
ARG HYTALE_CLI_URL="https://downloader.hytale.com/hytale-downloader.zip"

# =============================================================================
# Stage 1: Bun builder - compile TypeScript to standalone binaries
# =============================================================================
FROM oven/bun:1-alpine AS builder

# TARGETARCH is provided by Docker buildx (amd64, arm64)
ARG TARGETARCH

WORKDIR /build

# Copy package files
COPY package.json bun.lock* tsconfig.json ./

# Install dependencies (use cache when available)
RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/

# Build standalone binaries for target architecture
RUN mkdir -p dist && \
    if [ "$TARGETARCH" = "arm64" ]; then \
      BUN_TARGET="bun-linux-arm64"; \
    else \
      BUN_TARGET="bun-linux-x64-baseline"; \
    fi && \
    echo "Building for $TARGETARCH using $BUN_TARGET" && \
    bun build ./src/entrypoint.ts --compile --target="$BUN_TARGET" --outfile dist/entrypoint && \
    bun build ./src/healthcheck.ts --compile --target="$BUN_TARGET" --outfile dist/healthcheck

# Verify binaries were created
RUN ls -lh dist/ && \
    test -f dist/entrypoint && \
    test -f dist/healthcheck

# =============================================================================
# Stage 2: CLI Downloader - fetch and extract Hytale Downloader CLI
# =============================================================================
FROM alpine:${ALPINE_VERSION} AS cli-downloader

ARG HYTALE_CLI_URL
ARG TARGETARCH

# Install minimal tools for download and extraction
# hadolint ignore=DL3018
RUN apk add --no-cache curl unzip

WORKDIR /cli

# Download and extract CLI
RUN curl -fsSL "${HYTALE_CLI_URL}" -o hytale-cli.zip && \
    unzip -q hytale-cli.zip && \
    rm hytale-cli.zip && \
    case "${TARGETARCH}" in \
      arm64) CLI_CANDIDATES="hytale-downloader-linux-arm64 hytale-downloader-linux-amd64" ;; \
      amd64) CLI_CANDIDATES="hytale-downloader-linux-amd64" ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    for bin in ${CLI_CANDIDATES}; do \
      if [ -f "${bin}" ]; then CLI_BIN="${bin}"; break; fi; \
    done && \
    if [ -z "${CLI_BIN}" ]; then \
      echo "Expected CLI binary not found for ${TARGETARCH} in: ${CLI_CANDIDATES}" && exit 1; \
    fi && \
    mv "${CLI_BIN}" hytale-downloader && \
    find . -maxdepth 1 -type f -name "hytale-downloader-*" -delete && \
    rm -f QUICKSTART.md && \
    chmod +x hytale-downloader && \
    ls -la

# =============================================================================
# Stage 3: Base image with minimal dependencies
# =============================================================================
FROM eclipse-temurin:${JAVA_VERSION}-jre-alpine AS base

# Install minimal runtime dependencies
# tini for proper signal handling, libstdc++/libgcc/libc6-compat/gcompat for Bun binaries and glibc-linked native libs (e.g., Netty), su-exec for privilege drop, unzip for game extraction
# hadolint ignore=DL3018
RUN apk add --no-cache \
    tini \
    libstdc++ \
    libgcc \
    libc6-compat \
    gcompat \
    su-exec \
    unzip \
    && rm -rf /var/cache/apk/*

# =============================================================================
# Stage 4: Production image
# =============================================================================
FROM base AS production

LABEL org.opencontainers.image.title="Hytale Dedicated Server"
LABEL org.opencontainers.image.description="Self-hosted Hytale Dedicated Server"
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

# Copy pre-bundled Hytale CLI (eliminates runtime download)
COPY --from=cli-downloader --chmod=755 /cli/ /opt/hytale/cli/

# Create data directory with correct permissions
RUN mkdir -p /data /data/logs /data/backups /usr/local/lib/hytale \
    && chown -R hytale:hytale /data /opt/hytale /usr/local/lib/hytale

# Expose UDP port (QUIC)
EXPOSE 5520/udp

# Volume for persistent data
VOLUME ["/data"]

# Health check - verify process is running and port is listening
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD /opt/hytale/bin/healthcheck

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start server with compiled binary (entrypoint drops to hytale via su-exec)
CMD ["/opt/hytale/bin/entrypoint"]

# Graceful shutdown
STOPSIGNAL SIGTERM
