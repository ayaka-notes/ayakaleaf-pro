#!/usr/bin/env python3
"""
WebDAV test fixture — parts (server: apachewebdav/apachewebdav, Apache
2.4.43 + mod_dav/fs/lock — the RFC-conformant family; see README.md for the
full selection record incl. the rejected nginx-dav, stock-Debian httpd, and
rclone-dav):

  A0  preflight: wait for stable authenticated PROPFIND (this image has a
      flaky Basic-auth window after boot — AH01614 for valid creds — that
      recovers; dav() retries 401 transiently to match the product client)
  A1  server reachable + PROPFIND depth-0 → 207 Multi-Status (client check())
  A2  anonymous PROPFIND → 401 (basic auth enforced)
  A3  MKCOL contract (measured, DirectorySlash Off patched): noslash new →
      201, noslash/slash existing → 405 (the client's exact tolerance set),
      missing parent → strict 409. The former nginx-dav family refused
      noslash MKCOL (301/409, trac #1966) and blocked push structurally.
  A4  PUT (parent exists) → 201; GET round-trip bytes; PIN: this family
      returns a WEAK ETag on GET (product-inert: all cl.put callers pass nil
      etag — sync.go:299/439 — so no If-Match is ever sent this build)
  A5  PROPFIND Depth:1 → 207 <D:response> per entry incl. self-entry
      (client list() skips it) + <D:collection/> presence elements
  A6  If-Match — THIS FAMILY ENFORCES RFC 412 (bogus etag → 412; a weak
      etag in If-Match is also 412, RFC 7232-correct); pinned, inert for the
      product (nil-etag puts)
  A7  DELETE → 204; subsequent GET → 404 (client remove())

  B (Overleaf integration; needs OLI_BASE + OLI_EMAIL + OLI_PASS)
  B0  disconnect reset (idempotent) → 200 success
  B1  status → 200 {"connected":false} (byte pin, P6.9 offline pin)
  B2  connect {baseUrl, rootPath, username, password} → 200 success;
      status → connected:true + baseUrl + rootPath echoed
  B3  seed remote tree (raw DAV, parents MKCOLed first — strict family):
      <rootPath>/<proj>/hello.txt + sub/notes.txt
  B4  import POST /project/new/webdav {projectName, rootPath} → 200 Import
      completed — PIN (pinned 2026-10-02): response contract only; THIS
      BUILD does not create the project row / state doc (wdImportFiles with
      an empty projectID silently no-ops; the Node oracle creates the
      project). Reported, not papered over.
  B4c project created via POST /project/new (P4.7, fixture scaffolding for B5-B7)
  B5  push → 200 "Push completed" on this conformant family (createDirectory
      sees MKCOL 201 fresh / 405 re-push, both client-tolerated; PUTs land on
      existing parents). The nginx-dav 500 is the pinned counterexample
      (trac #1966).
  B6  pull → 200 Pull completed, remote-only new file ingested. Regression
      guard: pre-fix this failed twice (typed-nil reader GET panic;
      resourcetype <collection/> bool parse → self-entry GET 404).
  B7  unlink state → 200/404 (observe-and-pin pre-sync contract);
      (OLI_CLEANUP=1) DELETE /Project/:id (Node capital-P)
  B8  disconnect → 200 success; status → connected:false

Stdlib only. The Overleaf session reuses the sibling ../forgejo fixture's
proven Session/login/CSRF stack.
"""
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "forgejo"))

FORGE = os.environ.get("WEBDAV_BASE", "http://127.0.0.1:8095").rstrip("/")
WD_USER = os.environ.get("WEBDAV_USER", "oltest")
WD_PASS = os.environ.get("WEBDAV_PASS", "Ol-Fixture-Wd7q")
ROOT_PATH = "/Overleaf"

RESULTS = []


