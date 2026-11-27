#!/bin/sh

set -e

## Point nginx's /git/ location at git-bridge, from the GIT_BRIDGE_HOST and
## GIT_BRIDGE_PORT that web also reads. Sorts before 200_nginx_config_template.sh,
## which checks and reloads the nginx config.

echo "set \$git_upstream http://${GIT_BRIDGE_HOST:-git-bridge}:${GIT_BRIDGE_PORT:-8000};" \
  > /etc/nginx/git-bridge-upstream.conf

## Docker answers DNS on 127.0.0.11, Podman on the network gateway: point the
## /git/ resolver in overleaf.conf at this container's DNS servers.
resolvers=$(awk 'BEGIN{ORS=" "} $1=="nameserver" {if ($2 ~ ":") {print "["$2"]"} else {print $2}}' /etc/resolv.conf)
sed -i "s/^\(\s*resolver \).* valid=10s;$/\1${resolvers}valid=10s;/" /etc/nginx/sites-enabled/overleaf.conf
