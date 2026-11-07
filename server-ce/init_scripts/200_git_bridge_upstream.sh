#!/bin/sh

set -e

## Point nginx's /git/ location at git-bridge, from the GIT_BRIDGE_HOST and
## GIT_BRIDGE_PORT that web also reads. Sorts before 200_nginx_config_template.sh,
## which checks and reloads the nginx config.

echo "set \$git_upstream http://${GIT_BRIDGE_HOST:-git-bridge}:${GIT_BRIDGE_PORT:-8000};" \
  > /etc/nginx/git-bridge-upstream.conf