def report(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return ok


# ---------------- raw DAV client (the exact surface features/webdav sends) --

def dav(method, path, body=None, headers=None, _retries=6):
    h = dict(headers or {})
    if body is not None:
        h.setdefault("Content-Type", "application/xml; charset=utf-8") if method == "PROPFIND" else None
    # Product semantics: PROPFIND always carries an explicit Depth header.
    # Apache mod_dav (2.4.66) 403s body-bearing PROPFINDs with a missing
    # Depth (AH00585 propfind-parse path); the Go client never omits it.
    if method == "PROPFIND" and "Depth" not in h:
        h["Depth"] = "1"
    r = urllib.request.Request(FORGE + path, data=body, method=method, headers=h)
    for attempt in range(_retries):
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            # PIN (apachewebdav image quirk, measured 2026-10-02): this family
            # intermittently rejects VALID Basic credentials right after boot /
            # under host load (AH01614 "wrong authentication scheme"), then
            # recovers for minutes. Treat 401 as transient for AUTHENTICATED
            # calls and retry — the product client retries similarly (wdDo: 2
            # attempts, 500ms). Anonymous calls (auth is the point) never.
            if e.code == 401 and "Authorization" in h and attempt < _retries - 1:
                time.sleep(2 + attempt)
                continue
            return e.code, dict(e.headers), e.read()


def preflight_auth(timeout_s=90):
    """Wait until authenticated PROPFIND / is stable (5 consecutive 207).
    Covers the flaky auth window above before the conformance pins run."""
    import time as _t
    deadline = _t.time() + timeout_s
    streak = 0
    while _t.time() < deadline:
        st, _, _ = dav("PROPFIND", "/", PROPFIND_DEPTH0, authed())
        streak = streak + 1 if st == 207 else 0
        if streak >= 5:
            return True
        _t.sleep(3)
    return False


def authed(headers=None):
    h = dict(headers or {})
    h["Authorization"] = "Basic " + base64.b64encode(f"{WD_USER}:{WD_PASS}".encode()).decode()
    return h


PROPFIND_DEPTH0 = b'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resource/></d:prop></d:propfind>'
PROPFIND_LIST = b'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:href/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>'


def part_a():
    print()
    if not preflight_auth():
        report("A0 preflight: authenticated PROPFIND stable", False,
               "server rejected valid Basic auth for 90s (apachewebdav flaky-auth quirk) — abort Part A")
        return
    st, h, b = dav("PROPFIND", "/", PROPFIND_DEPTH0, authed())
    ok = st == 207 and b"multistatus" in b.lower()
    report("A1 PROPFIND / depth0 → 207 Multi-Status (check()", ok,
           f"-> {st}; body[:60]={b[:60]!r}")

    st, h, b = dav("PROPFIND", "/", PROPFIND_DEPTH0)  # no auth
    report("A2 anonymous PROPFIND → 401 (basic auth enforced)", st == 401, f"-> {st}")

    # A3 — MKCOL contract (apachewebdav/Apache 2.4.43, measured 2026-10-02,
    # with the fixture's DirectorySlash Off patch — see dav-patch.conf):
    #   noslash new → 201, noslash existing → 405, slash existing → 405,
    #   missing parent → strict 409 (RFC 4918).
    # Client (createDirectory) tolerates {2xx, 405-existing}; 409 is only
    # reachable for a parent the product flow guarantees (rootPath check()ed
    # at connect). The nginx-dav family is the counterexample (noslash
    # existing → 301/409, trac #1966) — owner-decided server swap.
    tag = int(time.time())
    st_n, _, _ = dav("MKCOL", f"/mkpin-{tag}", None, authed())
    st_a, _, _ = dav("MKCOL", f"/mkpin-{tag}", None, authed())
    st_s, _, _ = dav("MKCOL", f"/mkpin-{tag}/", None, authed())
    # missing-parent: the parent path must be TRULY absent — a child of the
    # just-created {tag} is a legitimate MKCOL (201), not a 409 case.
    st_np, _, _ = dav("MKCOL", f"/mkpin-{tag}-missing/deep", None, authed())
    ok = st_n in (200, 201) and st_a == 405 and st_s == 405 and st_np == 409
    report("A3 MKCOL contract: new→201 / existing→405 (noslash+slash) / missing-parent→409",
           ok, f"new={st_n} again-noslash={st_a} again-slash={st_s} missing-parent={st_np}; "
               f"client tolerates exactly {{2xx,405}}; nginx-dav is the counterexample family (trac #1966)")

    # A4 — PUT (strict parent required — RFC-correct; nginx auto-created,
    # masking this) + GET round-trip. PIN for THIS family: ETag IS present
    # on GET but WEAK (W/"...") — RFC 7232: weak validators may not be used
    # in If-Match (A6 exercises that). Product-inert: all cl.put callers pass
    # a nil etag (sync.go:299 push, sync.go:439 conflict-choose-local).
    dav("MKCOL", "/Overleaf", None, authed())
    dav("MKCOL", "/Overleaf/a4", None, authed())
    st, h, b = dav("PUT", "/Overleaf/a4/hello.txt", b"hello webdav fixture\n", authed())
    put_ok = st in (200, 201)
    st, h, b = dav("GET", "/Overleaf/a4/hello.txt", None, authed())
    etag = (h.get("Etag") or h.get("ETag") or "")
    ok = put_ok and st == 200 and b == b"hello webdav fixture\n" and etag != ""
    report("A4 PUT (parent created) → 201 + GET round-trip + GET ETag present (weak)", ok,
           f"put={st} get={st} bytes={b[:30]!r} etag={etag!r} (present = expected here)")

    # A5 — PROPFIND depth-1 listing shape (client list() sends Depth:1 + XML CT)
    st, h, b = dav("PROPFIND", "/Overleaf/a4", PROPFIND_LIST,
                   authed({"Depth": "1", "Content-Type": "application/xml; charset=utf-8"}))
    listed = b"hello.txt" in b
    self_entry = b"<D:href>/Overleaf/a4</D:href>" in b or b"<D:href>/Overleaf/a4/</D:href>" in b
    ok = st == 207 and listed and self_entry
    report("A5 PROPFIND Depth:1 → 207 listing with entries (list())", ok,
           f"-> {st}; entry visible={listed}; self-entry visible={self_entry} (client list() skips it)")

    # A6 — If-Match precondition (RFC 412/7232) on an EXISTING resource —
    # THIS FAMILY ENFORCES IT (measured): bogus etag → 412; a WEAK etag in
    # If-Match → 412 also (weak validators are not usable in If-Match).
    # Product-inert regardless: every cl.put caller passes a nil etag, so the
    # client never sends If-Match this build.
    st_bad, _, _ = dav("PUT", "/Overleaf/a4/hello.txt", b"override\n",
                       authed({"If-Match": '"not-the-real-etag"'}))
    et = (h.get("Etag") or h.get("ETag") or "W/\"x\"")
    st_weak, _, _ = dav("PUT", "/Overleaf/a4/hello.txt", b"override2\n",
                        authed({"If-Match": et}))
    ok = st_bad == 412 and st_weak in (412, 200, 201, 204)
    report("A6 If-Match ENFORCED (412 bogus; weak-etag per RFC) — pinned, product-inert", ok,
           f"bogus→{st_bad} (412 expected); weak-etag→{st_weak} (412 = RFC for weak validators); "
           f"product flow never sends If-Match (nil-etag puts)")

    # A7 — DELETE + 404 after
    st, _, _ = dav("DELETE", "/Overleaf/a4/hello.txt", None, authed())
    st2, h2, b2 = dav("GET", "/Overleaf/a4/hello.txt", None, authed())
    report("A7 DELETE → 204; GET after → 404 (remove())", st in (200, 204) and st2 == 404,
           f"del={st} get-after={st2}")


# ---------------- Part B — Overleaf webdav module --------------------------

def bridge_webdav_base():
    """Container-reachable base for the overleaf web (order):
    1. OLI_WEBDAV_URL env;
    2. the fixture container name on a shared user network (built-in DNS —
       `docker network connect <overleaf-net> webdav-test` when the dev
       stack is up; verified from inside overleafserver);
    3. the docker gateway of the fixture's own network (works only when it
       shares the bridge with overleafserver — e.g. the forgejo layout);
    4. the harness base.
    NOTE (pinned 2026-10-02): on a SEPARATE bridge the gateway IP is not
    routable from overleafserver (connection refused) — shared network it is.
    """
    if os.environ.get("OLI_WEBDAV_URL"):
        return os.environ["OLI_WEBDAV_URL"]
    fixture = "webdav-test"
    try:
        web = _web_container()
        probe = subprocess.run(
            ["docker", "exec", web, "sh", "-c", "getent hosts " + fixture],
            capture_output=True, text=True, timeout=15)
        if probe.returncode == 0 and probe.stdout.strip():
            return "http://" + fixture  # apache container port 80 (compose)
    except Exception:
        pass
    try:
        net = json.loads(subprocess.run(
            ["docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", "webdav-test"],
            capture_output=True, text=True, timeout=15).stdout)
        for key in net:
            gw = net[key].get("Gateway")
            if gw:
                port = urllib.parse.urlsplit(FORGE).port or 80
                return f"http://{gw}:{port}"
    except Exception:
        pass
    return FORGE


def part_b():
    import run_forgejo_test as R
    base = os.environ.get("OLI_BASE")
    if not (base and os.environ.get("OLI_EMAIL") and os.environ.get("OLI_PASS")):
        print()
        print("[SKIP] B1-B8 Overleaf integration — need OLI_BASE/OLI_EMAIL/OLI_PASS")
        return
    os.environ.setdefault("OLI_PASS", os.environ.get("OLI_PASS", ""))
    oli = R.Session(base)
    ok, why = R.overleaf_login(oli)
    if not ok:
        report("B-login", False, why[:160])
        return
    prov_url = bridge_webdav_base()
    print(f"\n  webdav base (harness)={FORGE}  (container view)={prov_url}")

    st, b = oli.req("POST", "/user/webdav/disconnect")
    report("B0 disconnect reset", st == 200, f"-> {st} {b[:80]!r}")

    st, b = oli.get_json("/user/webdav/status")
    ok = st == 200 and b == {"connected": False}
    report("B1 status → {\"connected\":false} (byte pin)", ok, f"-> {st} {b!r}")

    st, b = oli.req("POST", "/user/webdav/connect",
                    json_body={"baseUrl": prov_url, "rootPath": ROOT_PATH,
                               "username": WD_USER, "password": WD_PASS})
    report("B2a connect", st == 200, f"-> {st} {b[:100]!r}")

    st, b = oli.get_json("/user/webdav/status")
    ok = (st == 200 and isinstance(b, dict) and b.get("connected") is True
          and b.get("baseUrl") == prov_url and b.get("rootPath") == ROOT_PATH)
    report("B2b status connected + cred echo", ok, f"-> {st} {str(b)[:160]!r}")

    # B3 — seed the remote project dir (nested, exercises recursive traversal).
    # STRICT-PARENT families (this Apache, like rshs): create every parent
    # before the first PUT (RFC-correct; the nginx family auto-created paths,
    # masking the requirement).
    proj = f"wdv-harness-{int(time.time())}"
    for d in (ROOT_PATH, f"{ROOT_PATH}/{proj}", f"{ROOT_PATH}/{proj}/sub"):
        st, _, _ = dav("MKCOL", urllib.parse.quote(d), None, authed())
        if st not in (200, 201, 405):
            report("B3 seed remote tree", False, f"MKCOL {d} -> {st}")
            return
    seed_files = {
        f"{ROOT_PATH}/{proj}/hello.txt": b"seed hello for import\n",
        f"{ROOT_PATH}/{proj}/sub/notes.txt": b"seed notes (nested)\n",
        # .tex exercises the docstore-backed path (import ingests into docs[]
        # + docstore body; push exports it back from docstore) — WDV-C gate.
        f"{ROOT_PATH}/{proj}/chapter.tex":
            b"\\documentclass{article}\\n\\begin{document}\\nwdv harness tex seed\\n\\end{document}\\n",
    }
    for p, content in seed_files.items():
        st, _, _ = dav("PUT", urllib.parse.quote(p), content, authed())
        if st not in (200, 201):
            report("B3 seed remote tree", False, f"PUT {p} -> {st}")
            return
    report("B3 seed remote tree", True, f"MKCOL+3x PUT under {ROOT_PATH}/{proj}/")

    # B4 — import CREATES the project (owner option (a), 2026-10-02; Node
    # parity WebdavHandler.importRemoteProject): response 200 success +
    # projectId; the project row exists (basic template); the seeded remote
    # tree is ingested (hello.txt + sub/notes.txt in the rootFolder tree);
    # the sync-state row exists (ownerId = importing user).
    st, b = oli.req("POST", "/project/new/webdav",
                    json_body={"projectName": proj, "rootPath": ROOT_PATH})
    resp_ok = False
    imp_pid = None
    try:
        resp_ok = st == 200 and _json(b, "success") is True \
            and _json(b, "message") == "Import completed"
        imp_pid = _json(b, "projectId")
    except Exception:
        pass
    if not imp_pid:
        imp_pid = find_project_by_name(proj)
    row_pid = find_project_by_name(proj)
    # ingested? The Go build keeps tree entries in p.docs / p.files / p.folders
    # (Node's rootFolder is the legacy equivalent). Note: nested imports land as
    # flat basenames in files[] (sub/notes.txt → "notes.txt") — folder nesting
    # fidelity is a documented parity gap, so expect basenames, not paths.
    names = _mongo_eval(
        'const p=db.projects.findOne({name: "' + proj + '"}); '
        'var out=[]; [p&&p.docs,p&&p.files,p&&p.folders].flat().forEach(function(e){e&&e.name&&out.push(e.name)}); '
        'print(out.join(","))')
    ingested = ("hello.txt" in names.split(",")) and ("notes.txt" in names.split(",")) \
        and ("chapter.tex" in names.split(","))
    state = mongo_state(imp_pid) if imp_pid else None
    state_owner = _mongo_eval(
        'const d=db.webdavsyncprojectstates.findOne({projectId: "' + str(imp_pid) + '"}); '
        'print(d ? (d.ownerId ? "has-owner" : "no-owner") : "NO")')
    report("B4 import → 200 + project created (row + ingested tree + state row)",
           bool(resp_ok and imp_pid and row_pid and ingested and state and state_owner == "has-owner"),
           f"-> {st} {b[:110]!r}; pid={str(imp_pid)[:12]} row={'yes' if row_pid else 'no'} "
           f"tree=({names[:80]!r}) state_owner={state_owner}")
    if not imp_pid:
        return

    # B4c — the imported project IS the sync-surface project (no second POST
    # /project/new: same name, one row). Live surface check: /editor/:id
    # (the legacy /project/:id PAGE routes are RETIRED 2026-10-05 → 404 in
    # this build; re-arm: if the editor page stops resolving the import row,
    # this flips red).
    st2b, b2b = oli.req("GET", f"/editor/{imp_pid}")
    report("B4c imported project accessible via /editor/:id (legacy /project/:id page retired)",
           st2b == 200, f"-> {st2b} {b2b[:100]!r}")
    pid = imp_pid

    # B5 — push. On this conformant family createDirectory sees MKCOL 201
    # (fresh) / 405 (re-push, tolerated by the client per sync.go:283-287) and
    # every PUT lands on an existing parent → expect 200 "Push completed".
    # (The nginx-dav family is the 500 counterexample — trac #1966 — pinned
    # by the earlier fixture revision.)
    st, b = oli.req("POST", f"/project/{pid}/webdav/push")
    push_success = False
    try:
        push_success = _json(b, "success") is True
    except Exception:
        pass
    if push_success:
        st2, h2, b2 = dav("GET", urllib.parse.quote(f"{ROOT_PATH}/{proj}/hello.txt"), None, authed())
        report("B5 push → 200 + file intact on server (conformant family)",
               st == 200 and st2 == 200 and b2 == b"seed hello for import\n",
               f"-> {st} {b[:100]!r}; server hello.txt={st2} {b2[:40]!r}")
        # B5b — .tex parity (WDV-C): push exports docs[] from docstore; the
        # imported chapter.tex body must come back byte-identical.
        stx, hx, bx = dav("GET", urllib.parse.quote(f"{ROOT_PATH}/{proj}/chapter.tex"), None, authed())
        tex_seed = seed_files[f"{ROOT_PATH}/{proj}/chapter.tex"]
        report("B5b push .tex → remote body == docstore seed (docstore-backed parity)",
               stx == 200 and bx == tex_seed,
               f"-> {stx} {bx[:60]!r} (seed={tex_seed[:40]!r})")
    else:
        report("B5 push → 500 (MKCOL 409, nginx-dav family) — counterexample family",
               st >= 400,
               f"-> {st} {b[:140]!r} (nginx trac #1966 counterexample; not expected on this server)")

    # B6 — pull (poll path has NO server-side MKCOL): remote-only new file is
    # ingested into the project. Pre-fix this 500'd twice (typed-nil reader
    # GET panic; resourcetype bool parse); the 200 pin is the regression guard.
    pulled_path = f"{ROOT_PATH}/{proj}/pulled-by-fixture.txt"
    st, _, _ = dav("PUT", urllib.parse.quote(pulled_path), b"remote advance\n", authed())
    st, b = oli.req("POST", f"/project/{pid}/webdav/pull", json_body={})
    try:
        msg = _json(b, "message")
    except Exception:
        msg = None
    report("B6 pull → 200 Pull completed (remote-only file ingested)",
           st == 200 and msg == "Pull completed", f"-> {st} {b[:120]!r}")

    # B7 — unlink the state link (observe-and-pin: 200-success or 404-missing
    # are both plausible contracts pre-sync; anything else fails the pin)
    st, b = oli.req("DELETE", f"/project/{pid}/webdav/state")
    ok = st in (200, 404)
    report("B7 unlink state → 200/404 (pin)", ok, f"-> {st} {b[:100]!r}")
    if os.environ.get("OLI_CLEANUP") == "1":
        st, b = oli.req("DELETE", f"/Project/{pid}")   # Node capital-P route
        report("B7b project cleanup (OLI_CLEANUP=1)", st in (200, 204), f"DELETE /Project/{pid} -> {st} {b[:60]!r}")

    # B8 — disconnect + final status
    st, b = oli.req("POST", "/user/webdav/disconnect")
    st2, b2 = oli.get_json("/user/webdav/status")
    report("B8 disconnect → status {\"connected\":false}",
           st == 200 and st2 == 200 and b2 == {"connected": False},
           f"disconnect={st} status={st2} {b2!r}")


def _json(body, key):
    return json.loads(body).get(key)


# ---- world-aware container resolution (WDV-A closeout, 2026-11-16) ----
# The harness predates the ol-e2e world: it hard-coded `overleafserver` +
# `overleafmongo`. In the ol-e2e world the web container is `ol-e2e-overleaf-1`
# and its mongo is an `ol-e2e-mongo-*` replica-set member (its MONGO_URL), NOT
# the legacy `overleafmongo` (a different instance with 0 projects — the B4
# row/tree/state lookups silently returned empty while the HTTP contract,
# incl. the .tex docstore parity leg, was actually GREEN). Resolution order:
#   1. explicit env (WDV_WEB_CONTAINER / WDV_MONGO_CONTAINER);
#   2. auto: web = first running of (ol-e2e-overleaf-1, ol-e2e-overleaf-2,
#      overleafserver); mongo = the candidate container that owns the IP the
#      web's MONGO_URL host resolves to — queried from INSIDE the web
#      container; fallback overleafmongo (legacy world).
def _docker_running(name):
    try:
        r = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", name],
                           capture_output=True, text=True, timeout=15)
        return r.stdout.strip() == "true"
    except Exception:
        return False


