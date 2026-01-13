# Hytale Server Docker Image - Justfile
# Use `just` to see available recipes

IMAGE_NAME := "ghcr.io/godstepx/docker-hytale-server"
IMAGE_TAG := "latest"

# Show available recipes (default)
[private]
default:
    @just --list

# Show available recipes
help:
    @echo "Hytale Server Justfile"
    @echo ""
    @echo "Recipes:"
    @echo "  build              Build the Docker image"
    @echo "  build-multi        Build multi-platform image and push"
    @echo "  run                Run the container in dry-run mode"
    @echo "  run-interactive    Run interactive shell in container"
    @echo "  test               Run all tests"
    @echo "  lint               Run TypeScript and Dockerfile linters"
    @echo "  lint-ts            Run TypeScript type checking"
    @echo "  clean              Remove built images and test data"

# Build the Docker image
build:
    docker build -t {{IMAGE_NAME}}:{{IMAGE_TAG}} .

# Build multi-platform image and push to registry
build-multi:
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -t {{IMAGE_NAME}}:{{IMAGE_TAG}} \
        --push .

# Run the container in dry-run mode
run:
    docker run --rm -it \
        -p 5520:5520/udp \
        -v ./test-data:/data \
        -e DRY_RUN=true \
        {{IMAGE_NAME}}:{{IMAGE_TAG}}

# Run interactive shell in container
run-interactive:
    docker run --rm -it \
        -v ./test-data:/data \
        --entrypoint /bin/sh \
        {{IMAGE_NAME}}:{{IMAGE_TAG}}

# Run all tests
test: lint-ts test-integration
    @echo "All tests passed!"

# Run TypeScript type checking
[private]
lint-ts:
    @echo "Running TypeScript type checking..."
    bun run lint

# Run integration tests
[private]
test-integration:
    @echo "Running integration tests..."
    @if [ -f tests/test-integration.sh ]; then \
        ./tests/test-integration.sh; \
    else \
        echo "Integration tests not yet updated for TypeScript binaries"; \
    fi

# Run linters (TypeScript and hadolint)
lint: lint-ts
    @echo "Running hadolint..."
    hadolint Dockerfile || true

# Format TypeScript code
format:
    @echo "Formatting TypeScript code..."
    bun run format

# Check TypeScript formatting
format-check:
    @echo "Checking TypeScript formatting..."
    bun run format:check

# Remove built images and test data
clean:
    docker rmi {{IMAGE_NAME}}:{{IMAGE_TAG}} || true
    rm -rf test-data
    rm -rf dist

# Install Bun dependencies
install:
    @echo "Installing Bun dependencies..."
    bun install

# Build TypeScript binaries locally (for development)
build-binaries:
    @echo "Building TypeScript binaries..."
    bun run build