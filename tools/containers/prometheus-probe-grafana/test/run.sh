#!/usr/bin/env bash
# =============================================================================
# Track A — deterministic integration test for the prometheus-probe-grafana
# bundle.
#
# Brings up a throwaway fixture (mongo + redis with KNOWN counts) plus a
# filestore dir of KNOWN byte size, runs the bundle against it on its own
# network, and asserts:
#   * the sensor's gauges are EXACTLY the seeded values
#     (totals, standard/guest split, active window, byte-exact filestore du,
#      redis ram/disk)
#   * probe isolation: killing the fixture redis degrades only the redis probe
#     (/metrics still 200, other gauges intact, errors_total increments) and
#     the sensor recovers when redis comes back
#   * Prometheus scrapes: up==1 for the live jobs, up==0 for the jobs whose
#     targets (overleaf-web, overleaf-filestore) do not exist here
#   * Alert rules: MonitoringTargetDown fires for the missing targets;
#     InstanceSensorProbeFailing fires while redis is down
#   * Grafana: health, provisioned datasource, provisioned dashboard load
#   * concurrent scrapes (single-flight) all answer 200
#
# Usage:  bash test/run.sh     (or: make -C server-ce test-sensor)
# Exit:   0 = all checks passed, 1 = at least one failure.
# =============================================================================
set -u
cd "$(dirname "$0")"
BUNDLE_DIR=$(cd .. && pwd)
ROOT=$(git -C "$BUNDLE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")

PROM=http://127.0.0.1:19090
GRAF=http://127.0.0.1:13000
PASS=0
FAIL=0

ok()  { echo "PASS  $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }
section() { echo; echo "=== $1 ==="; }

FILESTORE_DIR=$(mktemp -d /tmp/ppb-filestore.XXXXXX)
chmod 755 "$FILESTORE_DIR" # mktemp dirs are 700 — the sensor runs as user "node"
EXPECT_BYTES=0

cleanup() {
  echo
  echo "--- cleanup ---"
  docker compose -f "$BUNDLE_DIR/compose.yaml" --env-file "$BUNDLE_DIR/test/.env" down --remove-orphans >/dev/null 2>&1 || true
  docker compose -f fixture-compose.yaml down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$FILESTORE_DIR" "$BUNDLE_DIR/test/.env"
}
trap cleanup EXIT

sensor_metrics() { docker exec instance-sensor wget -qO- http://127.0.0.1:9464/metrics 2>/dev/null; }

# exact value of a metric line, e.g. metric_val 'overleaf_instance_users_total{segment="all"}'
# (must match at START of line, else the # HELP line for the same name wins)
metric_val() {
  sensor_metrics 2>/dev/null | awk -v m="$1" 'index($0, m " ") == 1 {print $2; exit}'
}

http_code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

promql() { # promql 'up{job="node"}' -> value (empty if no series)
  curl -s "$PROM/api/v1/query" --data-urlencode "query=$1" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d["data"]["result"]; print(r[0]["value"][1] if r else "")' 2>/dev/null
}

alert_names() {
  curl -s "$PROM/api/v1/alerts" \
    | python3 -c 'import json,sys; [print(a["labels"]["alertname"]) for a in json.load(sys.stdin)["data"]["alerts"]]' 2>/dev/null
}

# -----------------------------------------------------------------------------
section "1. fixture: filestore dir of known size"
dd if=/dev/zero of="$FILESTORE_DIR/blob1.bin" bs=1 count=3145728 status=none
printf 'x%.0s' $(seq 1 12345) > "$FILESTORE_DIR/blob2.txt"
echo "filestore fixture: $FILESTORE_DIR (files sum to $((3145728 + 12345)) bytes)"

# -----------------------------------------------------------------------------
section "2. build the sensor image (server-ce/Makefile build-sensor)"
SENSOR_IMAGE=overleaf-instance-sensor:local
if [ -n "$ROOT" ] && [ -f "$ROOT/server-ce/Makefile" ]; then
  BRANCH_TAG_SAFE=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD | sed 's|/|--|g')
  REV=$(git -C "$ROOT" rev-parse HEAD)
  if make -C "$ROOT/server-ce" build-sensor; then
    SENSOR_IMAGE=sharelatex/sharelatex-sensor:${BRANCH_TAG_SAFE}-${REV}
  else
    echo "make build-sensor failed — falling back to local docker build"
  fi
fi
if ! docker image inspect "$SENSOR_IMAGE" >/dev/null 2>&1; then
  docker build --tag "$SENSOR_IMAGE" -f "$BUNDLE_DIR/instance-sensor/Dockerfile" "$BUNDLE_DIR/instance-sensor" || exit 1
fi
echo "sensor image: $SENSOR_IMAGE"

# -----------------------------------------------------------------------------
section "3. fixture: mongo + redis (aliased mongo/redis on ppb-test)"
docker compose -f fixture-compose.yaml up -d || exit 1
i=0
until docker exec ppb-fixture-mongo mongosh --quiet --eval 'db.adminCommand({ping:1})' >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -ge 40 ] && { echo "fixture mongo never became ready"; exit 1; }
  sleep 2