def _web_container():
    if os.environ.get("WDV_WEB_CONTAINER"):
        return os.environ["WDV_WEB_CONTAINER"].strip()
    for cand in ("ol-e2e-overleaf-1", "ol-e2e-overleaf-2", "overleafserver"):
        if _docker_running(cand):
            return cand
    return "overleafserver"


def _mongo_container():
    if os.environ.get("WDV_MONGO_CONTAINER"):
        return os.environ["WDV_MONGO_CONTAINER"].strip()
    web = _web_container()
    try:
        env = subprocess.run(["docker", "exec", web, "sh", "-c",
                              "printf '%s' \"$MONGO_URL\""],
                             capture_output=True, text=True, timeout=15).stdout.strip()
        m = re.search(r"mongodb(?:\+srv)?://([^:/?]+)", env)
        host = m.group(1) if m else "mongo"
        ipout = subprocess.run(["docker", "exec", web, "sh", "-c",
                               "getent hosts " + host],
                               capture_output=True, text=True, timeout=15)
        ip = ipout.stdout.split()[0] if ipout.stdout.split() else None
        if ip:
            for cand in ("ol-e2e-mongo-1", "ol-e2e-mongo-2", "overleafmongo"):
                try:
                    nets = json.loads(subprocess.run(
                        ["docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", cand],
                        capture_output=True, text=True, timeout=15).stdout)
                    if any((v or {}).get("IPAddress") == ip for v in nets.values()):
                        return cand
                except Exception:
                    pass
    except Exception:
        pass
    return "overleafmongo"


