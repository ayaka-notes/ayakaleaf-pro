# SSO / identity test stack (local IdPs for multi-provider E2E)

A minimal, standard local set of identity servers for exercising Overleaf CE's
**multi-provider SSO** (OIDC + SAML, profile filters, existing/invited
exceptions) end-to-end. It uses well-used upstream images instead of
hand-rolled identity code.

| Server    | Image                          | Host port | Purpose                          |
|-----------|--------------------------------|-----------|----------------------------------|
| OIDC IdP  | `soluto/oidc-server-mock` (baked as `sso-oidc`) | `21808` | OIDC authz/token/userinfo + 2 test users |
| SAML IdP  | `boxyhq/mock-saml`             | `24100`   | signed SAML 2.0 assertions + X.509 cert in metadata |
| LDAP      | `osixia/openldap`              | `21389` / `21636` | optional LDAP fixtures |
| MAILSINK  | postfix catch-all (`./mailsink`) | `21025`   | captures all mail (for invite-exception testing) |

All host ports were remapped into the free `21xxx` range because this box runs a
live Overleaf + nginx + seaweedfs stack that owns the usual ports.

## Bring it up / down

```sh
docker compose -f docker-compose.yml up -d     # build the OIDC image first run
docker compose -f docker-compose.yml ps        # wait for healthy
docker compose -f docker-compose.yml down      # tear down
```

## Endpoints

- OIDC discovery:  `http://localhost:21808/.well-known/openid-configuration`
- OIDC authz/token/userinfo: `…/connect/authorize`, `…/connect/token`, `…/connect/userinfo`
- OIDC test users (baked in `oidc/config/users.json`):
  - `ssoe2e` / `SsoE2ePass123`  → normal user, `email=ssoe2e@example.com`
  - `ssoadm` / `SsoAdmPass123`  → admin claim `is_admin=true`, `email=ssoadm@example.com`
- SAML IdP metadata: `http://localhost:24100/api/saml/metadata` (has a real signing cert)
- SAML SSO:           `http://localhost:24100/api/saml/sso`
- SAML entityID:      `https://saml.example.com/entityid`
- Mailsink capture:   `docker exec sso-test-mailsink-1 cat /var/mail/dumpuser/Maildir/new/*`

## Overleaf provider config (this project)

This Overleaf reads providers from a JSON file (default
`services/web/config/ssos.providers.json`, overridable via
`OVERLEAF_SSO_PROVIDERS_FILE`), **not** from a database. So the "seed" is just a
JSON file. `e2e-providers.json` in this folder is a ready-to-load set with two
providers (OIDC mock + SAML mock) and a sample filter.

The IdP URLs inside `e2e-providers.json` use the overleaf container's docker
gateway IP (`172.18.0.1`) so the same URL is reachable from **both** the overleaf
container (token/metadata fetch) and the browser (authorize/SSO redirect).
Adjust the port/IP if your overleaf container's gateway differs
(`docker inspect <overleaf> --format '{{range .NetworkSettings.Networks}}{{.Gateway}}'`).

To load the providers into a running overleaf container and restart the web
service:

```sh
# 1. copy the provider file into the container
docker cp e2e-providers.json <overleaf>:/overleaf/config/ssos.e2e.json
# 2. point overleaf at it and restart the web service (www-data services)
docker exec <overleaf> bash -lc '
  echo "OVERLEAF_SSO_PROVIDERS_FILE=/overleaf/config/ssos.e2e.json" >> /etc/overleaf/env.sh
  sv restart web-overleaf || true
'
# 3. wait for the app to come back, then check /login shows both SSO buttons
```

Or simply create them in the **admin UI**: log in as a site admin →
`/admin/auths` → *New provider* (OIDC or SAML) → paste the JSON from
`e2e-providers.json`. The store persists to the same JSON file and re-registers
the passport strategies live (no restart needed).

## How the OIDC flow works

1. Overleaf redirects the browser to `{issuer}/connect/authorize`
   (issuer = `http://172.18.0.1:21808`).
2. Browser hits the mock's login page; enter a test user (`ssoe2e`/`ssoadm`).
3. Mock redirects back to Overleaf's callback
   `https://psintern.neuro.uni-bremen.de/oidc/oidc-mock/login/callback`
   (this exact URL must be in `oidc/config/clients.json` `RedirectUris`).
4. Overleaf exchanges the code, fetches userinfo, applies the **filter**, and
   either logs the user in (or, if `allowExistingUsers`/`allowInvited` is set
   and the account exists / is invited, lets them through despite the filter).

The sample filter in `e2e-providers.json` **denies** `ssoadm@example.com` and
**allows** `*@example.com`, so `ssoe2e` logs in and `ssoadm` is rejected —
a clean positive/negative filter pair.

## Files

- `docker-compose.yml` — the stack (ports remapped to the free 21xxx range).
- `oidc/` — soluto OIDC mock (Dockerfile + baked client/user/config JSON).
- `saml/` — boxyhq/mock-saml env (`saml.env`: entityID + test key pair, `key.pem`).
- `mailsink/` — postfix catch-all (`main.cf`).
- `seeds/ssoe2e.ldif` — extra LDAP users (fixture + admin) for bind-as-user.
- `e2e-providers.json` — ready Overleaf provider set (OIDC + SAML + filter).
- `seed-ssos.sh` — copy `e2e-providers.json` into overleaf + restart web.