done
i=0
until [ "$(docker exec ppb-fixture-redis redis-cli ping 2>/dev/null)" = PONG ]; do
  i=$((i + 1)); [ $i -ge 40 ] && { echo "fixture redis never became ready"; docker logs ppb-fixture-redis 2>&1 | tail; exit 1; }
  sleep 2
done
echo "fixture mongo + redis up"

# -----------------------------------------------------------------------------
section "4. seed known data"
docker exec -i ppb-fixture-mongo mongosh --quiet sharelatex < seed.js || exit 1
# AOF on (so the redis_disk assertion is deterministic), then known keys
redis-cli-fixture() { docker exec ppb-fixture-redis redis-cli "$@"; }
redis-cli-fixture config set appendonly yes >/dev/null || exit 1
redis-cli-fixture set ppb:seed "01234567890123456789" >/dev/null || exit 1
redis-cli-fixture bgrewriteaof >/dev/null 2>&1
i=0
until [ "$(redis-cli-fixture info persistence | grep -oP 'aof_current_size:\K[0-9]+' || echo 0)" -gt 0 ] 2>/dev/null; do
  i=$((i + 1)); [ $i -ge 15 ] && { echo "aof_current_size never became > 0"; exit 1; }
  sleep 1
done
echo "seeded (users=12 std=9 guest=3, active 3+2 in 6h; projects=7 active 4; docs=9; aof on)"

# -----------------------------------------------------------------------------
section "5. bundle up against the fixture"
sed "s|__FILESTORE__|$FILESTORE_DIR|" env.test > .env
echo "INSTANCE_SENSOR_IMAGE=$SENSOR_IMAGE" >> .env
docker compose -f "$BUNDLE_DIR/compose.yaml" --env-file .env up -d || exit 1

echo "waiting for instance-sensor / prometheus / grafana to become healthy..."
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' instance-sensor 2>/dev/null)" = healthy ] \
   && [ "$(docker inspect -f '{{.State.Health.Status}}' prometheus 2>/dev/null)" = healthy ] \
   && [ "$(docker inspect -f '{{.State.Health.Status}}' grafana 2>/dev/null)" = healthy ]; do
  i=$((i + 1))
  if [ $i -ge 60 ]; then
    echo "stack did not become healthy in time"
    docker compose -f "$BUNDLE_DIR/compose.yaml" --env-file .env ps || true
    docker logs --tail 20 instance-sensor || true
    exit 1
  fi
  sleep 5
done
ok "bundle stack healthy (sensor, prometheus, grafana)"