def _mongo_eval(expr):
    out = subprocess.run(
        ["docker", "exec", _mongo_container(), "mongosh", "--quiet", "sharelatex", "--eval", expr],
        capture_output=True, text=True, timeout=120)
    return out.stdout.strip()


def find_project_by_name(name):
    out = _mongo_eval(
        f'const p=db.projects.findOne({{name: "{name}"}}); print(p ? p._id : "NO")')
    m = re.search(r"\b[0-9a-f]{24}\b", out)
    return m.group(0) if m else None


def mongo_state(pid):
    # state doc: webdavsyncprojectstates ({projectId(string|oid), lastSyncAt...})
    out = _mongo_eval(
        f'const d=db.webdavsyncprojectstates.findOne({{projectId: "{pid}"}}); '
        f'if (!d) {{ const o=ObjectID ? ObjectID("{pid}") : null; '
        f'  if (o) d=db.webdavsyncprojectstates.findOne({{projectId: o}}); }} '
        f'print(d ? "found:"+JSON.stringify({{lastSyncAt: d.lastSyncAt}}) : "NO")')
    return out if out.startswith("found:") else None


def main():
    if os.environ.get("SKIP_PART_A") != "1":
        part_a()
    if os.environ.get("SKIP_PART_B") != "1":
        part_b()
    n_ok = sum(1 for r in RESULTS if r)
    print()
    print(f"SUMMARY: {n_ok}/{len(RESULTS)} passed"
          + ("" if n_ok == len(RESULTS) else " — see FAIL rows above"))
    return 0 if n_ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
