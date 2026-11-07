#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env file
if [ -f .env ]; then
  set -a
  source .env
  set +a
else
  echo "Error: .env file not found!" >&2
  exit 1
fi

SERVICE_NAME="seaweedfs-s3"
IMAGE_NAME="chrislusf/seaweedfs:latest"
YAML_DIRECTORY_NAME="${COMPOSE_DIRECTORY:-$(pwd)}"

# Get current image ID (short format)
CURRENT_IMAGE=$(docker inspect --format='{{.Image}}' "${SERVICE_NAME}" 2>/dev/null | cut -d: -f2 | cut -c1-12) || true

# Pull the latest image
echo "Pulling latest image..."
docker pull "${IMAGE_NAME}"

# Get new image ID (short format)
NEW_IMAGE=$(docker images "${IMAGE_NAME}" --format '{{.ID}}')

echo "Current image: $CURRENT_IMAGE"
echo "Latest image:  $NEW_IMAGE"

# Compare and restart only if different
if [ -z "$CURRENT_IMAGE" ]; then
    echo "Container not found, starting it up..."
    cd "${YAML_DIRECTORY_NAME}"
    docker compose up -d "${SERVICE_NAME}"
elif [ "$CURRENT_IMAGE" != "$NEW_IMAGE" ]; then
    echo "New image detected, restarting container..."
    cd "${YAML_DIRECTORY_NAME}"
    docker compose down "${SERVICE_NAME}"
    docker compose up -d "${SERVICE_NAME}"
    echo "Update completed!"
else
    echo "Already running the latest version, no restart needed."
fi
