# clsi-cache

Stores the outputs of the most recent compiles of every project so that

- the editor can show the last PDF right after opening a project, before
  compiling (`GET /project/:id/output/cached/output.overleaf.json` in web),
- a clsi instance that has never seen a project can restore the compile
  directory from the last build instead of compiling from scratch,
- projects created from a template or by cloning start out with a PDF.

The clients live in `services/clsi/app/js/CLSICacheHandler.js` and
`services/web/app/src/Features/Compile/ClsiCache*.mjs`; this service
implements the other side of that protocol.

## Protocol

| Request | Purpose |
| --- | --- |
| `POST /enqueue` | clsi announces a finished build. The listed files are pulled from the clsi download host (or linked from disk, see below) in the background. |
| `GET /project/:id[/user/:uid]/latest/output/:file` | Redirect to the file of the most recent build that has it, plus `X-All-Files`, `X-Last-Modified`, `X-Content-Length`, `X-Shard`, `X-Zone`. |
| `GET /project/:id[/user/:uid]/build/:editorId-:buildId/search/output/:file` | Same for a specific build. |
| `GET /project/:id[/user/:uid]/build/:editorId-:buildId/output/:file` | Serves the file (target of the redirects with the fs backend). |
| `DELETE /project/:id[/user/:uid]/output` | Drop everything cached for the project ("clear cached files"). |
| `POST /project/:id/user/:uid/import-from` | Seed a new project from another project's latest build or from a template. |
| `POST /submission/:id/build/:editorId-:buildId/export-as-template` | Publish a template compile as the seed for projects created from it. |

Only `output.pdf`, `output.log`, `output.synctex.gz`, `*.blg`,
`output.overleaf.json`, `output.tar.gz` and `history-resync.json.gz` are
accepted, mirroring `isAllowedFilename` in web.

## Storage

Files go through `@overleaf/object-persistor` (`CLSI_CACHE_BACKEND`: `fs`,
`s3` or `gcs`) under `project/<projectId>[-<userId>]/build/<editorId>-<buildId>/`
and `template/<templateVersionId>/<imageName>/`. Builds expire after 8 days
(`CLSI_CACHE_BUILD_EXPIRY_MS`) and at most 2 builds per project are kept
(`CLSI_CACHE_MAX_BUILDS_PER_PROJECT`).

When clsi runs on the same host, point `CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR` at
its output directory: outputs are then hard-linked into the cache instead of
being downloaded, so the data exists once on disk until clsi expires its copy.
The fallbacks are per file: outputs that are not on the local disk are fetched
over http from the download host named in the notification, and hard-linking
across filesystems degrades to a copy — so remote clsi instances work without
any of this configured.

## Environment variables

