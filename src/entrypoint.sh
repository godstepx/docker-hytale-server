#!/bin/sh
# Entrypoint wrapper script
# This script runs the Bun setup binary, then execs Java directly
# This avoids Bun managing a long-running subprocess (which can crash on ARM64)

set -e

SETUP_BIN="/opt/hytale/bin/setup"
JAVA_CMD_FILE="/tmp/java-cmd.sh"

# Run setup (download, validation, build java command)
if ! "$SETUP_BIN"; then
    echo "Setup failed"
    exit 1
fi

# Check if we're in dry run mode
if [ "$DRY_RUN" = "true" ]; then
    exit 0
fi

# Check if java command file was created
if [ ! -f "$JAVA_CMD_FILE" ]; then
    echo "Java command file not found: $JAVA_CMD_FILE"
    exit 1
fi

# Change to data directory - Hytale writes config.json and universe/ relative to cwd
cd "${DATA_DIR:-/data}"

# Source and exec the java command (replaces this shell process with Java)
. "$JAVA_CMD_FILE"