# -----------------------------------------------------------------------------
section "6. sensor gauges vs the seed"
# Expected filestore value: du -sb AS MEASURED IN THE SENSOR IMAGE. (On this
# host's filesystem busybox du counts the dir's own st_size, ~80 B more than
# the plain file-size sum — the sensor's contract is "the du of that dir", so
# we assert against the same du, not a hand-computed sum.)
EXPECT_BYTES=$(docker run --rm --entrypoint sh -v "$FILESTORE_DIR":/d:ro "$SENSOR_IMAGE" -c 'du -sb /d | cut -f1')
echo "filestore: dir sum=3158073, du in sensor image=$EXPECT_BYTES"
check_gauge() { # check_gauge 'label' 'line prefix' expected
  got=$(metric_val "$2")
  if [ "$got" = "$3" ]; then ok "$1 = $got"; else bad "$1 = ${got:-<missing>} (want $3)"; fi
}
check_gauge "users_total all"        'overleaf_instance_users_total{segment="all"}' 12
check_gauge "users_total standard"   'overleaf_instance_users_total{segment="standard"}' 9
check_gauge "users_total guest"      'overleaf_instance_users_total{segment="guest"}' 3
check_gauge "users_active all 6h"    'overleaf_instance_users_active{segment="all",window_hours="6"}' 5
check_gauge "users_active standard"  'overleaf_instance_users_active{segment="standard",window_hours="6"}' 3
check_gauge "users_active guest"     'overleaf_instance_users_active{segment="guest",window_hours="6"}' 2
check_gauge "projects_total"         'overleaf_instance_projects_total' 7
check_gauge "projects_active 6h"     'overleaf_instance_projects_active{window_hours="6"}' 4
check_gauge "files_total"            'overleaf_instance_files_total' 9
check_gauge "filestore bytes (du)"   'overleaf_instance_storage_bytes{component="filestore"}' "$EXPECT_BYTES"

