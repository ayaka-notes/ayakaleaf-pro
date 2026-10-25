# SeaweedFS S3 Server (Docker Compose)

A small single-node SeaweedFS cluster with a hosted S3 API. It serves as the
S3 backend (filestore *and* history). 

All four services share one image (`chrislusf/seaweedfs:latest`); the root
`compose.yaml` merges them from the per-service files with `extends:`.

## Layout

```
.
├── compose.yaml                    # root compose (merges the 4 services, depends_on order)
├── seaweedfs-master/compose.yaml   # cluster metadata          + data/ (persisted)
├── seaweedfs-volume/compose.yaml   # data bricks               + data/ (persisted)
├── seaweedfs-filer/compose.yaml    # file namespace            + data/ (persisted)
├── seaweedfs-s3/compose.yaml       # S3 API gateway (no data dir)
├── .env / env.sample               # S3 credentials (never commit .env)
├── 0_pull_other_containers.sh      # setup: pull the shared image
├── 1_install_aws.sh                # setup: awscli on the host
├── 2_create_s3_buckets.sh          # setup: create the Overleaf buckets (idempotent)
├── 3_online_backup_s3.sh           # backup: metadata snapshot + bucket sync
├── autoupdate_seaweedfs-*.sh       # update: one service at a time, only if image is newer
├── up.sh / down.sh                 # whole stack up / down
└── up|down|logs_seaweedfs-*.sh     # per-service shortcuts
```

## Services, ports, network aliases

Start-up order is enforced with `depends_on ... condition: service_healthy`:
`master` → `volume` → `filer` → `s3`.

| Service            | Network alias | Host ports (host → container)                  | Role                          | Healthcheck               |
|--------------------|---------------|------------------------------------------------|-------------------------------|---------------------------|
| `seaweedfs-master` | `master`      | `9333` (master HTTP API), `19333` (master gRPC), `9327` (Prometheus metrics) | cluster metadata      | `:9333/cluster/healthz`   |
| `seaweedfs-volume` | `volume`      | `18080` → `8080` (volume gRPC; host `8080` is taken by another service)      | data bricks             | `:8080/status`            |
| `seaweedfs-filer`  | `filer`       | `8888` (filer HTTP), `18888` (filer gRPC)      | file namespace / directories  | `:8888/`                  |
| `seaweedfs-s3`     | `s3`          | `8333` (S3 API)                                | S3 gateway for AWS-SDK clients | `:8333/` answers HTTP    |

**Where the aliases resolve (common gotcha):**

- The aliases (`s3`, `filer`, `master`, `volume`) are registered on the
  compose network (default project network of this folder, i.e.
  `s3_server_compose_default`).
- ✅ They resolve from **any container attached to that network** — that is
  why `http://s3:8333` works in the Overleaf config below. Check with
  `docker exec seaweedfs-filer ping -c1 s3` (must reply from the stack IP).
- ❌ They do **not** resolve from the host machine — Docker's embedded DNS
  exists only inside the network. From the host, always use the published
  ports, e.g. `http://localhost:8333` (your `2_`/`3_` scripts already do this).
- A container on a *different* network cannot reach the aliases at all; it
  must either be attached to this network (`docker network connect
  s3_server_compose_default <container>`) or use `http://<host>:8333`.

## First-time setup

```bash
cp env.sample .env          # then fill in keys (generation one-liners are in the file)
./0_pull_other_containers.sh
./1_install_aws.sh          # installs awscli via apt on the host
./up.sh                     # = docker compose up -d  (wait until all 4 are healthy)
./2_create_s3_buckets.sh    # idempotent: creates the 4 Overleaf buckets if missing
```

Verify:

```bash
docker ps | grep seaweedfs                          # 4 × healthy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8333/   # 403 = S3 API answers (expected)
```

The Overleaf buckets created by `2_create_s3_buckets.sh`:

`overleaf-user-files`, `overleaf-template-files`, `overleaf-project-blobs`, `overleaf-chunks`

## Overleaf integration

For the Overleaf container compose.yaml file (it is assume that the overleaf compose contains AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY):

