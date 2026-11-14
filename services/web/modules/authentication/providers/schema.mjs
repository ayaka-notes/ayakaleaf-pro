/**
 * SSO provider schema: normalization and validation.
 *
 * A provider is one SSO source: one OIDC provider or one SAML IdP.
 *
 * Canonical shape (what the store, passport setup and managers consume):
 *
 * {
 *   id: 'zfn',                    // stable providerId used for account linking
 *   type: 'oidc' | 'saml',
 *   name: 'ZFN (Uni Bremen)',     // login button label
 *   enabled: true,
 *   source: 'file' | 'env',       // where the config came from (admin UI hint)
 *
 *   attrs: {                      // profile → user mapping (any field name)
 *     userId: 'eduPersonPrincipalName',
 *     email: 'email',
 *     firstName: 'givenName',
 *     lastName: 'sn',
 *     admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] }
 *   },
 *
 *   behavior: {
 *     updateUserDetailsOnLogin: false,
 *     allowedEmailDomains: null,   // JIT-creation gate (legacy OIDC semantics);
 *     linkOnly: false,             // null = allow all domains. true: never
 *     verifiedEmailRequired: false// auto-create; linked accounts may log in,
 *   },                            // unlinked get a "link from settings" note
 *                                 // (e.g. ORCID, which sends no email).
 *                                 // true: JIT-creation needs a verified email
 *                                 // (default true for type "oauth2")
 *
 *   filter: {                     // login-time profile filter (see filter.mjs)
 *     allow: [ { field, op, value?, values? } ],
 *     deny:  [ { field, op, value?, values? } ],
 *     allowExistingUsers: true,   // existing accounts may log in despite deny
 *     allowInvited: true          // invited users may autocreate despite deny
 *   },
 *
 *   // protocol-specific connection settings (only one present per type)
 *   oidc:   { issuer|urls..., clientId, clientSecret, scope, logoutUrl, hideWhenNotLinked },
 *   oauth2: { authorizeUrl, tokenUrl, userUrl, emailUrl?, clientId, clientSecret, scope },
 *   saml:   { entryPoint, spIssuer, audience, idpCert(s), privateKey, ... }
 * }
 *
 * Admin input may use kebab- or snake_case and flat keys; `normalizeProvider`
 * accepts the canonical shape plus a few convenience aliases.
 */

import fs from 'node:fs'
import { normalizeFilter } from './filter.mjs'

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/

function fail(path, message) {
  throw new Error(`${path}: ${message}`)
}

function str(value, path, { required = false, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(path, 'is required')
    return fallback
  }
  if (typeof value !== 'string') fail(path, 'must be a string')
  return value
}

function bool(value, path, fallback = false) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}

/**
 * Cert/key material may be given as:
 *   - a PEM string (inline),
 *   - an array of PEM strings,
 *   - a file path (string without PEM marker) — read from disk,
 *   - an array of file paths,
 *   - { file: path } / { pem: string } objects (or arrays of those).
 * Returns an array of PEM strings (matches the legacy env semantics).
 */
export function readCertMaterial(value, path) {
  if (value === undefined || value === null) return undefined
  const items = Array.isArray(value) ? value : [value]
  const result = []
  items.forEach((item, i) => {
    const p = `${path}[${i}]`
    if (item === undefined || item === null || item === '') return
    if (typeof item === 'object') {
      if (typeof item.file === 'string') {
        result.push(fs.readFileSync(item.file, 'utf8'))
        return
      }
      if (typeof item.pem === 'string') {
        result.push(item.pem)
        return
      }
      fail(p, 'must be { file: path } or { pem: "-----BEGIN ..." }')
    }
    if (typeof item !== 'string') fail(p, 'must be a string (PEM or file path)')
    if (item.includes('-----BEGIN')) {
      result.push(item)
    } else {
      // treat as a file path
      result.push(fs.readFileSync(item, 'utf8'))
    }
  })
  return result.length ? result : undefined
}

/** Admin values may be a string or array of strings → array. */
function strList(value, path, fallback = undefined) {
  if (value === undefined || value === null) return fallback
  const items = Array.isArray(value) ? value : [value]
  if (!items.length) return fallback
  items.forEach((item, i) => {
    if (typeof item !== 'string' || !item.trim()) fail(`${path}[${i}]`, 'must be a non-empty string')
  })
  return items.map(s => s.trim())
}

