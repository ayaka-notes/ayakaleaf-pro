# WebDAV test fixture

**Ubuntu 26.04 packaged Apache 2 (2.4.66, `dav` + `dav_fs` + `dav_lock`)** —
a conformant, deterministic WebDAV server that speaks exactly the surface the
Overleaf WebDAV client (`go/services/web/features/webdav`) sends, so the
fixture pins real interop behavior instead of an nginx/rclone quirk.
Single `FROM ubuntu:26.04@sha256:3595d7fc…` + `apt install apache2` — no
source builds, identity baked at build time, no runtime env.

## Why this server (measured on this host, 2026-10-02/03)

The client contract that drives everything (from `client.go` + `sync.go`):

- sends `MKCOL` / `PROPFIND` **on noslash paths** and tolerates exactly
  `{2xx, 405 already-exists}` → a server that `301`s a noslash collection
  URI breaks `createDirectory()` (Go's `net/http` follows a 301 as a `GET`,
  dropping the body);
- `PROPFIND Depth:1` must return the **self-entry plus children** (client
  `list()` skips the self-entry);
- a **well-formed qualified PROPFIND body** (`<propfind><prop>…</prop></propfind>`,
  RFC 4918 §14.2) is required — lenient servers accept a bare `<prop>`,
  conformant servers 400 it (this is exactly the bug the old nginx fixture
  masked; see "Client bug caught by this fixture" below);
- anonymous → `401`; `Basic` auth enforced.

