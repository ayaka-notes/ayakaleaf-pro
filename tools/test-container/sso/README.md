# SSO / identity test stack

A minimal, **standard** local server set for exercising the SSO + federation Go code end‑to‑end, using
well‑used upstream images instead of hand‑rolled identity code (mirrors the benchmark identity servers in
`/data_1/image_mining/benchmark_overleaf_vm/compose/production`):

| Server | Standard image | Endpoint |
|--------|----------------|----------|
| **LDAP** | `osixia/openldap:1.5.0` | `ldap://localhost:389` (TLS :636) |
| **OIDC** | **`soluto/oidc-server-mock`** (dotnet, IdentityServer4‑based), baked as `sso-oidc` | `http://localhost:8080` |
| **SAML** | **`boxyhq/mock-saml`** (500k+‑download standard IdP) | `http://localhost:4100` |
| **MAILSINK** | postfix catch‑all (`./mailsink`) | `smtp://localhost:25` |

```
docker compose -f tests/tools/sso-test/docker-compose.yml up -d
```

> Port note: boxyhq is mapped host **4100**→c:4000 (the live `overleafserver` owns host :4000 here); soluto
> c:80 mapped to host **8080**; LDAP :389 and mail :25 match the benchmark. Test‑only; credentials are dev fixtures.

## Credentials / endpoints (all test‑only)

| What | Value |
|------|-------|
| LDAP base | `dc=example,dc=com` (people in `ou=people`) |
| LDAP admin bind | `cn=admin,dc=example,dc=com` / `admin_password` |
| LDAP reader bind | `cn=ldap_reader,dc=example,dc=com` / `GoodNewsEveryone` |
| LDAP users | `ssoe2e`(SsoE2ePass123), `ssoadm`(admin, SsoAdmPass123), `jdoe`,`asmith`,`admin`,`bwilson`,`cjones` |
| **OIDC issuer** | `http://localhost:8080` |
| **OIDC discovery** | `http://localhost:8080/.well-known/openid-configuration` (200) |
| **OIDC authorize / token / userinfo** | `…/connect/authorize`, `…/connect/token`, `…/connect/userinfo` |
| OIDC test client | `overleaf_test` / `SOMEPASSWORD` (authorization_code) |
| **SAML entityID** | `https://saml.example.com/entityid` |
| **SAML IdP metadata** | `http://localhost:4100/api/saml/metadata` (real `X509Certificate`) |
| **SAML SSO** | `http://localhost:4100/api/saml/sso` |
| Mailsink capture | `docker exec sso-test-mailsink-1 cat /var/mail/dumpuser/Maildir/new/*` |

## How each flow works
- **LDAP (bind‑as‑user):** optional service‑bind → search by `uid`/email → bind the DN with the user's
  password → return attributes. (Go: `POST /sso/ldap/login`.) Fixtures + admin in `seeds/ssoe2e.ldif`.
- **OIDC (soluto/boxyhq‑class standard IdP):** IdentityServer4. Configure a client + users via
  `*_CONFIGURATION_PATH` **baked into the `sso-oidc` image** (`oidc/config/*.json`) — baking (not runtime `-e`)
  avoids the fragile long‑JSON `docker run` env. Standard identity resources `openid`/`email`/`profile` are
  built‑in (do **not** redefine them as API scopes). Login is IS4's built‑in `Account/Login` form.
- **SAML (boxyhq/mock‑saml):** `GET /api/saml/metadata` → `EntityDescriptor` with a real signing cert +
  SSO/SLO; `GET/POST /api/saml/sso` runs the SP‑initiated flow and posts a **signed** `SAMLResponse`.
  Config (`APP_URL`/`ENTITY_ID` + test key pair) in `saml/saml.env`.
- **MAILSINK:** postfix `virtual` → every recipient to `dump-user@localhost` under `/var/mail/dumpuser`.

## Go live tests (env‑gated, skip cleanly without servers)
```bash
# LDAP bind‑as‑user:
LIVE_LDAP_URL=ldap://localhost:389 LIVE_LDAP_BASE='dc=example,dc=com' \
LIVE_LDAP_BIND_DN='cn=admin,dc=example,dc=com' LIVE_LDAP_BIND_PW=admin_password \
LIVE_LDAP_FIXTURE_USER=ssoe2e LIVE_LDAP_FIXTURE_EMAIL=ssoe2e@example.com LIVE_LDAP_FIXTURE_PASS=SsoE2ePass123 \
LIVE_LDAP_ADMIN_USER=ssoadm LIVE_LDAP_ADMIN_EMAIL=ssoadm@example.com LIVE_LDAP_ADMIN_PASS=SsoAdmPass123 \
  go test ./go/services/web/features/sso/ -run LDAPLive -v -count=1

# IdP probes: boxyhq SAML metadata + soluto OIDC discovery (both must be up):
LIVE_SSO_PROBE=1 LIVE_SAML_META_URL=http://127.0.0.1:4100/api/saml/metadata LIVE_OIDC_ISSUER=http://localhost:8080 \
  go test ./go/services/web/features/sso/ -run LiveSSOProbe -v -count=1
```

## What this is NOT
- **Not a full HTTP SSO login E2E** — that needs the app (mongo+redis) and is an image‑level e2e. The
  OIDC code→token→userinfo and SAML response→SP‑validate round‑trips are best driven here **by the app's
  OIDC/SAML handlers** against these IdPs (a browser is how these flows are actually exercised).
- **Not the live M1/M3 bake/push** — owner‑gated.

## Layout
- `docker-compose.yml` — the four services.
- `oidc/` — `Dockerfile` (FROM `soluto/oidc-server-mock` + baked `*_CONFIGURATION_PATH`) + `config/{server-options,clients,users}.json`.
- `saml/saml.env` — boxyhq `APP_URL`/`ENTITY_ID` + test‑only IdP key pair.
- `mailsink/` — postfix catch‑all (`main.cf`).
- `seeds/ssoe2e.ldif` — extra LDAP users (fixture + admin) for the bind‑as‑user path.
