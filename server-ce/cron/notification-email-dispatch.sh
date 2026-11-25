#!/usr/bin/env bash

set -eu

echo "-----------------------------------------------"
echo "Dispatching scheduled notifications"
echo "(emailNotifications -> Apprise API)"
echo "-----------------------------------------------"
date

source /etc/container_environment.sh
source /etc/overleaf/env.sh

cd /overleaf/services/web && /sbin/setuser www-data node scripts/process_notifications.mjs

echo "Done."
