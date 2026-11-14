# Multi-SSO — administrator guide (ayakaleaf-pro)

How to configure single sign-on in **Admin → SSO providers** (`/admin/auths`).
Applies to the `multi-sso` build (providers: OIDC, OAuth2, SAML — multiple
instances of each, configured per provider, no rebuild).

## Concepts

- **Provider** — one identity service (an IdP or OAuth server) with a unique
  id. The login page shows one button per enabled provider.
- **Type** — `oidc` (OpenID Connect), `oauth2` (generic OAuth2, e.g.
  GitHub/GitLab/Gitea), `saml` (SAML 2.0).
- **Behavior** (per provider):
  - `linkOnly` — never creates new accounts; only allowed to **link** to an
    existing one, or to log in a user who already has this identity linked
    (or whose email matches, if not link-only). Use for ORCID.
  - `verifiedEmailRequired` — reject unverified emails (default `true` for
    `oauth2`, `false` for `oidc`/`saml` unless you opt in).
- **Filters** — `allow` / `deny` rules over any SSO profile attribute, applied
  before login, linking, and JIT account creation (see *Filters* below).
- **Known providers** — the "Add provider" form pre-fills standard
  endpoints (Google, GitHub, GitLab, Gitea, ORCID, generic OIDC, EduGAIN
  SAML) with a tip per provider; the callback URL is computed for your host.

## Managing providers

1. **Add** — `Add provider` → choose a known provider (or a blank template).
   Fill client id/secret (OAuth2/OIDC) or IdP entry point + cert (SAML),
   set the attribute mapping, toggles, filters.
2. **Edit / enable / disable / delete** — actions column on the list page.
   Disabling a provider hides its login button and refuses its callback.
3. **Source of truth** — the admin UI edits the same canonical provider JSON
   that ops tooling reads (the `ssos.providers.json` store); paste or edit
   the raw JSON there when scripting.

### Attribute mapping (all types)

| Field | Meaning | Default |
|-------|---------|---------|
| `userId` | Stable external identity (must be unique per provider) | `sub` (OIDC) / `id` (OAuth2) / `nameID` (SAML) |
| `email` | Login email; required for account creation | `email` |
| `firstName` / `lastName` | Display name | — |
| `admin.field` + `admin.values` | Make matched profiles institution admins (exact or substring match) | off |

For SAML, any assertion attribute name works (e.g. `eduPersonPrincipalName`
for `email`, `eduPersonTargetedID` for `userId`).

### Filters

Each provider carries a `filter` block (all rules combine per the semantics
below, evaluated against the SSO profile's attributes/claims — `email`,
`eduPersonAffiliation`, `zfnScopedAffiliation`, any custom claim, …):

- **`allow` rules** (whitelist): if the list is non-empty, *at least one*
  rule must match, otherwise login is denied. Empty = no positive
  requirement.
- **`deny` rules** (blacklist): if *any* rule matches, login is denied.

A rule is `{ field, op, value? , values? }` (a bare `"field=value"` string
means `equals`). Operators: `equals`, `iequals`, `oneOf`/`iOneOf` (against
`values`), `startsWith`/`iStartsWith`, `endsWith`/`iEndsWith`,
`contains`/`iContains`, `regex`. Multi-valued profile attributes are matched
entry-wise. A missing attribute never matches.

Examples:
- Whitelist `@uni-bremen.de` students: `allow: [{field: "email", op:
  "endsWith", value: "@uni-bremen.de"}]`
- Blacklist guests: `deny: [{field: "eduPersonAffiliation", op:
  "oneOf", values: ["guest", "service"]}]`
- Regex on a ZFN attribute: `{field: "zfnScopedAffiliation", op: "regex",
  value: "^bremen\..+"}`

**Exceptions** (per provider, both default **true**):
- `filter.allowExistingUsers` — an account that *already exists* (linked
  identity or same email) may still log in even if the filter would deny
  the profile.
- `filter.allowInvited` — a profile whose email has a *pending project
  invite* may log in even if the filter would deny it.

Filters apply to **login, account linking, and JIT account creation** for
OIDC, OAuth2, and SAML alike.

## Per-provider recipes

### Google (OIDC)
Use the known-provider "Google". Client from a Google Cloud console OAuth
client (Web application); redirect URI = the callback shown in the form.
Recommended: `verifiedEmailRequired = true` (default), whitelist filter on
your domain, `linkOnly = false`.

### GitHub / GitLab / Gitea (OAuth2)
Known-provider presets pre-fill authorize/token/user URLs. Create an OAuth
app; the callback URL is shown in the form. Note: these send unverified
emails by default — keep `verifiedEmailRequired = true` (the default) and
add a whitelist filter for your staff domain if the account email may
collide with other identities.

### ORCID (OIDC, link-only)
Known-provider "ORCID". Register an ORCID OAuth app with the **ORCID Read-Limited**
scope and the callback. Use `linkOnly = true` (the default for this
preset) so ORCID identities attach to existing accounts instead of
creating new ones; unlinked users see the "link required" hint on the
login page and can link from **User → Settings → Linked services**.

### Generic OIDC / EduGAIN federation
Use the "OpenID Connect (generic)" preset with your IdP's issuer (it
discovers endpoints). See `docs/dfn-aai-checklist.md` for the DFN-AAI /
EduGAIN profile mapping and `oidc-conform/README.md` for running the OIDF
conformance suite against your IdP.

### SAML 2.0 (DFN-AAI)
Entry point (IdP SSO URL), IdP certificate (paste PEM), SP issuer,
audience (your callback), optional NameID format, encryption key for
encrypted assertions, SLO `logoutUrl`. Assertions must be signed —
`wantAssertionsSigned` defaults to **true**.

## Verification checklist (after a change)

- [ ] Provider appears on `/login` (enabled, no schema errors in the admin
      list page)
- [ ] Login with a test identity succeeds (JIT create or linked account)
- [ ] A filter-rejected identity gets the refusal page, not an account
- [ ] `linkOnly` provider: unlinked identity refused, linked identity
      logs in, linking from Settings works
- [ ] Disable provider → button gone, callback refused
- [ ] `/admin/auths` JSON matches intent (source of truth)
