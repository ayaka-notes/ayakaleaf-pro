#!/usr/bin/env bash

set -eu

echo "-----------------------------------------------"
echo "Enqueueing project change notifications"
echo "(scan redis -> project-notification queue)"
echo "-----------------------------------------------"
date

source /etc/container_environment.sh
source /etc/overleaf/env.sh

# The enqueue script's Bull config reads QUEUES_REDIS_*; align it with the
# stack's redis (REDIS_* from the container env) — and keep it consistent
# with the web consumer (ProjectNotificationQueueConsumer.mjs).
export QUEUES_REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export QUEUES_REDIS_PORT="${REDIS_PORT:-6379}"
export QUEUES_REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# cwd MUST be services/document-updater: @overleaf/settings resolves defaults
# from CWD/config/settings.defaults.js, and only THIS config defines
# Settings.redis.documentupdater.key_schema (projectNotificationTimestamp).
cd /overleaf/services/document-updater && /sbin/setuser www-data node scripts/project_notifications.mjs

echo "Done."