For this service:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LISTEN_ADDRESS` | `127.0.0.1` | Bind address (port is fixed at 3044). |
| `CLSI_CACHE_SHARD` | `clsi-cache-<hostname>` | Shard name reported in `X-Shard`. Must equal the `shard` field of this instance's entry in `CLSI_CACHE_INSTANCES`, and must keep the `clsi-cache-` prefix (or be `cache`) — the frontend recognises cache urls by it. |
| `ZONE` | `local` | Reported in `X-Zone`; only meaningful with a zoned multi-instance setup. |
| `CLSI_CACHE_DATA_PATH` | `<service>/cache` | Where the fs backend stores the cache. (Not `CLSI_CACHE_PATH` — clsi already uses that name for its own disk cache.) |
| `CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR` | unset | clsi's output directory on the same host. Set: hard-link/copy outputs from disk. Unset or empty: fetch them over http from the download host. |
| `CLSI_CACHE_PUBLIC_URL` | request host | Base url used in redirects; only needed when web/clsi reach this service through an address it cannot infer from the request. |
| `CLSI_CACHE_BACKEND` | `fs` | `fs`, `s3` or `gcs`. S3/GCS use the same `AWS_*`/`GCS_*` variables as filestore. |
| `CLSI_CACHE_INGEST_CONCURRENCY` | `4` | Parallel file ingests. |
| `CLSI_CACHE_DOWNLOAD_TIMEOUT_MS` | `30000` | Timeout per file download from clsi. |
| `CLSI_CACHE_BUILD_EXPIRY_MS` | 8 days | Build retention (keep in sync with `clsiCacheExpiryInSeconds` in web's ClsiManager). |
| `CLSI_CACHE_MAX_BUILDS_PER_PROJECT` | `2` | Builds kept per project, mirroring clsi's `CACHE_LIMIT`. |
| `CLSI_CACHE_SWEEP_INTERVAL_MS` | 10 min | Expiry sweep interval; `0` disables the sweeper. |

For the consumers (this is what actually switches the feature on):

| Variable | Read by | Purpose |
| --- | --- | --- |
| `CLSI_CACHE_INSTANCES` | web + clsi | JSON list of instances, e.g. `[{"url":"http://127.0.0.1:3044","shard":"clsi-cache-local"}]`. Setting it enables every cache code path; unset disables all of them. |
| `CLSI_CACHE_CURRENT_SHARDS` / `CLSI_CACHE_DESIRED_SHARDS` | clsi | How many of the listed shards receive writes; set both to the instance count (plus `CLSI_CACHE_RESHARD_FROM/UNTIL` when migrating between counts). |
| `CLSI_CACHE_POPULATE_FOR_STANDARD_COMPILES` | clsi | Default `true`: also upload the PDF batch for `standard` compiles. Set `false` to restore the SaaS behaviour of skipping free compiles. |
| `CLSI_CACHE_ENABLED` | server-ce image only | `env.sh` master switch (default `true`): derives all of the above for the single-container deployment. |

## Shards: how clsi, web and the instances find each other

`CLSI_CACHE_INSTANCES` is the only registry. One entry is one instance is one
shard; `url` is where it listens, `shard` is its name. The invariant that
everything below relies on: the `shard` of an entry equals the
`CLSI_CACHE_SHARD` of the process behind its `url`.

```
CLSI_CACHE_INSTANCES = [ {url: A, shard: "clsi-cache-a"},      index 0
                         {url: B, shard: "clsi-cache-b"},      index 1
                         {url: C, shard: "clsi-cache-c"} ]     index 2

                 write path (clsi)                       read path (web)
                 ─────────────────                       ───────────────
   compile done                                    editor opens project
        │                                                   │
        ▼                                                   ▼
 idx = crc32(projectId) % N ──► entry[idx]       shuffle the list, try each url
        │                                          until one answers 302 or 404
        ├─ POST entry.url/enqueue                           │
        └─ return entry.shard ─────┐                        ▼
                                   │              response carries X-Shard
   compile response                │                        │
   { clsiCacheShard: "clsi-cache-b" } ◄─────────────────────┘
        │
        ▼
   frontend: ?clsiserverid=clsi-cache-b on PDF urls
   web (import-from / export-as-template):
        instances.find(i => i.shard === "clsi-cache-b").url   ← name → url
```

Reads never depend on the name (web asks every instance); writes and the
name→url reverse lookup do, which is why a mismatched `CLSI_CACHE_SHARD`
breaks template/clone pre-warming while plain compiles keep working.

The hash is only used at write time. A build remembers its shard name, and
a shard that is down is skipped via a circuit breaker (`crc32(projectId-1)`,
`-2`, ... over the remaining entries), so losing one instance only moves that
instance's projects.

## Resharding: CURRENT_SHARDS, DESIRED_SHARDS, RESHARD_FROM/UNTIL

Changing N changes `crc32 % N` for most projects at once. clsi therefore
does not switch abruptly; it moves projects over during a time window:

```
   INSTANCES list  : [ a, b, c ]        (c newly added)
   CURRENT_SHARDS  : 2   ──► clsi hashes over [a, b]
   DESIRED_SHARDS  : 3   ──► clsi hashes over [a, b, c]

   percentile p = (last 4 bytes of the project's ObjectId) % 100   (stable per project)

   share of projects
   using DESIRED
   100% ┤                                   ┌──────────────
        │                               ╱
        │                           ╱        p > (UNTIL - now) / (UNTIL - FROM)
        │                       ╱            → this project uses DESIRED
        │                   ╱
     0% ┼───────────────┘
        └───────────────┬───────────────────┬────────────► time
                   RESHARD_FROM        RESHARD_UNTIL

   before FROM : everyone on CURRENT
   in window   : projects flip to DESIRED in order of p, linearly over the window
   after UNTIL : everyone on DESIRED  → operator sets CURRENT=3 and drops the window
```

A project flips once and stays flipped (its percentile does not change), so
the cache misses caused by the remap are spread over the window instead of
hitting every project at the same moment.

Single instance: `CURRENT_SHARDS=DESIRED_SHARDS=1`, no window. The values
still have to be set — clsi reads them with `parseInt`, and an unset variable
yields `NaN`, `slice(0, NaN)` is an empty list and no shard is ever selected.

## Scaling out

Any number of clsi instances can share one cache instance (the default http
pull mode). For more than one cache instance, use a shared `s3`/`gcs` backend:
the instances then answer lookups for each other's ingests. Running multiple
instances on disjoint `fs` disks is NOT supported: unlike the upstream
service, there is no coordinator that fans lookups out to the other instances,
so web would find cached builds only by chance (clsi itself is unaffected — it
picks the shard deterministically).
