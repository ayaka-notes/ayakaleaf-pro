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

export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY

ENDPOINT="http://localhost:8333"

echo "Testing connection to SeaweedFS S3 gateway..."
aws --endpoint-url "$ENDPOINT" s3 ls

# Array of required Overleaf buckets
BUCKETS=(
  "overleaf-user-files"
  "overleaf-template-files"
  "overleaf-project-blobs"
  "overleaf-chunks"
)

echo "Checking and creating Overleaf buckets..."
for bucket in "${BUCKETS[@]}"; do
  if ! aws --endpoint-url "$ENDPOINT" s3 ls "s3://$bucket" >/dev/null 2>&1; then
    echo "Creating bucket: s3://$bucket"
    aws --endpoint-url "$ENDPOINT" s3 mb "s3://$bucket"
  else
    echo "Bucket already exists: s3://$bucket"
  fi
done

echo "Bucket setup complete. Current buckets:"
aws --endpoint-url "$ENDPOINT" s3 ls
