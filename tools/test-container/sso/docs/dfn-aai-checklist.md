# DFN-AAI / EduGAIN SAML 2.0 profile — conformance checklist (SP side)

Diff of the DFN-AAI SAML 2.0 profile (DFN Technical Documents,
`doku.tid.dfn.de/de:dfnaai:start`, EduGAIN DFN profile "SAML 2.0 in DFN-AAI")
against the ayakaleaf-pro SAML service provider
(`services/web/modules/authentication/saml/`, via `@node-saml/passport-saml`).

Status: **PASS** = implemented and verified; **CONF** = configurable per
provider (the schema accepts it, `providers/schema.mjs`); **OP** =
operational requirement (hosting, not code); **GAP** = missing.

| # | DFN-AAI requirement (SP role) | Status | Evidence |
|---|-------------------------------|--------|----------|
| 1 | SAML 2.0 protocol version | PASS | passport-saml 2.0 flows; E2E login vs boxyhq mock on the live server |
| 2 | TLS for all SP endpoints (ACS, SLO) | PASS | live SP only served over HTTPS (psintern.neuro.uni-bremen.de) |
| 3 | Require **signed assertions** | PASS | `wantAssertionsSigned` **defaults to true** (schema.mjs:251); node-saml verifies the Assertion signature against `idpCert` before accept |
| 4 | Optionally require signed Response | CONF | `wantAuthnResponseSigned` (default false — DFN-AAI mandates assertion signing, response signing is IdP practice) |
| 5 | Validate IdP certificate, signature algorithm | PASS/CONF | `idpCert` (PEM/DER, single or list) + `signatureAlgorithm` per provider; node-saml enforces |
| 6 | Reject unsigned / badly-signed responses | PASS | node-saml `validateInResponseTo`, signature verification in the library; untrusted assertions fail login (E2E: mock signs; a wrong cert would fail) |
| 7 | NameID support (persistent/transient/…) | PASS/CONF | `identifierFormat` per provider; `attrs.userId` defaults to `nameID` — any NameID format usable as the stable identity |
| 8 | Targeted IDs (eduPersonTargetedID) for non-relying contexts | PASS | attrs mapping accepts `eduPersonTargetedID` as `userId`; no auto-create without it (filter/behavior apply) |
| 9 | eduPerson (ePP) attributes | PASS | `attrs.{email,firstName,lastName,admin}` mapped from any attribute; EduGAIN attribute catalog + preset in `providers/presets.mjs` (GN3-11-012) |
| 10 | AuthnRequest binding HTTP-Redirect (POST optional) | PASS/CONF | `authnRequestBinding` (Redirect default / POST with `skipRequestCompression`); entryPoint per provider |
| 11 | Attribute request (NameIDPolicy, AttributeConsumingService) | CONF | `attributeConsumingServiceIndex`, `additionalAuthorizeParams` (incl. NameIDPolicy params) |
| 12 | Encrypted assertions support | CONF | `decryptionPvk` (node-saml decryption) |
| 13 | Single Logout — SP as target | PASS | `/saml/:id/logout/callback` (GET+POST bindings) + `passportLogoutCallback` |
| 14 | Single Logout — SP as initiator | PASS | `logoutUrl` per provider (IdP SLO endpoint), logout dispatch from session (`req.session.externalAuthProvider`) |
| 15 | Clock skew tolerance / condition validation | PASS/CONF | `acceptedClockSkewMs` (default sensible in node-saml); `requestIdExpirationPeriodMs`, `validateInResponseTo` |
| 16 | SP metadata publication | CONF | `/saml/:id/metadata` endpoint generates `<issuer>-meta.xml` (SAMLAuthenticationController); restricted to logged-in admins (safer default) |
| 17 | NTP-synchronized clocks | OP | host requirement — the compose host runs systemd-timesyncd |
| 18 | No cleartext credentials, session cookies over TLS | PASS | session cookie `secure` via siteUrl https; SAML flows entirely over HTTPS |

## Residual deviations (documented, accepted)

1. **Response-level signing is not enforced by default** (row 4): DFN-AAI
   mandates assertion signing, which we enforce by default; we leave
   response signing opt-in to stay compatible with IdPs that sign
   assertions only (common in the wild).
2. **ePP v2 / attribute release rules** are IdP-side obligations in
   DFN-AAI; the SP only consumes whatever attributes the IdP releases
   (mapped via `attrs`). There is no SP-side consent flow — acceptable for
   the institution-run SP use case, documented for EduGAIN reviewers.
3. **Discovery (mdweb / DFN-AAI "Entdecker")** is not implemented: we use
   per-provider buttons on the login page instead of the Shibboleth
   Discovery Profile. Functionally equivalent for the single-institution
   deployment; noted as a deviation from the full DFN-AAI user
   experience.

## Verified (2026-11-14, live)

- SAML 2.0 login E2E: SP AuthnRequest → boxyhq mock IdP → signed
  SAMLResponse → ACS → session (see `../README.md`, SAML section).
- OIDC + SAML providers coexist; per-provider filters and link-only
  behavior applied identically (see `README.md`).
