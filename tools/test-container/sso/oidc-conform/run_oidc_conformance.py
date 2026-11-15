#!/usr/bin/env python3
"""Drive the official OIDF conformance suite (running at tests/tools/oidc-conform) to certify an OIDC IdP.

Creates an OIDC Core plan against the IdP-under-test (by its discovery URL), starts the
oidcc conformance modules, waits for each, and exports the HTML/JSON report.

Requires an admin API token (created in the suite's UI) as CONFORMANCE_TOKEN.
The IdP-under-test's discovery URL via OIDP_DISCOVERY.

Uses stdlib only (urllib + ssl, self-signed cert accepted) — no external deps.
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("CONFORMANCE_BASE", "https://localhost:8443").rstrip("/")
TOKEN = os.environ.get("CONFORMANCE_TOKEN", "")
OVERRIDE_IDP = os.environ.get("OIDP_DISCOVERY",
                              "http://oidc-idp:80/.well-known/openid-configuration")
# Must be a KNOWN suite test-plan template (from /api/runner/available profiles), not arbitrary.
PLAN_NAME = os.environ.get("CONFORMANCE_PLAN_NAME", "oidcc-client-test-plan")
# The CI's exact known-good variant set for this plan (.gitlab-ci/run-tests.sh:54).
VARIANT = json.loads(os.environ.get("CONFORMANCE_VARIANT", '{"client_auth_type":"client_secret_basic","response_type":"code","response_mode":"default","request_type":"plain_http_request","client_registration":"dynamic_client"}'))
OUT_DIR = os.environ.get("CONFORMANCE_OUT", "./oidc-conform-report")
# Only run OIDC Core (oidcc-*) modules, not the full FAPI/CIBA/VC plans.
ONLY_OIDC_CORE = os.environ.get("CONFORMANCE_ONLY_OIDC_CORE", "1") == "1"
WAIT_STATES = "SUCCESS,FAILURE,FAILED,ERROR"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def mname(m):
    """A test-module's name — the suite uses 'testName' on /api/runner/available and
    'testModule' in a plan's modules; accept either."""
    if isinstance(m, dict):
        return m.get("testModule") or m.get("testName") or m.get("name") or ""
    return ""


def call(method, path, *, params=None, body=None, raw=False, timeout=120):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = {"Accept": "*/*"}
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    if body is not None:
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            b = r.read()
            return r.status, (b if raw else b.decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        b = e.read()
        return e.code, (b if raw else b.decode("utf-8", "replace"))
    except Exception as e:
        return -1, str(e)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if not TOKEN:
        print("WARNING: CONFORMANCE_TOKEN not set — plan creation/run will 401.")

    # 1) liveness + oidcc module inventory (public).
    st, body = call("GET", "/api/runner/available")
    mods = []
    try:
        mods = json.loads(body) if isinstance(body, str) else []
    except Exception:
        pass
    oidc = [n for n in (mname(m) for m in (mods or [])) if n.lower().startswith("oidcc-")]
    print(f"[1] GET /api/runner/available -> HTTP {st}; {len(oidc)} oidcc-* modules (e.g. {oidc[:6]})")

    # 2) create the plan against the IdP-under-test (discoveryUrl) — needs the admin token.
    config = {"description": "OlliOIDC: OIDC Core conformance against our standard IdP",
              "server": {"discoveryUrl": OVERRIDE_IDP}}
    st, body = call("POST", "/api/plan", params={"planName": PLAN_NAME, "variant": json.dumps(VARIANT)},
                    body=config, timeout=60)
    print(f"[2] POST /api/plan (name={PLAN_NAME}, idp={OVERRIDE_IDP}) -> HTTP {st}")
    if st not in (200, 201):
        print("    " + (body[:500] if isinstance(body, str) else str(body)))
        return 1
    plan_id = json.loads(body).get("id")
    plan_mods = json.loads(body).get("modules", [])
    target = [n for n in (mname(m) for m in plan_mods)
              if (not ONLY_OIDC_CORE or n.lower().startswith("oidcc-")) and n]
    MAX_MODULES = int(os.environ.get("CONFORMANCE_MAX_MODULES", "5"))
    if MAX_MODULES > 0 and len(target) > MAX_MODULES:
        target = target[:MAX_MODULES]
    time.sleep(2)  # let the plan's modules materialize (avoids a transient /api/runner 404)
    print(f"    plan_id={plan_id}; plan has {len(plan_mods)} modules; running {len(target)}"
          + (" (OIDC-Core only)" if ONLY_OIDC_CORE else "")
          + (f" (capped by CONFORMANCE_MAX_MODULES={MAX_MODULES})" if os.environ.get("CONFORMANCE_MAX_MODULES", "").strip() else ""))

    # Readiness: the suite computes a plan's module instances over several seconds; poll until the
    # first module has instances (the "runnable" signal) instead of a blind fixed sleep.
    for _w in range(30):
        stp, bp = call("GET", f"/api/plan/{plan_id}", timeout=30)
        try:
            mp = json.loads(bp).get("modules", []) if isinstance(bp, str) else []
            if mp and mp[0].get("instances"):
                print(f"    plan ready (module[0].instances present) after poll")
                break
        except Exception:
            pass
        time.sleep(2)

    # 3) start + wait each module.
    results = {}
    for i, mod in enumerate(target, 1):
        st, body = -1, ""
        for _attempt in range(6):  # retry the transient "module not ready" 404 after plan creation
            st, body = call("POST", "/api/runner", params={"test": mod, "plan": plan_id}, timeout=60)
            if st in (200, 201):
                break
            time.sleep(2)
        if st not in (200, 201):
            print(f"[3.{i}] {mod}: start failed HTTP {st} {body[:200]}")
            results[mod] = "START_FAILED"
            continue
        test_id = json.loads(body).get("id")
        final = "UNKNOWN"
        for _ in range(10):
            st2, body2 = call("GET", f"/api/runner/{test_id}/wait-state",
                             params={"states": WAIT_STATES, "timeoutMs": 30000}, timeout=60)
            if st2 == 200 and body2:
                txt = body2 if isinstance(body2, str) else str(body2)
                try:
                    w = json.loads(txt) if txt.strip().startswith("{") else {"state": txt[:60]}
                    final = str(w.get("state") or w.get("status") or txt[:60])
                except Exception:
                    final = txt[:80]
            else:
                final = f"HTTP {st2}"
            if any(s in final.upper() for s in WAIT_STATES.split(",")):
                break
        print(f"[3.{i}] {mod} -> {final}")
        results[mod] = final

    # 4) export the report (html + json).
    for ext in ("html", "json"):
        st, blob = call("GET", f"/api/plan/{plan_id}/{ext}", raw=True)
        fn = os.path.join(OUT_DIR, f"ollitex-oidc-core.{ext}")
        if st == 200 and blob:
            with open(fn, "wb") as f:
                f.write(blob)
            print(f"[4] GET /api/plan/{plan_id}/{ext} -> {fn} ({len(blob)}B)")
        else:
            print(f"[4] GET /api/plan/{plan_id}/{ext} -> HTTP {st}")

    passed = sum(1 for v in results.values() if "SUCCESS" in str(v).upper())
    print(f"\n=== summary: {len(results)} modules; {passed} SUCCESS ===")
    for k, v in results.items():
        print(f"   {'ok ' if 'SUCCESS' in str(v).upper() else 'x  '}{k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