Gate battery (the client's exact verb set) — family verdicts:

| Server | MKCOL noslash (new/exist) | PROPFIND D1 children | PUT/GET | auth | verdict |
|---|---|---|---|---|---|
| **Ubuntu 26.04 apache2 (2.4.66)** | 201 / 405 | 207 self+children | 201/200 round-trip, weak ETag | 401 anon, 412 stale If-Match | **PASS — chosen** (15/15 Go-client contract + 20/20 stability loops) |
| apachewebdav (Apache 2.4.43) | 201 / 405 | 207 | 201/200 | non-deterministic 401 windows under repeated probes | rejected (not a deterministic oracle) |
| nginx-dav | **409/301** (trac #1966) | 207 | 201 | 401 | rejected (blocks `createDirectory` after the first MKCOL) |
| Debian `apache2` (bookworm/trixie) | **500** (lock store: apr-util packaging lacks the dbm API / DBD wiring dead end) | — | 500 | 401 | rejected |
| `httpd:2.4-alpine` | **500** (`mod_dav_fs` undefined `apr_dbm_*` vs bundled apr 1.6) | — | 500 | — | rejected (dead end) |
| mogeko/rshs | 201 / 405 | **SELF-ENTRY ONLY** (Depth ignored) | 201 | 401 | rejected (never lists children) |

### Ubuntu 26.04 specifics (each one bit us during bring-up)

- `dav_lock` in 2.4.66 is the **generic DBM store**: the directive is
  **`DAVGenericLockDB`** (NOT `DavLockDB`/`DBDSetup` — `Invalid command`);
  `mod_dbd`'s directive set is `DBDMin/DBDMax/DBDParams/DBDPersist/DBDriver`
  and is not needed at all.
- authz spelling is **`Require valid-user`** (hyphen).
- the vhost `DocumentRoot` must be the DAV root — otherwise every op is 405.
- `apachectl -DFOREGROUND` is the container entrypoint.
- auth file: chown `www-data` (640 root:root = `Could not open password file`).

## Client bug caught by this fixture (2026-10-03)

The old Go client sent PROPFIND bodies as a **bare `<d:prop>`** element —
invalid per RFC 4918 §14.2 (must be wrapped in `<propfind>`). nginx (and
rshs) tolerated it; Ubuntu's `mod_dav` answers it **400 Bad Request**, which
broke `list()`/`check()`/import against any conformant provider. Fixed in
`helpers.go` (`propfindDepth0/1` now carry the `<d:propfind>` wrapper);
verified: bare body → 400, wrapped body → 207; `go test` green; import B4
green on live overleaf.

## File layout

| File | Purpose |
|---|---|
| `Dockerfile` | `ubuntu:26.04@digest` + packaged apache2 + dav/dav_fs/dav_lock, identity baked, `httpd` configtest build gate |
| `dav-site.conf` | the DAV site config (auth, `Dav on`, `DAVGenericLockDB`, `DirectorySlash Off`, `Require valid-user`) |
| `docker-compose.yml` | `webdav-test` on `127.0.0.1:8095→80`, named data volume, overleaf-network attach for Part B |
| `run_webdav_test.py` | harness — Part A (raw DAV) + Part B (Overleaf webdav module incl. import) |
| `.gitignore` | logs/pycache |

## Setup

```bash
cd tests/tools/webdav
docker compose up -d --build          # builds the image (fast: all packaged)
docker compose ps                     # webdav-test (healthy)
# attach to the overleaf network for the IN-CONTAINER bridge URL (Part B):
docker network connect overleaf-network webdav-test   # idempotent
```

Fixture identity (test-only dummy, baked into the image):
`oltest` / `Ol-Fixture-Wd7q`. Base (host view) `http://127.0.0.1:8095`.
In-container base (overleaf's view) `http://webdav-test` — the harness
auto-detects name resolution via `overleafserver getent hosts`.

## Run

```bash
# Part A only (raw DAV conformance — no overleaf needed)
SKIP_PART_B=1 python3 run_webdav_test.py

# Full: Part A + Part B (Overleaf webdav integration)
OLI_BASE=http://127.0.0.1:4000 \
OLI_EMAIL=<dev-user> OLI_PASS=<dev-pass> \
python3 run_webdav_test.py
```

Stdlib-only. Part B reuses the sibling `../forgejo` fixture's
proven `Session`/login/CSRF stack.

## Pinned behavior (what the harness asserts)

Part A (the raw DAV surface the client sends):
- A0 preflight: authenticated `PROPFIND /` stable (5×207)
- A1 `PROPFIND / depth0` → `207 multistatus` (client `check()`)
- A2 anonymous → `401`
- A3 `MKCOL` noslash: new→`201`, existing (noslash AND slash)→`405`,
  missing-parent→`409`
- A4 `PUT` (parent exists)→`201` + `GET` round-trip + weak `ETag` present
- A5 `PROPFIND Depth:1` → `207` with self-entry + children (client `list()`)
- A6 `If-Match` ENFORCED (`412` for bogus etag, RFC 7232) — inert for the
  product: every `cl.put` caller passes a nil etag (`sync.go`)
- A7 `DELETE`→`204`; `GET` after → `404` (client `remove()`)

Part B (Overleaf `webdav` module; needs a live overleaf + dev user):
- B0/B1 disconnect + `status` (`{"connected":false}`)
- B2 `connect{baseUrl,rootPath,username,password}` + status echo
- B3 seed remote tree (parents MKCOL'd — strict family) under
  `<rootPath>/<proj>/` (`hello.txt`, `sub/notes.txt`, `chapter.tex`)
- B4 `import POST /project/new/webdav` → `200` + project **created**
  (project row + ingested remote tree — `hello.txt`/`notes.txt` in
  `files[]`, `chapter.tex` in `docs[]` — + `webdavsyncprojectstates`
  row owned by the importer)
- B5 `push` → `200 Push completed`, files intact on the server
  (`createDirectory` sees `MKCOL 201` fresh / `405` re-push, both tolerated)
- B5b `push .tex` → remote `chapter.tex` body == docstore seed
  (docstore-backed parity: import writes `docs[]` + docstore body from the
  remote `.tex`; push exports `docs[]` back from docstore — exact
  `\n`-split/join round-trip)
- B6 `pull` → `200 Pull completed`, remote-only new file ingested
- B7 unlink state; (OLI_CLEANUP=1) `DELETE /Project/:id`
- B8 disconnect → status `connected:false`

## Documented parity status (2026-10-03, live-verified)

- **`.tex` import + push: WORKING** — import ingests the remote `.tex` into
  `docs[]` + a docstore body; push exports `docs[]` back from docstore
  (B5b pins byte-parity). Measured: docstore vN → push 200 → remote body
  identical.
- **non-`.tex` file bodies: documented gap** — import writes the tree entry
  (`files[]`) only; the filestore body is not materialized. Push therefore
  SKIPS contentless non-`.tex` entries (nil-body guard in `wdSyncProject`) —
  it never PUTs an empty body that would truncate the remote file.
- **nested imports = flat basenames** — `sub/notes.txt` ingests as
  `notes.txt` in `files[]`; folder nesting is not materialized (parity gap
  under owner option (a) import-creates).
- **mongo driver v2 gotcha (product)** — BSON arrays decode as `bson.A`
  (a defined type): `[]interface{}` assertions silently fail. The push
  walker went through this (exported zero entries ⇒ push 200 with zero
  PUTs). `wdAsSlice` accepts both shapes; `tree_shape_test.go` pins the
  `docs[]`/`files[]` export contract.
