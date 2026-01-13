.PHONY: build run test lint clean help

IMAGE_NAME ?= ghcr.io/gamml/hytale-server
IMAGE_TAG ?= latest

help:
	@echo "server-image Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  build    Build the Docker image"
	@echo "  run      Run the container in dry-run mode"
	@echo "  test     Run all tests"
	@echo "  lint     Run shellcheck on all scripts"
	@echo "  clean    Remove built images"

build:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

build-multi:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		--push .

run:
	docker run --rm -it \
		-p 5520:5520/udp \
		-v ./test-data:/data \
		-e DRY_RUN=true \
		-e SERVER_URL=https://example.com/hytale-server.jar \
		$(IMAGE_NAME):$(IMAGE_TAG)

run-interactive:
	docker run --rm -it \
		-v ./test-data:/data \
		--entrypoint /bin/bash \
		$(IMAGE_NAME):$(IMAGE_TAG)

test: test-shellcheck test-unit test-integration
	@echo "All tests passed!"

test-shellcheck:
	@echo "Running shellcheck..."
	shellcheck scripts/*.sh

test-unit:
	@echo "Running unit tests..."
	./tests/test-config-generator.sh

test-integration:
	@echo "Running integration tests..."
	./tests/test-integration.sh

lint: test-shellcheck
	@echo "Running hadolint..."
	hadolint Dockerfile || true

clean:
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) || true
	rm -rf test-data
