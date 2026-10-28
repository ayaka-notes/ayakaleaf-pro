#!/usr/bin/env bash
set -euo pipefail

# Path to your .env file (adjust if your script runs from a different directory)
ENV_FILE="./.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "Error: .env file not found at $ENV_FILE" >&2
  exit 1
fi

# Ensure AWS variables are exported for the AWS CLI
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY

ENDPOINT="http://localhost:8333"
BACKUP_DIR="./backup_seaweedfs_online"
TIMESTAMP=$(date +%F_%H-%M-%S)

mkdir -p "$BACKUP_DIR/$TIMESTAMP"

echo "1. Capturing online metadata snapshot..."
docker exec seaweedfs-filer weed shell -master="master:9333" <<< "fs.meta.save /data/filer_meta_$TIMESTAMP.json"

echo "2. Syncing S3 buckets live..."
for bucket in overleaf-user-files overleaf-template-files overleaf-project-blobs overleaf-chunks; do
  echo "Syncing s3://$bucket..."
  aws --endpoint-url "$ENDPOINT" s3 sync "s3://$bucket" "$BACKUP_DIR/$TIMESTAMP/$bucket"
done

echo "Online backup completed successfully at $TIMESTAMP"

