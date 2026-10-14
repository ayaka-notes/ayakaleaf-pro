#!/bin/sh

set -e

## Dropbox gets a doc when document-updater writes it to Mongo. CE keeps the
## docs of a closed project in Redis, so with Dropbox sync turn on upstream's
## continuous background flush: it writes and unloads the projects nobody has
## had open for 3 minutes. An explicit CONTINUOUS_BACKGROUND_FLUSH wins.

if [ "$(echo "${DROPBOX_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" = true ] &&
  [ -z "${CONTINUOUS_BACKGROUND_FLUSH:-}" ]; then
  echo true >/etc/container_environment/CONTINUOUS_BACKGROUND_FLUSH
fi