function normalizeAttrs(attrs, providerPath, type) {
  if (attrs === undefined || attrs === null) attrs = {}
  if (typeof attrs !== 'object' || Array.isArray(attrs)) {
    fail(`${providerPath}.attrs`, 'must be an object')
  }
  const get = (key, fallback) =>
    attrs[key] ?? attrs[`${key}Field`] ?? attrs[`${key}Attribute`] ?? fallback
  const out = {
    userId: str(get('userId', type === 'saml' ? 'nameID' : 'id'), `${providerPath}.attrs.userId`, { required: true }),
    email: str(get('email', 'email'), `${providerPath}.attrs.email`, { required: true }),
    firstName: str(get('firstName', 'givenName'), `${providerPath}.attrs.firstName`, { fallback: '' }),
    lastName: str(get('lastName', 'sn'), `${providerPath}.attrs.lastName`, { fallback: '' }),
  }
  if (attrs.admin !== undefined) {
    const admin = attrs.admin
    if (typeof admin === 'string') {
      out.admin = { field: admin, values: [] }
    } else {
      const field = str(admin.field ?? admin.attribute, `${providerPath}.attrs.admin.field`, { required: true })
      const values = strList(admin.values ?? admin.value, `${providerPath}.attrs.admin.values`, [])
      out.admin = { field, values }
    }
  }
  return out
}

function normalizeOidc(raw, providerPath) {
  const oidc = raw && typeof raw === 'object' ? raw : {}
  // passport-openidconnect (like the original Overleaf CE) requires explicit
  // issuer + endpoint URLs; it does not perform OIDC discovery at construction.
  const issuer = str(oidc.issuer, `${providerPath}.oidc.issuer`, { required: true })
  const authorizationUrl = str(
    oidc.authorizationUrl ?? oidc.authorizationURL ?? oidc.authUrl,
    `${providerPath}.oidc.authorizationUrl`,
    { required: true }
  )
  const tokenUrl = str(
    oidc.tokenUrl ?? oidc.tokenURL,
    `${providerPath}.oidc.tokenUrl`,
    { required: true }
  )
  const userInfoUrl = str(
    oidc.userInfoUrl ?? oidc.userInfoURL,
    `${providerPath}.oidc.userInfoUrl`,
    { required: true }
  )
  const clientId = str(oidc.clientId ?? oidc.clientID, `${providerPath}.oidc.clientId`, { required: true })
  return {
    issuer,
    authorizationUrl,
    tokenUrl,
    userInfoUrl,
    clientId,
    clientSecret: oidc.clientSecret ?? oidc.client_secret,
    scope: str(oidc.scope, `${providerPath}.oidc.scope`, { fallback: 'openid profile email' }),
    logoutUrl: oidc.logoutUrl ?? oidc.logoutURL,
    hideWhenNotLinked: bool(oidc.hideWhenNotLinked, `${providerPath}.oidc.hideWhenNotLinked`, false),
  }
}

/**
 * Generic OAuth2 authorization-code source (GitHub, GitLab, Gitea, …).
 * Unlike OIDC there is no standard userinfo endpoint: the profile is read
 * from `userUrl` (and optionally `emailUrl`) with the access token, which is
 * what Forgejo's OAuth2 sources do as well.
 */
function normalizeOauth2(raw, providerPath) {
  const oauth2 = raw && typeof raw === 'object' ? raw : {}
  const authorizeUrl = str(
    oauth2.authorizeUrl ?? oauth2.authorizationUrl ?? oauth2.authUrl,
    `${providerPath}.oauth2.authorizeUrl`,
    { required: true }
  )
  const tokenUrl = str(
    oauth2.tokenUrl ?? oauth2.tokenURL,
    `${providerPath}.oauth2.tokenUrl`,
    { required: true }
  )
  const userUrl = str(
    oauth2.userUrl ?? oauth2.profileUrl ?? oauth2.profileURL,
    `${providerPath}.oauth2.userUrl`,
    { required: true }
  )
  const clientId = str(
    oauth2.clientId ?? oauth2.clientID ?? oauth2.key,
    `${providerPath}.oauth2.clientId`,
    { required: true }
  )
  return {
    authorizeUrl,
    tokenUrl,
    userUrl,
    emailUrl: oauth2.emailUrl ?? oauth2.emailURL,
    clientId,
    clientSecret: oauth2.clientSecret ?? oauth2.secret,
    scope: str(oauth2.scope, `${providerPath}.oauth2.scope`, { fallback: '' }),
    // extra Accept header for the profile calls, e.g. GitHub's
    // "application/vnd.github+json"; undefined = none
    apiAcceptHeader: oauth2.apiAcceptHeader,
  }
}
function normalizeSaml(raw, providerPath) {
  const saml = raw && typeof raw === 'object' ? raw : {}
  return {
    entryPoint: str(saml.entryPoint ?? saml.idpSsoUrl ?? saml.idpEntityId, `${providerPath}.saml.entryPoint`, { required: true }),
    spIssuer: saml.spIssuer ?? saml.issuer,
    audience: saml.audience,
    idpCert: readCertMaterial(saml.idpCert ?? saml.idpCertificate ?? saml.certs, `${providerPath}.saml.idpCert`),
    privateKey: readCertMaterial(saml.privateKey, `${providerPath}.saml.privateKey`),
    decryptionPvk: readCertMaterial(saml.decryptionPvk ?? saml.decryptionKey, `${providerPath}.saml.decryptionPvk`),
    signatureAlgorithm: saml.signatureAlgorithm,
    additionalParams: saml.additionalParams ?? {},
    additionalAuthorizeParams: saml.additionalAuthorizeParams ?? {},
    identifierFormat: saml.identifierFormat,
    acceptedClockSkewMs: saml.acceptedClockSkewMs,
    attributeConsumingServiceIndex: saml.attributeConsumingServiceIndex,
    authnContext: saml.authnContext,
    forceAuthn: bool(saml.forceAuthn, `${providerPath}.saml.forceAuthn`, false),
    disableRequestedAuthnContext: bool(saml.disableRequestedAuthnContext, `${providerPath}.saml.disableRequestedAuthnContext`, false),
    authnRequestBinding: saml.authnRequestBinding,
    validateInResponseTo: saml.validateInResponseTo,
    requestIdExpirationPeriodMs: saml.requestIdExpirationPeriodMs,
    logoutUrl: saml.logoutUrl,
    additionalLogoutParams: saml.additionalLogoutParams ?? {},
    wantAssertionsSigned: bool(saml.wantAssertionsSigned, `${providerPath}.saml.wantAssertionsSigned`, true),
    wantAuthnResponseSigned: bool(saml.wantAuthnResponseSigned, `${providerPath}.saml.wantAuthnResponseSigned`, false),
  }
}