check_positive() { # numeric > 0 (floats allowed, e.g. scrape_duration)
  got=$(metric_val "$1")
  if [ -n "$got" ] && awk -v v="$got" 'BEGIN { exit !(v > 0) }' 2>/dev/null; then ok "$1 = $got (> 0)"; else bad "$1 = ${got:-<missing>} (want > 0)"; fi
}
check_positive 'overleaf_instance_storage_bytes{component="mongodb"}'
check_positive 'overleaf_instance_storage_bytes{component="redis_ram"}'
check_positive 'overleaf_instance_storage_bytes{component="redis_disk"}'
check_gauge "probe_up mongo"      'overleaf_instance_sensor_probe_up{source="mongo"}' 1
check_gauge "probe_up filestore"  'overleaf_instance_sensor_probe_up{source="filestore"}' 1
check_gauge "probe_up redis"      'overleaf_instance_sensor_probe_up{source="redis"}' 1
check_positive 'overleaf_instance_sensor_scrape_duration_seconds'
hz=$(docker exec instance-sensor wget -qO- http://127.0.0.1:9464/healthz 2>/dev/null)
if echo "$hz" | grep -q '"status":"ok"' && echo "$hz" | grep -q '"redis":true'; then
  ok "/healthz reports ok with all probes up"
else
  bad "/healthz: $hz"
fi

# -----------------------------------------------------------------------------
section "7. concurrent scrapes (single-flight)"
okcodes=0
pids=()
for i in 1 2 3 4 5; do
  docker exec instance-sensor wget -q --spider http://127.0.0.1:9464/metrics >/dev/null 2>&1 &
  pids+=("$!")
done
for p in "${pids[@]}"; do wait "$p" && okcodes=$((okcodes + 1)); done
if [ "$okcodes" = 5 ]; then ok "5 concurrent /metrics scrapes all succeeded"; else bad "concurrent scrapes: $okcodes/5"; fi

# -----------------------------------------------------------------------------
section "8. prometheus scrape state"
# Convergence: right after stack-up, the first scrapes can transiently miss a
# target (container healthy != first scrape ok). Poll until the expected up
# state holds, then assert it.
i=0
until [ "$(promql 'up{job="overleaf-instance"}')" = 1 ] \
   && [ "$(promql 'up{job="overleaf-mongodb"}')" = 1 ] \
   && [ "$(promql 'up{job="overleaf-redis"}')" = 1 ] \
   && [ "$(promql 'up{job="node"}')" = 1 ] \
   && [ "$(promql 'up{job="prometheus"}')" = 1 ] \
   && [ "$(promql 'up{job="grafana"}')" = 1 ]; do
  i=$((i + 1)); [ $i -ge 24 ] && break; sleep 5
done
check_prom_up() { # check_prom_up 'overleaf-instance' 1
  got=$(promql "up{job=\"$1\"}")
  if [ "$got" = "$2" ]; then ok "up{job=$1} = $got"; else bad "up{job=$1} = ${got:-<no series>} (want $2)"; fi
}
check_prom_up overleaf-instance 1
check_prom_up overleaf-mongodb 1
check_prom_up overleaf-redis 1
check_prom_up node 1
check_prom_up prometheus 1
check_prom_up grafana 1
check_prom_up overleaf-web 0
check_prom_up overleaf-filestore 0

# -----------------------------------------------------------------------------
section "9. alert rules"
i=0
until alert_names | grep -q MonitoringTargetDown; do i=$((i + 1)); [ $i -ge 12 ] && break; sleep 5; done
if alert_names | grep -q MonitoringTargetDown; then
  ok "MonitoringTargetDown firing (overleaf-web / overleaf-filestore absent)"
else
  bad "MonitoringTargetDown not firing"
fi
# InstanceSensorProbeFailing must CLEAR once the probes are stably up — the
# rule reflects the latest sample, so wait for convergence before asserting.
i=0
until ! alert_names | grep -q InstanceSensorProbeFailing; do i=$((i + 1)); [ $i -ge 24 ] && break; sleep 5; done
if alert_names | grep -q InstanceSensorProbeFailing; then
  bad "InstanceSensorProbeFailing firing unexpectedly"
else
  ok "no InstanceSensorProbeFailing while all probes are up"
fi

# -----------------------------------------------------------------------------
section "10. grafana provisioning"
if [ "$(http_code -u admin:ppb-test-password "$GRAF/api/health")" = 200 ]; then
  ok "grafana /api/health (admin auth)"
else
  bad "grafana /api/health"
fi
if curl -su admin:ppb-test-password "$GRAF/api/datasources" | grep -q prometheus; then
  ok "prometheus datasource provisioned"
else
  bad "prometheus datasource missing"
fi
if [ "$(http_code -u admin:ppb-test-password "$GRAF/api/dashboards/uid/overleaf-overview")" = 200 ]; then
  ok "overview dashboard (uid overleaf-overview) loads"
else
  bad "overview dashboard did not load"
fi

# -----------------------------------------------------------------------------
section "11. probe isolation: kill the fixture redis"
docker stop ppb-fixture-redis >/dev/null
sleep 8
body=$(sensor_metrics)
if echo "$body" | grep -q 'users_total{segment="all"} 12'; then
  ok "/metrics still answers 200 with other probes intact"
else
  bad "/metrics did not answer sanely while redis is down: $(echo "$body" | head -3)"
fi
if [ "$(metric_val 'overleaf_instance_sensor_probe_up{source="redis"}')" = 0 ]; then
  ok "probe_up{source=redis} = 0"
else
  bad "probe_up{source=redis} not 0"
fi
errs=$(metric_val 'overleaf_instance_sensor_errors_total{source="redis"}')
if [ -n "$errs" ] && [ "$errs" -ge 1 ] 2>/dev/null; then
  ok "errors_total{source=redis} = $errs (>= 1)"
else
  bad "errors_total{source=redis} = ${errs:-<missing>}"
fi
i=0
until alert_names | grep -q InstanceSensorProbeFailing; do i=$((i + 1)); [ $i -ge 12 ] && break; sleep 5; done
if alert_names | grep -q InstanceSensorProbeFailing; then
  ok "InstanceSensorProbeFailing fired while redis was down"
else
  bad "InstanceSensorProbeFailing did not fire"
fi

# -----------------------------------------------------------------------------
section "12. recovery: redis back"
docker start ppb-fixture-redis >/dev/null
i=0
until [ "$(metric_val 'overleaf_instance_sensor_probe_up{source="redis"}')" = 1 ]; do
  i=$((i + 1))
  if [ $i -ge 24 ]; then break; fi
  sleep 5
done
if [ "$(metric_val 'overleaf_instance_sensor_probe_up{source="redis"}')" = 1 ]; then
  ok "probe_up{source=redis} recovered to 1"
else
  bad "probe_up{source=redis} did not recover"
fi

# -----------------------------------------------------------------------------
echo
echo "==============================================="
echo "Track A result: $PASS passed, $FAIL failed"
echo "==============================================="
[ "$FAIL" -eq 0 ]
