#!/bin/sh

# add the node user to the docker group on the host (sandboxed compiles)
if [ -e /var/run/docker.sock ]; then
  DOCKER_GROUP=$(stat -c '%g' /var/run/docker.sock)
  groupadd --non-unique --gid "${DOCKER_GROUP}" dockeronhost
  usermod -aG dockeronhost node
fi

# compatibility: initial volume setup
mkdir -p /overleaf/services/clsi-typst/cache && chown node:node /overleaf/services/clsi-typst/cache
mkdir -p /overleaf/services/clsi-typst/compiles && chown node:node /overleaf/services/clsi-typst/compiles
mkdir -p /overleaf/services/clsi-typst/output && chown node:node /overleaf/services/clsi-typst/output
mkdir -p /overleaf/services/clsi-typst/uploads && chown node:node /overleaf/services/clsi-typst/uploads

exec runuser -u node -- "$@"