/**
 * Normalize and validate one provider object.
 * @param {object} raw provider config (canonical shape, or convenience aliases)
 * @returns {object} canonical provider
 */
export function normalizeProvider(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('provider must be an object')
  }
  const path = `provider`
  const id = str(raw.id ?? raw.providerId, `${path}.id`, { required: true })
  if (!ID_RE.test(id)) {
    fail(`${path}.id`, `"${id}" must match ${ID_RE} (lowercase letters, digits, . _ -)`)
  }
  const type = str(raw.type ?? raw.protocol, `${path}.type`, { required: true }).toLowerCase()
  if (!['oidc', 'oauth2', 'saml'].includes(type)) {
    fail(`${path}.type`, `"${type}" must be "oidc", "oauth2" or "saml"`)
  }
  const name = str(raw.name ?? raw.identityServiceName, `${path}.name`, {
    fallback: raw.identityServiceName || type.toUpperCase() + ' ' + id,
  })
  const enabled = bool(raw.enabled ?? raw.active, `${path}.enabled`, true)
  const preset = raw.preset

  const p = { id, type, name, enabled, preset, source: raw.source || 'file' }

  // behavior (flat aliases accepted)
  const behavior = raw.behavior || {}
  p.behavior = {
    updateUserDetailsOnLogin: bool(
      behavior.updateUserDetailsOnLogin ?? raw.updateUserDetailsOnLogin,
      `${path}.behavior.updateUserDetailsOnLogin`,
      false
    ),
    allowedEmailDomains: strList(
      behavior.allowedEmailDomains ?? raw.allowedEmailDomains ?? raw.allowedOIDCEmailDomains,
      `${path}.behavior.allowedEmailDomains`,
      null
    ),
    linkOnly: bool(
      behavior.linkOnly ?? raw.linkOnly,
      `${path}.behavior.linkOnly`,
      false
    ),
    // OAuth2 sources (GitHub & friends) must not create accounts from an
    // unverified email; OIDC/SAML keep the legacy behaviour unless opted in.
    verifiedEmailRequired: bool(
      behavior.verifiedEmailRequired ?? raw.verifiedEmailRequired,
      `${path}.behavior.verifiedEmailRequired`,
      type === 'oauth2'
    ),
  }

  // filter (defaults: no rules, exceptions on)
  p.filter = normalizeFilter(raw.filter)

  // attrs, preset defaults applied earlier by the store if needed
  p.attrs = normalizeAttrs(raw.attrs, path, type)

  if (type === 'oidc') {
    p.oidc = normalizeOidc(raw.oidc ?? raw.connection, path)
  } else if (type === 'oauth2') {
    p.oauth2 = normalizeOauth2(raw.oauth2 ?? raw.connection, path)
  } else {
    p.saml = normalizeSaml(raw.saml ?? raw.connection, path)
    if (!p.saml.idpCert) {
      fail(`${path}.saml.idpCert`, 'is required (IdP signing certificate, PEM or file path)')
    }
  }

  return p
}

/** Validate a list of providers; enforces unique ids. */
export function normalizeProviders(list) {
  if (!Array.isArray(list)) throw new Error('provider list must be an array')
  const seen = new Set()
  return list.map((raw, i) => {
    const provider = normalizeProvider(raw)
    if (seen.has(provider.id)) {
      throw new Error(`providers[${i}].id: duplicate provider id "${provider.id}"`)
    }
    seen.add(provider.id)
    return provider
  })
}
