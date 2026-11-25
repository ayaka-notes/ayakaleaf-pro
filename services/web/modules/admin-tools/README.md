# Site Settings (admin page for the docker env parameters)

Admin page **`/admin/site-settings`** — the admin-managed values for the
parameters of this deployment that were previously compose
environment variables only. Ported from the `6.3.0_post` / `OlliTeX`
prototype (the "Manage Site" env-parameter page), rebuilt in this
project's admin-panel style (same chrome as `/admin/user` and
`/admin/project`), with the precedence rule inverted to the owner's
requirement.

## The rule: external docker env wins

For every parameter, the effective value is:

1. **the process environment** (docker compose / `docker -e`) —
   **always wins**. The environment stays the deployment owner's
   control plane; nothing on this page can override it while it is set.
2. **the stored admin value** (this page, in MongoDB) — applies wherever
   the env var is unset or empty, and keeps meaning after the env var
   is removed.
3. **the setting's own default** (the service's code).

The page marks every field whose value currently comes from the
environment (an `env: VAR` badge) and shows the mirrored variable next
to each field, so an admin always sees what their save would override
and what already overrides it.

**Effective on the next service (container) start.** Values are
resolved when a service's config loads at boot; a running process keeps
its boot-time values. Restart the container (or the individual service)
after a save to apply it everywhere.

## How it works (no config server, no snapshot files)

- **Storage**: the `site_settings` collection of the site's existing
  MongoDB — one document, `_id: 'global'`, one key per section. Secrets
  (SMTP password, OAuth client secrets, SSO certs/keys) are stored
  **encrypted** with the same token-cipher family the
  github-sync/dropbox modules already use
  (`app/src/Features/SiteSettings/SecretCipher.mjs`), are masked in
  every API response, and an empty secret on save means "keep the
  current one". After each save a timestamped full-document snapshot is
  kept in `site_settings_snapshots` (last 10) for one-step recovery.
- **Hydration**: every service reads its own parameters in its own
  `config/settings.defaults.{js,cjs}` at boot — **self-contained**, via
  the shared helper `@overleaf/settings/admin-settings`
  (`libraries/settings/admin-settings.js`):

  ```js
  const { mirrorIntoEnv } = require('@overleaf/settings/admin-settings')
  mirrorIntoEnv([
    ['ENABLE_PDF_CONVERSIONS', 'conversions', 'pdfConversions'],
    ['COMPILE_SIZE_LIMIT', 'sandboxed-compiles', 'compileSizeLimit'],
  ])
  ```

  because a MongoDB read is async and config files load synchronously,
  the helper runs one short-lived `node` child per process boot that
  performs the read and prints the document (memoized, hard-capped at
  ~8 s, fail-soft: no mongo → env + defaults stand, exactly as before
  this feature existed). The service's existing
  `process.env.X || default` lines then pick the stored values up
  unchanged — that is the whole per-service diff.

- **Scope**: each service mirrors **only the vars it actually reads**
  (web: the web-side set incl. the SSO/github-sync/dropbox/template
  modules; clsi: compile + conversion vars; docstore: doc/archive vars;
  real-time: update size + CORS origins; filestore: link expiry;
  linked-url-proxy: the linked-URL policy). Nothing leaks to services
  that don't consume a parameter.

## Map of pieces

| Piece | Path |
| --- | --- |
| page routes + controller | `modules/admin-tools/app/src/SiteSettingsController.mjs`, routes in `AdminToolsRouter.mjs` |
| page view | `modules/admin-tools/app/views/admin-site-settings.pug` |
| page frontend | `modules/admin-tools/frontend/js/site-settings/` (entry `pages/admin-site-settings.tsx`, tabs `site-settings-root.tsx`, fields `components/fields.tsx`, section form `components/section-tab.tsx`, section/field metadata `sections-meta.ts`) |
| storage manager + validators | `app/src/Features/SiteSettings/SiteSettingsManager.mjs` |
| secret cipher | `app/src/Features/SiteSettings/SecretCipher.mjs` |
| collection registration | `app/src/infrastructure/mongodb.mjs` (`db.siteSettings` → `site_settings`) |
| shared hydration helper | `libraries/settings/admin-settings.js` (+ `admin-settings-read.cjs`, tests in `libraries/settings/test/`) |
| service mirror blocks | the `mirrorIntoEnv([...])` at the top of `services/{web,clsi,docstore,real-time,filestore,linked-url-proxy}/config/settings.defaults.*` |
| unit tests | `services/web/test/unit/src/site-settings.test.mjs` (incl. the page↔backend↔config consistency checks), `libraries/settings/test/admin-settings.test.js` |

## Sections

Sandboxed compiles · Conversions · Git integration · GitHub sync ·
Dropbox · Email · Linked file types · External URLs · Templates ·
SSO (SAML / OIDC / LDAP) · Editor limits · Security · Sharing & access ·
Miscellaneous · Service URLs.

The section → field → env-var map
(`SECTION_ENV_FIELDS` in the manager) is the single source of truth;
the unit tests fail when the page metadata, the validators and the
service mirror blocks drift from it.

## Notes for the reviewer

- **No changes to any service's behavior when no admin has saved
  anything**: the mirror blocks are no-ops on an empty `site_settings`
  document, and a failed/unavailable read degrades to exactly the
  previous behavior.
- **No new service, no new container, no config server**: the only
  moving part is a one-shot `node` child at each process boot.
- **Secrets never leave the API in plaintext**; the cipher is the
  existing token-cipher (rotating it has the documented, uniform
  effect).
- New settings that exist in this codebase but were missing from the
  prototype page are included: editor limits (`ADDITIONAL_TEXT_EXTENSIONS`,
  `FILE_IGNORE_PATTERN`, `PRECIOUS_FILE_PATTERN`, `MAX_DOC_LENGTH`,
  `MAX_JSON_REQUEST_SIZE`, `MAX_UPDATE_SIZE`, `COMMENT_MENTION_DELAY_MS`),
  the conversions of this build (`ENABLE_PDF_CONVERSIONS`,
  `ENABLE_PNG2PDF_CONVERSIONS`, `CLSI_CONVERSION_TIMEOUT_SECONDS`),
  the compile limits (`COMPILE_SIZE_LIMIT`, `TEXLIVE_OPENOUT_ANY`,
  `TEXLIVE_MAX_PRINT_LINE`), security
  (`ADMIN_ONLY_LOGIN`, `BLOCK_CROSS_ORIGIN_REQUESTS`, `ALLOWED_ORIGINS`,
  `REAL_TIME_ALLOWED_CORS_ORIGINS`, `CSP_*`,
  `ELEVATED_ACCOUNT_SECURITY_AFTER_FAILED_LOGIN_MS`), sharing
  (`LINK_EXPIRY_TIMEOUT`, the `OVERLEAF_*` access flags), docstore
  (`ARCHIVE_ON_SOFT_DELETE`, `KEEP_SOFT_DELETED_DOCS_ARCHIVED`),
  `ENABLE_ONBOARDING_EMAILS`, `WIKI_URL`, and the dropbox `apiDomain`.
- Build note: `libraries/settings` gained a `mongodb` dependency (the
  boot child). Run `yarn install` once to refresh the lockfile.
