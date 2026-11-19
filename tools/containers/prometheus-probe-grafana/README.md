# prometheus-probe-grafana

Self-contained **Prometheus + Grafana + exporter** monitoring stack for an
Overleaf (overleaf-cep) deployment — and, generically, for any stack that
exposes MongoDB + Redis. One compose project, one network, one `.env`; no
dependencies on the host deployment beyond the names your mongo/redis (and
optionally overleaf / seaweedfs) are reachable by.

It includes the **instance-statistics sensors** from
[PR yu-i-i/overleaf-cep#178](https://github.com/yu-i-i/overleaf-cep/pull/178)
(`instance-sensor`), delivered as **live Prometheus gauges computed on every
scrape** instead of the PR's hourly Mongo snapshots.

## Services

| service                | role                                                                     |
|------------------------|--------------------------------------------------------------------------|
| `instance-sensor`      | PR#178 sensors as live gauges (users/projects/files + storage) — built from `./instance-sensor` |
| `mongo-probe`          | protocol-level Mongo liveness (mongosh ping; sidecar `sleep infinity`)   |
| `mongodb-exporter`     | percona `mongodb_exporter` (connections, dbstats, oplog)                 |
| `mongodb-exporter-probe` | busybox HTTP spider proving the exporter's `/metrics` answers          |
| `redis-exporter`       | oliver006 `redis_exporter` (memory, clients, commands, keyspace, AOF)    |
| `redis-exporter-probe` | busybox HTTP spider for the redis exporter                                |
| `node-exporter`        | host CPU/mem/fs/load (reads host `/proc`, `/`, `/sys` read-only)         |
| `prometheus`           | TSDB (default 15d retention) + alert rules                                |
| `grafana`              | UI with provisioned datasource + dashboard (folder **Overleaf**)         |

## Quickstart

```sh
cd tools/containers/prometheus-probe-grafana
cp env.sample .env            # set GRAFANA_ADMIN_PASSWORD + target hostnames
docker compose build          # builds the instance-sensor image
docker compose up -d
docker compose ps             # everything healthy; grafana last
```

- Grafana: `http://<host>:3000/` (folder **Overleaf** → *Overleaf — instance overview*)
- Prometheus: `http://127.0.0.1:9090/` (bind is 127.0.0.1 by default — tunnel it)
- Alerts: visible at Prometheus *Alerts* (rules in `prometheus/prometheus.rules.yml`)

## Joining an existing deployment network

Defaults assume mongo/redis/overleaf run **in this project** or under those
names on a network this project joins. For an Overleaf compose deployment
(e.g. the psintern setup) put this in `.env`:

```
NETWORK_NAME=overleaf-network
NETWORK_EXTERNAL=true
MONGO_HOSTNAME=overleaf            # the deployment's mongo service name
REDIS_HOSTNAME=redis
OVERLEAF_HOSTNAME=overleaf
FILESTORE_HOST_DIR=/data_1/docker/compose/seaweedfs-volume/data
```

## What is measured

1. **Overleaf app sensors** — the sharelatex image ships `@overleaf/metrics`
   on the web process (`:3000/metrics`): `num_active_users` (live editor
   users), `timer_http_request` (quantiles), `mongo_command_started`,
   `nodejs_eventloop_lag_*`, GC/heap, `security_http_auth_check_credentials`,
   `editor_join_project`, `tpds_add_doc`, …
2. **Instance stats (PR#178)** — via `instance-sensor` (`overleaf_instance_*`):
   - `overleaf_instance_users_total{segment="all"}` (+ `standard`/`guest` with
     `INSTANCE_STATS_SEGMENTATION=true`; guest = `'guest-user'` in
     `users.adminRoles`, the PR#176 rule)
   - `overleaf_instance_users_active{window_hours="24"}` (window is
     configurable via `ACTIVE_WINDOW_HOURS` and reflected in the label)
   - `overleaf_instance_projects_total`,
     `overleaf_instance_projects_active{window_hours="24"}`
   - `overleaf_instance_files_total` (docs collection)
   - `overleaf_instance_storage_bytes{component="mongodb|filestore|redis_ram|redis_disk"}`
   - self-metrics: `overleaf_instance_sensor_probe_up{source=…}`,
     `overleaf_instance_sensor_scrape_duration_seconds`,
     `overleaf_instance_sensor_errors_total{source=…}` (counter)
3. **MongoDB** — connections, per-db data/storage size, oplog free space.
4. **Redis** — memory, clients, command rate, keyspace hit/miss, AOF.
5. **Host** — CPU, memory, filesystem, load, uptime, network (node-exporter).
6. **Filestore** — SeaweedFS master native prometheus (leader, under-replicated
   volumes, in-flight uploads/downloads) + the byte-exact `du` of the volume
   data dir in the sensor's `filestore` component.
7. **Scrape self-health** — `up` per job + the monitoring stack itself.

### instance-sensor design notes

- **Persistent** Mongo/Redis connections (no per-scrape handshake).
- Probes run **concurrently** and every phase is bounded by a timeout
  (`PROBE_TIMEOUT_MS`, `COLLECT_TIMEOUT_MS`) — a hung probe can never wedge
  the endpoint.
- **Single-flight**: concurrent scrapes (Prometheus + healthcheck) share one
  collect.
- `/healthz` is cheap (no probes) and is what the container healthcheck hits.
- A failing probe is isolated: it sets `probe_up{source}=0`, bumps
  `errors_total{source}`, and the rest of the endpoint still answers.
- `FILESTORE_HOST_DIR` is the host path of the SeaweedFS/S3 data dir; it is
  mounted read-only at the fixed in-container path `/hostdata/filestore`,
  which is what the sensor measures (byte-exact `du`). Default (`/dev/null`)
  reports 0 bytes, keeping the metric shape stable on stacks without a
  filestore. The sensor also supports a direct `FILESTORE_DATA_DIR=` empty
  value to drop the probe entirely (only relevant when running the sensor
  outside this compose file).
- Recommended indexes (the active-window counts are filtered queries):
  ```
  db.users.createIndex({ lastActive: 1 })
  db.projects.createIndex({ lastUpdated: 1 })
  db.users.createIndex({ adminRoles: 1 })   # only with SEGMENTATION=true
  ```

## Alerts (prometheus.rules.yml)

| alert                        | severity | condition                                   |
|------------------------------|----------|---------------------------------------------|
| `MonitoringTargetDown`       | warning  | `up == 0` for 5m                            |
| `InstanceSensorProbeFailing` | warning  | `probe_up{source} == 0` for 5m              |
| `InstanceSensorAllDown`      | critical | all probes down for 2m                      |
| `InstanceSensorScrapeSlow`   | warning  | collect > 10s for 10m                       |
| `MongoOplogHeadroomLow`      | warning  | oplog free < 10% for 30m                    |
| `MongoActiveConnectionsHigh` | warning  | active connections > 100 for 10m            |
| `RedisMemoryHigh`            | warning  | > 85% of maxmemory for 15m (only if maxmemory is set) |
| `RootFilesystemLow`          | critical | host root fs < 10% free for 30m             |
| `SeaweedFSMasterNotLeader`   | warning  | master not leader for 5m                    |

Grafana 11 OSS has no built-in alert routing without an integration point;
the Prometheus rule evaluation is the durable layer.

## Gotchas (learned on the reference deployment)

- **percona/mongodb_exporter 0.43 ships most collectors OFF by default**
  (a default run answers only `mongodb_up` + go/process metrics). The
  `--collector.*` toggles in `compose.yaml` are part of the supported surface.
- **node-exporter mounts the host `/` read-only** — this stack must run where
  you are allowed to monitor the host.
- **Grafana admin e-mail**: `GF_SECURITY_ADMIN_EMAIL` is honored only when
  Grafana *creates* the admin (fresh `grafana-data` volume); it never rewrites
  an existing user row. The reset-password mail endpoint answers 200 even when
  no user matches (anti-enumeration) — set the e-mail before relying on it.
- **Subpath serving** (behind an nginx facade): set `GRAFANA_SERVE_FROM_SUB_PATH=true`
  + `GRAFANA_ROOT_URL=https://<site>/grafana/`, and change the `grafana`
  scrape job's `metrics_path` to `/grafana/metrics` (plain `/metrics` 301s to
  the public URL, which breaks in-network scrapes).
- `grafana-data` / `prometheus-data` are named volumes — wiping them resets
  the admin account / TSDB; dashboards re-provision automatically (file
  provider, 30s poll).

## Testing

`test/run.sh` (or `make -C server-ce test-sensor`) is a deterministic
integration test. It starts a throwaway fixture (mongo + redis with KNOWN
counts, a filestore dir of known size), runs this bundle against it on its
own network, and asserts:

- the sensor's gauges are EXACTLY the seeded values (totals, standard/guest
  split, active window, `du` of the filestore dir, redis ram/disk)
- probe isolation: killing the fixture redis degrades only the redis probe
  (`/metrics` still 200, other gauges intact, `errors_total` increments),
  the sensor recovers when redis returns
- Prometheus: `up==1` for the live jobs, `up==0` for the jobs whose targets
  do not exist here; `MonitoringTargetDown` and `InstanceSensorProbeFailing`
  fire accordingly
- Grafana: health, provisioned datasource, provisioned dashboard load
- concurrent scrapes (single-flight) all answer

Takes a few minutes, leaves no containers/networks behind, and is safe to
re-run any time.

## Instance status in the Overleaf admin UI

The Overleaf web app ships an admin-only **Instance status** page
(`/admin/status`, link in the navbar's Admin dropdown) that shows this
stack's overview dashboard in a full-screen, same-origin iframe — site
admins see the monitoring without any Grafana login, regular users never
see the menu item, and the browser never talks to Grafana directly (no
mixed-content, no public Grafana route).

How it works (the `admingrafana` pattern from the OlliTeX toolkit era):

- The web app's `monitoring` module proxies `/admin/status/grafana/**`
  with **server-side Basic auth** (`GRAFANA_ADMIN_USER` /
  `GRAFANA_ADMIN_PASSWORD` from the web app's env, same credentials as the
  `GRAFANA_ADMIN_PASSWORD` in this `.env`).
- Grafana is configured to serve under that subpath:
  `GRAFANA_SERVE_FROM_SUB_PATH=true` +
  `GRAFANA_ROOT_URL=https://<site>/admin/status/grafana/` (both set in the
  test `.env` above), so every asset/API call the embedded UI makes stays
  under the proxied prefix.
- Wiring it up in the web app's env:
  `GRAFANA_INTERNAL_URL=http://grafana:3000` (server-reachable URL),
  `GRAFANA_PUBLIC_BASE_URL=https://<site>`, plus the admin credentials.

The `:3000` Grafana port stays for admin/debug only; the public route is the
app's `/admin/status`.

## Layout

```
prometheus-probe-grafana/
├── compose.yaml                  # the whole stack, one project
├── env.sample                    # every setting, documented
├── prometheus/
│   ├── prometheus.yml            # scrape config (env-driven targets) + rule_files
│   └── prometheus.rules.yml      # alert rules
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/prometheus.yml   # pinned uid `prometheus`
│   │   └── dashboards/overleaf.yml      # file provider (folder "Overleaf")
│   └── dashboards/
│       └── overview.json         # "Overleaf — instance overview" (access: public, kiosk embed)
└── instance-sensor/
    ├── Dockerfile                # node:22-alpine, deps installed in-image
    ├── package.json              # mongodb + ioredis only
    └── sensor.mjs                # the exporter (single file)
test/
├── run.sh                        # deterministic integration test (make test-sensor)
├── fixture-compose.yaml          # throwaway mongo + redis fixture
├── seed.js                       # known user/project/doc counts
└── env.test                      # test env template (ports 19090/13000)
```
