/**
 * SSO provider store: the single source of truth for the SSO sources of
 * this server.
 *
 * Providers come from two places:
 *   1. a JSON file (default `config/ssos.providers.json`, overridable via
 *      OVERLEAF_SSO_PROVIDERS_FILE). Hand-editable, easy to copy between
 *      systems; the admin UI edits the same file.
 *   2. legacy environment variables (OVERLEAF_OIDC_*, OVERLEAF_SAML_*):
 *      derived into one provider each, ids `oidc` / `1`, so existing
 *      deployments and existing account links keep working unchanged.
 *      File providers with the same id win over env providers.
 *
 * The store is a small in-memory registry with an onChange hook, so the
 * passport strategies and the login page can be (re)built on change.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import { normalizeProvider } from './schema.mjs'
import { applyPreset } from './presets.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Default: services/web/config/ssos.providers.json */
const DEFAULT_FILE = path.resolve(__dirname, '../../../config/ssos.providers.json')

function providersFile() {
  return (
    process.env.OVERLEAF_SSO_PROVIDERS_FILE ||
    (process.env.OVERLEAF_DATA_DIR
      ? path.join(process.env.OVERLEAF_DATA_DIR, 'ssos.providers.json')
      : DEFAULT_FILE)
  )
}

/** Read a possibly-JSON env var (a file list like the legacy SAML cert envs).
 *  Strings containing a PEM marker are used inline; others are file paths. */