```
      #########################################
      ## Overleaf Filestore S3 Configuration ##
      #########################################

      OVERLEAF_FILESTORE_BACKEND: s3
      OVERLEAF_FILESTORE_USER_FILES_BUCKET_NAME: overleaf-user-files
      OVERLEAF_FILESTORE_TEMPLATE_FILES_BUCKET_NAME: overleaf-template-files

      OVERLEAF_FILESTORE_S3_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      OVERLEAF_FILESTORE_S3_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      OVERLEAF_FILESTORE_S3_ENDPOINT: http://s3:8333
      OVERLEAF_FILESTORE_S3_PATH_STYLE: "true"
      OVERLEAF_FILESTORE_S3_REGION: "us-east-1"

      #########################################
      ## Overleaf History S3 Configuration   ##
      #########################################

      OVERLEAF_HISTORY_BACKEND: s3
      OVERLEAF_HISTORY_PROJECT_BLOBS_BUCKET: overleaf-project-blobs
      OVERLEAF_HISTORY_CHUNKS_BUCKET: overleaf-chunks

      OVERLEAF_HISTORY_S3_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      OVERLEAF_HISTORY_S3_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      OVERLEAF_HISTORY_S3_ENDPOINT: http://s3:8333
      OVERLEAF_HISTORY_S3_PATH_STYLE: "true"
      OVERLEAF_HISTORY_S3_REGION: "us-east-1"
```

Notes:

- `http://s3:8333` relies on the `s3` network alias — it only works while the
  Overleaf **server container is attached to this stack's network**
  (same compose network as the `seaweedfs-*` containers).
- If the Overleaf server runs elsewhere (other host, other compose network),
  replace the endpoint with `http://<reachable-host>:8333` in both
  `OVERLEAF_FILESTORE_S3_ENDPOINT` and `OVERLEAF_HISTORY_S3_ENDPOINT`.
- `OVERLEAF_*_S3_PATH_STYLE: "true"` is required (SeaweedFS is a virtual-host
  style-incompatible gateway), and the region value is cosmetic for a local
  gateway but must be set consistently.

## Scripts

### Setup (numbered)

| Script                    | What it does |
|---------------------------|--------------|
| `0_pull_other_containers.sh` | `docker pull chrislusf/seaweedfs:latest` — all four services share this one image, so a single pull covers the whole stack. |
| `1_install_aws.sh`        | Installs `awscli` on the host via `apt` (needed by the bucket/backup scripts, which use `aws s3` locally). |
| `2_create_s3_buckets.sh`  | Loads `.env`, checks reachability of `http://localhost:8333`, then creates the four Overleaf buckets if they don't exist yet. **Idempotent** — safe to re-run. |
| `3_online_backup_s3.sh`   | **Online** backup (no downtime): ① snapshots filer metadata into the running filer via `weed shell` (`fs.meta.save`, reached through the `master:9333` alias), ② `aws s3 sync`s all four buckets into `./backup_seaweedfs_online/<TIMESTAMP>/<bucket>/`. |

### Updates

| Script                        | What it does |
|-------------------------------|--------------|
| `autoupdate_seaweedfs-master.sh` / `…-volume.sh` / `…-filer.sh` / `…-s3.sh` | Pulls the latest image, compares the short image ID of the running container with the local one; if unchanged → no-op, if newer → `docker compose down` + `up -d` **of that service only**; if the container is missing → just starts it. Sources `.env` first. |

> The autoupdate scripts `cd "$COMPOSE_DIRECTORY"` before calling
> `docker compose`, which now defaults to the **current directory**
> (`${COMPOSE_DIRECTORY:-$(pwd)}`). Just run them from this folder,
> or point `COMPOSE_DIRECTORY` somewhere else to override.

To update the whole stack, run the four in this order: `master` → `volume` →
`filer` → `s3`.

### Everyday

| Script                          | Equivalent |
|---------------------------------|------------|
| `up.sh` / `down.sh`             | `docker compose up -d` / `docker compose down` |
| `up_seaweedfs-<svc>.sh`         | `docker compose up -d <svc>` |
| `down_seaweedfs-<svc>.sh`       | `docker compose down <svc>` |
| `logs_seaweedfs-<svc>.sh`       | `docker compose logs -f <svc>` |

## Data & operations

- Persistent data: `seaweedfs-master/data/`, `seaweedfs-volume/data/`,
  `seaweedfs-filer/data/` (bind-mounted at `/data` in each container).
  The S3 gateway needs no data dir. Back up the **volume** data dir (the
  actual file bytes) — metadata + buckets are reconstructed/synced by the
  other pieces.
- All services run `restart: unless-stopped`; healthchecks per the table
  above gate the start-up order and `depends_on`.
- Metrics: Prometheus endpoint at `http://localhost:9327` (master).
- Security: the S3 gateway binds `0.0.0.0:8333` — the keypair in `.env` is
  the only gate (plus a `403` on anonymous requests). Keep `.env` private
  (already git-ignored) and firewall `8333` if this host is reachable from
  the network.
