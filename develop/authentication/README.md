# Authentication

Test users for LDAP and SAML login in the dev env. `authentication.env` turns both on for `web`; values in `dev.env` override it. Local login keeps working.

## Users

The password is the username.

| Method | Login | Password | Email |
| ------ | ----- | -------- | ----- |
| LDAP (`/ldap/login`) | `professor` | `professor` | `professor@planetexpress.com` |
| LDAP | `fry` | `fry` | `fry@planetexpress.com` |
| LDAP | `leela` | `leela` | `leela@planetexpress.com` |
| SAML (`/saml/login`) | `saml_alice` | `saml_alice` | `saml_alice@example.com` |
| SAML | `saml_bob` | `saml_bob` | `saml_bob@example.com` |
| SAML | `saml_carol` | `saml_carol` | `saml_carol@example.com` |

Every user has its own email, so each one creates its own account.

## LDAP

`ldap/` builds slapd on `debian:bookworm-slim`. The users and the groups `admin_staff` (professor) and `ship_crew` (fry, leela) come from [docker-test-openldap](https://github.com/rroemhild/docker-test-openldap), base `dc=planetexpress,dc=com`. They are in `ldap/users.ldif`.

## SAML

`saml/` builds [SimpleSAMLphp](https://github.com/simplesamlphp/simplesamlphp) (the release tarball, checked by SHA-256) on `debian:trixie-slim`. The users are in `saml/authsources.php`. `saml/idp.key` signs the responses and Overleaf checks them with `saml/idp.crt`; the pair is for local development only.

The IdP is served under the dev site: webpack forwards `/simplesaml` to the `saml` service, like `/git` to git-bridge. It reads `PUBLIC_URL` from `dev.env` for its own URL and for Overleaf's callback. Set the same address in `dev.env`:

```
OVERLEAF_SAML_ENTRYPOINT=<PUBLIC_URL>/simplesaml/module.php/saml/idp/singleSignOnService
OVERLEAF_SAML_LOGOUT_URL=<PUBLIC_URL>/simplesaml/module.php/saml/idp/singleLogout
```

Logging out of Overleaf also ends the IdP session, so the next SAML login asks for the password again.

## Changing users

Edit `ldap/users.ldif` or `saml/authsources.php`, then `bin/build ldap saml` and `bin/dev ldap saml`.