function readFilesContentFromEnv(envVar) {
  if (!envVar) return undefined
  let items
  try {
    const parsed = JSON.parse(envVar)
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch (error) {
    if (error instanceof SyntaxError) {
      items = [envVar]
    } else {
      throw error
    }
  }
  const result = items
    .filter(item => item !== undefined && item !== null && item !== '')
    .map(item => {
      if (typeof item !== 'string') throw new Error(`cert env must hold strings, got: ${typeof item}`)
      if (item.includes('-----BEGIN')) return item
      return fs.readFileSync(item, 'utf8')
    })
  return result.length ? result : undefined
}

function boolFromEnv(env) {
  if (env === undefined || env === null) return undefined
  const lower = env.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  throw new Error(`Invalid boolean env value: ${env}`)
}

function numFromEnv(env) {
  return env === undefined ? undefined : Number(env)
}

/** Derive the legacy single OIDC provider from env, or null if not set. */
function legacyOidcProvider() {
  if (!process.env.EXTERNAL_AUTH?.includes('oidc')) return null
  const issuer = process.env.OVERLEAF_OIDC_ISSUER
  const urls = {
    authorizationUrl: process.env.OVERLEAF_OIDC_AUTHORIZATION_URL,
    tokenUrl: process.env.OVERLEAF_OIDC_TOKEN_URL,
    userInfoUrl: process.env.OVERLEAF_OIDC_USER_INFO_URL,
  }
  if (!issuer && !Object.values(urls).every(Boolean)) return null
  const raw = {
    id: process.env.OVERLEAF_OIDC_PROVIDER_ID || 'oidc',
    type: 'oidc',
    name:
      process.env.OVERLEAF_OIDC_IDENTITY_SERVICE_NAME ||
      process.env.OVERLEAF_OIDC_PROVIDER_NAME ||
      'Log in with OIDC',
    ...(process.env.OVERLEAF_OIDC_PROVIDER_DESCRIPTION
      ? { descriptionKey: process.env.OVERLEAF_OIDC_PROVIDER_DESCRIPTION }
      : {}),
    ...(process.env.OVERLEAF_OIDC_PROVIDER_INFO_LINK
      ? { descriptionOptions: { link: process.env.OVERLEAF_OIDC_PROVIDER_INFO_LINK } }
      : {}),
    enabled: true,
    source: 'env',
    oidc: {
      ...(issuer ? { issuer } : {}),
      ...Object.fromEntries(Object.entries(urls).filter(([, v]) => v)),
      clientId: process.env.OVERLEAF_OIDC_CLIENT_ID,
      clientSecret: process.env.OVERLEAF_OIDC_CLIENT_SECRET,
      scope: process.env.OVERLEAF_OIDC_SCOPE,
      logoutUrl: process.env.OVERLEAF_OIDC_LOGOUT_URL,
      hideWhenNotLinked: boolFromEnv(process.env.OVERLEAF_OIDC_PROVIDER_HIDE_NOT_LINKED),
    },
    attrs: {
      userId: process.env.OVERLEAF_OIDC_USER_ID_FIELD || 'id',
      email: 'email',
      firstName: 'givenName',
      lastName: 'familyName',
      ...(process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD
        ? {
            admin: {
              field: process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD,
              values: [process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD_VALUE].filter(Boolean),
            },
          }
        : {}),
    },
    behavior: {
      updateUserDetailsOnLogin: boolFromEnv(process.env.OVERLEAF_OIDC_UPDATE_USER_DETAILS_ON_LOGIN) ?? false,
      allowedEmailDomains: process.env.OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS === undefined
        ? null
        : process.env.OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS.split(',')
            .map(s => s.trim())
            .filter(Boolean),
    },
  }
  return raw
}

/** Derive the legacy single SAML IdP from env, or null if not set. */
function legacySamlProvider() {
  if (!process.env.EXTERNAL_AUTH?.includes('saml')) return null
  if (!process.env.OVERLEAF_SAML_ENTRYPOINT) return null
  const raw = {
    id: '1', // keep the historical SAML providerId: existing links survive
    type: 'saml',
    name: process.env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || 'Log in with SAML',
    enabled: true,
    source: 'env',
    saml: {
      entryPoint: process.env.OVERLEAF_SAML_ENTRYPOINT,
      spIssuer: process.env.OVERLEAF_SAML_ISSUER,
      audience: process.env.OVERLEAF_SAML_AUDIENCE,
      idpCert: readFilesContentFromEnv(process.env.OVERLEAF_SAML_IDP_CERT),
      privateKey: readFilesContentFromEnv(process.env.OVERLEAF_SAML_PRIVATE_KEY),
      decryptionPvk: readFilesContentFromEnv(process.env.OVERLEAF_SAML_DECRYPTION_PVK),
      signatureAlgorithm: process.env.OVERLEAF_SAML_SIGNATURE_ALGORITHM,
      additionalParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_PARAMS || '{}'),
      additionalAuthorizeParams: JSON.parse(
        process.env.OVERLEAF_SAML_ADDITIONAL_AUTHORIZE_PARAMS || '{}'
      ),
      identifierFormat: process.env.OVERLEAF_SAML_IDENTIFIER_FORMAT,
      acceptedClockSkewMs: numFromEnv(process.env.OVERLEAF_SAML_ACCEPTED_CLOCK_SKEW_MS),
      attributeConsumingServiceIndex: process.env.OVERLEAF_SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX,
      authnContext: process.env.OVERLEAF_SAML_AUTHN_CONTEXT
        ? JSON.parse(process.env.OVERLEAF_SAML_AUTHN_CONTEXT)
        : undefined,
      forceAuthn: boolFromEnv(process.env.OVERLEAF_SAML_FORCE_AUTHN),
      disableRequestedAuthnContext: boolFromEnv(process.env.OVERLEAF_SAML_DISABLE_REQUESTED_AUTHN_CONTEXT),
      authnRequestBinding: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING,
      validateInResponseTo: process.env.OVERLEAF_SAML_VALIDATE_IN_RESPONSE_TO,
      requestIdExpirationPeriodMs: numFromEnv(process.env.OVERLEAF_SAML_REQUEST_ID_EXPIRATION_PERIOD_MS),
      logoutUrl: process.env.OVERLEAF_SAML_LOGOUT_URL,
      additionalLogoutParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_LOGOUT_PARAMS || '{}'),
      wantAssertionsSigned: boolFromEnv(process.env.OVERLEAF_SAML_WANT_ASSERTIONS_SIGNED),
      wantAuthnResponseSigned: boolFromEnv(process.env.OVERLEAF_SAML_WANT_AUTHN_RESPONSE_SIGNED),
    },
    attrs: {
      userId: process.env.OVERLEAF_SAML_USER_ID_FIELD || 'nameID',
      email: process.env.OVERLEAF_SAML_EMAIL_FIELD || 'nameID',
      firstName: process.env.OVERLEAF_SAML_FIRST_NAME_FIELD || 'givenName',
      lastName: process.env.OVERLEAF_SAML_LAST_NAME_FIELD || 'lastName',
      ...(process.env.OVERLEAF_SAML_IS_ADMIN_FIELD
        ? {
            admin: {
              field: process.env.OVERLEAF_SAML_IS_ADMIN_FIELD,
              values: [process.env.OVERLEAF_SAML_IS_ADMIN_FIELD_VALUE].filter(Boolean),
            },
          }
        : {}),
    },
    behavior: {
      updateUserDetailsOnLogin: boolFromEnv(process.env.OVERLEAF_SAML_UPDATE_USER_DETAILS_ON_LOGIN) ?? false,
    },
  }
  return raw
}

