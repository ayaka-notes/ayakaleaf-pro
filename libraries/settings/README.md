# @overleaf/settings

A small module to allow global config settings to be set for all services
within the Overleaf architecture.

## Settings file location

You can specify a custom location for the settings file by setting the
`OVERLEAF_CONFIG` environment variable. E.g.

    $ export OVERLEAF_CONFIG=/home/james/config/settings.development.js

Otherwise, the settings will be loaded from `config/settings.NODE_ENV.js`,
where `NODE_ENV` is another environment variable, or defaults to `development`.

The config directory is first looked for in the current directory, and then relative
to the settings module directory.

## Admin-managed site settings (`@overleaf/settings/admin-settings`)

A self-contained helper for **service config files** to resolve
admin-managed values stored by the web "Site Settings" admin page
(`/admin/site-settings`, stored in the `site_settings` collection of the
site's MongoDB, document `_id: 'global'`, one key per section).

Precedence, for every parameter:

1. the process environment (docker compose / `docker -e`) — **always wins**
2. the stored admin value from MongoDB
3. the setting's own default

```js
const { stored, resolveEnv, mirrorIntoEnv } = require('@overleaf/settings/admin-settings')

host: process.env.OVERLEAF_EMAIL_SMTP_HOST || stored('email', 'host') || '',
port: resolveEnv('OVERLEAF_EMAIL_SMTP_PORT', 'email', 'port', 587),
```

Most services use the whole-service form instead: one `mirrorIntoEnv`
call at the top of the config file, after which the existing
`process.env.X || default` lines pick the stored values up unchanged
(the services' mirror blocks in this repo are the reference):

```js
const { mirrorIntoEnv } = require('@overleaf/settings/admin-settings')
mirrorIntoEnv([
  ['ENABLE_PDF_CONVERSIONS', 'conversions', 'pdfConversions'],
  ['COMPILE_SIZE_LIMIT', 'sandboxed-compiles', 'compileSizeLimit'],
])
```

`mirrorIntoEnv` fills only unset/empty env vars, stringifies stored
values the way env vars expect (`true`/`false`, decimal numbers,
comma-joined lists), and never touches a non-empty env var.

### How it works

`config/settings.defaults.js` is loaded **synchronously** by this
library, while a MongoDB read is inherently async. To stay
self-contained (no snapshot files, no boot script, no config server),
`stored(...)` runs a short lived `node` child process
(`admin-settings-read.cjs`) **once per process boot**, which performs
the async read and prints the document as JSON. The child inherits the
container environment — `OVERLEAF_MONGO_URL`/`MONGO_URL` and, in the
PnP image, the `NODE_OPTIONS` PnP hooks — and must never fail: any
error degrades to "no stored values", so the environment and the
setting defaults stand exactly as before.

Cost: one `node` spawn plus a single `findOne` per service process at
boot (a few hundred ms on the happy path; hard-capped at ~8 s when
MongoDB is unreachable, after which defaults apply).

### Notes

- The read is memoized per process; the admin page's saves become
  effective when a service (re)starts — e.g. on the next container
  cycle.
- Secrets are stored **encrypted** (see the web feature
  `app/src/Features/SiteSettings/SecretCipher.mjs`); a service that
  needs a plaintext secret resolves the stored value like any other
  field and decrypts it with the shared token-cipher.
- `OVERLEAF_ADMIN_SETTINGS_FIXTURE=<json file>` makes the child read a
  file instead of MongoDB (tests / local probing);
  `OVERLEAF_ADMIN_SETTINGS_DEBUG=1` prints the degradation reason.
