#!/bin/sh
# seed-ssos.sh — load the test SSO providers into a running Overleaf CE container
# and restart its web service so the passport strategies register.
#
# Usage:
#   ./seed-ssos.sh <overleaf-container> [providers-file]
#
# Defaults: providers-file = e2e-providers.json (next to this script).
set -eu

OL="${1:?overleaf container name required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PROV="${2:-$HERE/e2e-providers.json}"

echo "Copying $PROV -> $OL:/overleaf/config/ssos.e2e.json"
docker cp "$PROV" "$OL:/overleaf/config/ssos.e2e.json"

echo "Setting OVERLEAF_SSO_PROVIDERS_FILE and restarting the web service"
docker exec "$OL" bash -lc '
  grep -q OVERLEAF_SSO_PROVIDERS_FILE /etc/overleaf/env.sh 2>/dev/null \
    || echo "OVERLEAF_SSO_PROVIDERS_FILE=/overleaf/config/ssos.e2e.json" >> /etc/overleaf/env.sh
  . /etc/overleaf/env.sh
  sv restart web-overleaf || true
'
echo "Done. Wait for the app to come back, then open /login (both SSO buttons)" \
     "and /admin/auths (provider list) as a site admin."