function rawFromFile() {
  const file = providersFile()
  if (!fs.existsSync(file)) return []
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const list = Array.isArray(parsed) ? parsed : parsed.providers
  if (!Array.isArray(list)) {
    throw new Error(
      `${file}: expected a JSON array of providers or {"providers": [...]}`
    )
  }
  return list
}

function pipeline(raw) {
  const type = String(raw?.type ?? raw?.protocol ?? '').toLowerCase()
  const withPreset = raw.preset ? applyPreset(raw.preset, type, raw) : raw
  const provider = normalizeProvider(withPreset)
  provider.source = raw.source || 'file'
  return provider
}

class ProviderStore {
  /** @type {Map<string, object>} id → normalized provider */
  providers = new Map()
  /** @type {string|null} resolved config file (null if none configured/exists) */
  file = null
  /** @type {Set<() => void>} */
  listeners = new Set()

  constructor() {
    this.reload()
  }

  /** (Re)load all providers from file + legacy env. */
  reload() {
    const next = new Map()
    // 1. legacy env providers (id 'oidc' / '1') — derived, read-only
    for (const raw of [legacyOidcProvider(), legacySamlProvider()]) {
      if (!raw) continue
      const provider = pipeline(raw)
      next.set(provider.id, provider)
    }
    // 2. file providers win (also for clashing ids)
    let fileProviders = []
    try {
      const rawList = rawFromFile()
      if (rawList.length) {
        this.file = providersFile()
      } else {
        this.file = null
      }
      fileProviders = rawList.map(pipeline)
      const ids = fileProviders.map(p => p.id)
      if (new Set(ids).size !== ids.length) {
        throw new Error(`duplicate provider id in ${providersFile()}`)
      }
    } catch (error) {
      fileProviders = []
      this.file = null
      if (error instanceof SyntaxError) {
        logger.error({ err: error, file: providersFile() }, 'SSO providers file is not valid JSON — file providers disabled')
      } else {
        logger.error({ err: error, file: providersFile() }, 'invalid SSO providers file — file providers disabled')
      }
    }
    for (const provider of fileProviders) {
      next.set(provider.id, provider)
    }
    this.providers = next
    this.emitChange()
    return this
  }

  emitChange() {
    for (const listener of this.listeners) {
      try {
        listener(this)
      } catch (error) {
        logger.error({ err: error }, 'SSO provider store listener failed')
      }
    }
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  all() {
    return [...this.providers.values()]
  }

  ofType(type) {
    return this.all().filter(p => p.type === type && p.enabled)
  }

  get(id) {
    return this.providers.get(id) ?? null
  }

  firstOfType(type) {
    return this.ofType(type)[0] ?? null
  }

  /**
   * Validate a raw provider (preset + schema) without touching the store.
   * @throws with a descriptive message on invalid input
   */
  validate(raw) {
    return pipeline(raw)
  }

  /**
   * Create or update a provider and persist the file providers.
   * Env-derived providers cannot be modified.
   */
  upsert(raw) {
    const provider = this.validate(raw)
    const existing = this.providers.get(provider.id)
    if (existing?.source === 'env') {
      throw new Error(
        `provider "${provider.id}" comes from legacy environment variables and cannot be edited here; remove the OVERLEAF_* env vars to use file-based configuration`
      )
    }
    provider.source = 'file'
    this.providers.set(provider.id, provider)
    this.save()
    this.emitChange()
    return provider
  }

  /** Toggle enabled flag. */
  setEnabled(id, enabled) {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`no such provider: ${id}`)
    if (provider.source === 'env') {
      throw new Error(`provider "${id}" comes from environment variables and cannot be disabled here`)
    }
    provider.enabled = Boolean(enabled)
    this.save()
    this.emitChange()
    return provider
  }

  /** Delete a provider (env providers cannot be deleted). */
  remove(id) {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`no such provider: ${id}`)
    if (provider.source === 'env') {
      throw new Error(`provider "${id}" comes from environment variables and cannot be deleted here`)
    }
    this.providers.delete(id)
    this.save()
    this.emitChange()
  }

  /** Write all file providers back to the JSON file. */
  save() {
    const file = providersFile()
    const dir = path.dirname(file)
    fs.mkdirSync(dir, { recursive: true })
    const fileProviders = [...this.providers.values()].filter(p => p.source === 'file')
    fs.writeFileSync(file, JSON.stringify(fileProviders, null, 2) + '\n', 'utf8')
    this.file = file
    return file
  }
}

export const store = new ProviderStore()
export { providersFile }
export default store
