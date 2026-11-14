# OIDC conformance — the official OIDF suite

Certifies the OIDC federation with the **OpenID Foundation conformance suite** (the authoritative
IdP certification), instead of (or in addition to) our bespoke discovery/authorize probes.
We use the **prebuilt** `authelia/openid-connect-conformance-suite:latest` image (the Java `suite.jar`,
v5.1.x — the same tool we'd build from `/data_1/image_mining/conformance-suite`), so no local Maven build.

## Stack (all in one bridge network)
| Service | Role | Host port |
|---------|------|-----------|
| `server` | the OIDF conformance suite (Spring Boot, `suite.jar`) | (via nginx) |
| `nginx` | self‑signed TLS (CN=localhost) in front — the suite **requires https** | **8443** |
| `suite-mongo` | suite state (plans/tests/reports) | — |
| `oidc-idp` | **the IdP under test** — our standard OIDC IdP (`sso-oidc` / soluto) | (in‑network) |

Reach the suite at **https://localhost:8443** (self‑signed CN=localhost → accept the cert).
HTMLUnit is built‑in, so core OIDC front‑channel tests run **without** an external Chrome.

```bash
docker compose -f tests/tools/oidc-conform/docker-compose.yml up -d
# UI:      https://localhost:8443/
# Swagger: https://localhost:8443/api-document.html
```

## REST API (confirmed live)
Base `https://localhost:8443`. Public (no auth): `GET /api/runner/available` → module list (200).
Admin‑bearer (a token created via the UI): `GET /api/currentuser` verifies it.

| Step | Call |
|------|------|
| List modules | `GET /api/runner/available` |
| Create a plan | `POST /api/plan?planName=<name>[&variant=<json>]` body `{"description":..,"server":{"discoveryUrl":"https://<idp>/.well-known/openid-configuration"}}` → `{id, modules:[{testModule:first},…]}` |
| Start a test | `POST /api/runner?test=<firstModule>&plan=<planId>` → `{id}` |
| Wait for result | `GET /api/runner/<testId>/wait-state?states=SUCCESS,FAILURE,FAILED&timeoutMs=...` |
| Report | `GET /api/plan/<planId>/html` · `GET /api/plan/<planId>/json` |
| Certification pkg | `POST /api/plan/<planId>/certificationpackage` |

## Run the OIDC Core conformance against our IdP
1. **Get an admin API token**: open `https://localhost:8443/`, log in as admin (dev mode local
   login), then create an **API token** (the suite's "token" page). Use it as `CONFORMANCE_TOKEN`.
2. Run the driver (OIDC Core server tests, `client_secret_basic` / `response_type=code`):

   ```bash
   CONFORMANCE_TOKEN=<token> \
   OIDP_DISCOVERY="https://localhost:8443/oidc-idp-discovery" \
   python3 tests/tools/oidc-conform/run_oidc_conformance.py
   ```
   (point `OIDP_DISCOVERY` at whichever IdP you want certified — our `oidc-idp`, a real IdP, etc.;
   the suite drives it end‑to‑end + writes `plan.html` / `plan.json` to `./oidc-conform-report/`)

## Notes / caveats
- The suite **rejects http** (https required) — hence the self‑signed nginx front on :8443.
- For the IdP‑under‑test, the suite registers a client and drives the IdP; the IdP must be
  **reachable by the suite + its HTMLUnit browser** and its **issuer + discovery** consistent.
  Some OIDC Core tests exercise **Dynamic Client Registration (DCR)** — a minimal IdP (e.g. soluto)
  may miss some of those; that's a real finding, not a false failure. (A fully-conformant IdP is the
  clean case for a green OIDC Core certification.)
- The OIDF runs full certification in a controlled grid (Authlete IdP, real Chrome); the self-serve
  box here is for local conformance checks + CI wiring.

## Verified against soluto (2026-10-02)
- Suite boots + is https‑reachable (`https://localhost:8443` UI + `/api-document.html` OK).
- `GET /api/runner/available` → **200, 134 `oidcc-*`** OIDC Core modules listed.
- `POST /api/plan` (plan `oidcc-client-test-plan`, `client_registration=dynamic_client`,
  IdP = our `oidc-idp` soluto) → **201** (30 modules).
- `POST /api/runner test=oidcc-client-test` → **201** — a `/test/{id}` conformance run started.
- The run reached our IdP: **DCR client registration succeeded** (log: “created stored client”,
  “Setup Done”) — the suite drove `http://oidc-idp:80` discovery + `/connect/register`.
- The full OIDC Core steps then stop at soluto’s boundary (a mock is not fully conformant —
  DCR / JWK RS256 / token binding etc.) — the real, specific finding the suite exists to surface.
  A fully conformant IdP (the real Olli OIDC IdP, or Authelia/Auth0) is the green case.

## Layout
- `docker-compose.yml` — server + nginx (TLS) + mongo + IdP-under-test.
- `nginx/` — the repo's canonical self-signed nginx front (CN=localhost, :8443 → server:8080).
- `run_oidc_conformance.py` — driver: create OIDC Core plan (discoveryUrl) → run → wait → export.
- `README.md` — this file.

## Status on this host (2026-11-14, ayakaleaf-pro multi-sso)

- Stack comes up; suite UI/API reachable at `https://localhost:8443`; the IdP
  under test serves a clean `https://oidc-idp-tls` issuer (real Kestrel TLS,
  self-signed SAN cert in `idp-cert/`).
- Plan creation works without a bearer token in dev mode (`/api/currentuser`
  reports the `DEVMODE` admin). `oidcc-test-plan` (OIDC Core AS, static_client)
  was created against `https://oidc-idp-tls/.well-known/openid-configuration`
  and the runner started, fetched discovery + evaluated conditions against
  the IdP (logs: `n.openid.conformance.runner.TestRunner`).
  Observed gap in the MOCK IdP (not Overleaf): discovery lacks
  `claims_parameter_supported` (condition CheckDiscEndpointClaimsParameterSupported
  fails) — expected, the soluto mock is not a full IdP.
- LIMITATION: test runs stall after the `FetchServerKeys` condition (runner
  stays in `/api/runner/running` indefinitely, no further log output). The
  suite's HTMLUnit/browser component does not make progress in this
  environment. Full runs need a host where the suite's browser can operate
  (the official suite ships Chrome; see upstream docs).
- EduGain profile E2E (the part that matters for the SP) is covered on the
  live server instead: OIDC authorization-code login (soluto IdP) and SAML
  2.0 HTTP-Redirect login (boxyhq mock) both complete end-to-end, including
  the link-only ORCID flow — see the multi-SSO E2E notes and the provider
  files in `../` (oidc, saml).

## IdP TLS note

The old soluto image ignores `X-Forwarded-Proto` (its
`ASPNET_SERVICES_OPTIONS` handling is a no-op in the released build), so the
IdP serves TLS itself: Kestrel on :443 with the self-signed cert
(`idp-cert/idp.pfx`, password `idp-test`), reachable from the docker network
as `https://oidc-idp-tls` (compose network alias). Do NOT mix hostnames for
one IdP instance — the issuer is derived from the request's Host.
