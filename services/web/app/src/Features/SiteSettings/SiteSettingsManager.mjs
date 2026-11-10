/**
 * SiteSettings — admin-managed site configuration backed by MongoDB.
 *
 * One document per site
 * `{ _id: 'global', <section>: {...}, <section>: {...}, updatedAt }`
 * in the `site_settings` collection (registered in
 * `app/src/infrastructure/mongodb.mjs` as `db.siteSettings`).
 *
 * Semantics (2026-11-10, owner directive — INVERTED vs. the 6.3.0_post
 * prototype, where stored won over env):
 *
 *  - **EXTERNAL DOCKER ENV WINS.** A non-empty environment variable
 *    (compose file / `docker -e`) always overrides the stored admin
 *    value for the parameter it mirrors. This is the deployment owner's
 *    control plane; the admin page is a convenience layer under it.
 *  - Stored value second: it applies wherever the env var is unset or
 *    empty — and keeps meaning if the env var is removed later.
 *  - The setting's own default third.
 *
 * How services see the stored values (self-contained, no snapshot
 * files, no config server): every service resolves them in its own
 * `config/settings.defaults.js` at boot, via
 * `@overleaf/settings/admin-settings` (see
 * `libraries/settings/admin-settings.js`):
 *
 *     host: process.env.OVERLEAF_EMAIL_SMTP_HOST || stored('email', 'host') || ''
 *
 * because a MongoDB read is async and config files load synchronously,
 * that helper performs one short-lived `node` child read per process
 * boot, memoized, fail-soft (no mongo → env + defaults stand).
 *
 * Effective values therefore change when a service (re)starts — e.g.
 * on the next container cycle. The admin page marks every field whose
 * value currently comes from the environment (envSet) so admins see
 * exactly what their save would override and what already overrides it.
 *
 * Secrets (SMTP password, OAuth client secrets, SSO certs/keys, …) are
 * stored ENCRYPTED (./SecretCipher.mjs — the same cipher file and
 * label family as the dropbox / github-sync token ciphers), never
 * returned in plaintext by the API (masked + `<field>Set` flag), and
 * an empty secret in a PUT payload means "keep the stored value".
 *
 * Reads are per-request with a short TTL cache + in-flight dedupe
 * (the web app runs multiple workers — no process-local truth), so an
 * admin save is visible within ~5 s.
 */
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { encryptText, decryptText } from './SecretCipher.mjs'

const SECTION_ID = 'global'
const CACHE_TTL_MS = 5_000

// ---------------------------------------------------------------------------
// 2026-08-31 (P0 tripwire, ported from the 6.3.0_post prototype):
// site_settings is LIVE SITE STATE. Unit tests must never read/write the
// production database — fail loudly when a test process is bound to the
// live `sharelatex` database.
// ---------------------------------------------------------------------------
function assertNotLiveDbInTests() {
  const inTest = !!(
    process.env.VITEST_WORKER_ID ||
    process.env.__VITEST_WORKER_ID ||
    process.env.VITEST === 'true'
  )
  if (!inTest) return
  let dbName = ''
  try {
    const url = String(Settings.mongo.url || '')
    const segments = url.split('/').filter(Boolean)
    dbName = segments.length ? segments[segments.length - 1] : ''
  } catch (err) {
    return // Settings not available in this context: nothing to check
  }
  if (dbName === 'sharelatex') {
    const err = new Error(
      'FATAL (test tripwire): a unit-test process is bound to the LIVE sharelatex database. Set MONGO_URL to a unit database BEFORE any web-stack import. Refusing to touch live site settings.'
    )
    err.liveDbTripwire = true
    throw err
  }
}

/** Lazy collection access (see the prototype's rationale). */
async function getCollection() {
  assertNotLiveDbInTests()
  try {
    // eslint-disable-next-line prefer-const
    let dbModule
    try {
      dbModule = await import('../../infrastructure/mongodb.mjs')
    } catch (err) {
      logger.warn({ err }, 'SiteSettings: raw db unavailable')
      return null
    }
    return dbModule.db.siteSettings
  } catch (err) {
    logger.warn({ err }, 'SiteSettings: site_settings collection unavailable')
    return null
  }
}

/** In-section field names that hold encrypted values. */
export const SECRET_FIELDS = {
  'github-sync': ['clientSecret'],
  dropbox: ['appSecret'],
  email: ['pass', 'sesSecret'],
  'sso-saml': ['idpCert', 'privateKey', 'decryptionPvk'],
  'sso-oidc': ['clientSecret'],
  'sso-ldap': ['bindCredentials'],
}

let _cache = { at: 0, doc: undefined }
let _inflight = null

function now() {
  return Date.now()
}

function loadDoc() {
  if (now() - _cache.at < CACHE_TTL_MS && _cache.doc !== undefined) {
    return Promise.resolve(_cache.doc)
  }
  if (!_inflight) {
    _inflight = getCollection()
      .then(siteSettings =>
        siteSettings
          ? siteSettings.findOne({ _id: SECTION_ID })
          : Promise.resolve(null)
      )
      .then(doc => {
        _cache = { at: now(), doc: doc || null }
        _inflight = null
        return _cache.doc
      })
      // Fail-soft: a transient DB outage must not 500 the page — treat
      // the stored layer as empty (env + defaults stand) and log it.
      .catch(err => {
        logger.warn({ err }, 'SiteSettings: stored doc read failed; using env+defaults')
        _cache = { at: now(), doc: null }
        _inflight = null
        return null
      })
      .catch(err => {
        if (err && err.liveDbTripwire) {
          _inflight = null
          throw err
        }
        // Read failures degrade to env + defaults; the failure is not cached.
        logger.warn({ err }, 'SiteSettings: load failed, using env + defaults')
        _inflight = null
        return null
      })
  }
  return _inflight
}

/**
 * The canonical section → field → environment-variable map. This is the
 * SINGLE SOURCE OF TRUTH for which env var each admin field mirrors:
 *  - the env seeds below and the `envSet` detection read it;
 *  - the service config files reference the same triples in
 *    `stored('section', 'field')` calls (checked by
 *    `test/unit/src/site-settings-consistency.test.mjs`);
 *  - the admin UI shows the mirrored var next to each field, so an admin
 *    can always see which compose line would win over their value.
 */
export const SECTION_ENV_FIELDS = {
  'sandboxed-compiles': {
    enabled: 'SANDBOXED_COMPILES',
    dockerRunner: 'DOCKER_RUNNER',
    hostDir: 'SANDBOXED_COMPILES_HOST_DIR',
    socketPath: 'DOCKER_SOCKET_PATH',
    extraFlags: 'TEX_COMPILER_EXTRA_FLAGS',
    imageUser: 'TEXLIVE_IMAGE_USER',
    defaultImage: 'TEX_LIVE_DOCKER_IMAGE',
    images: 'ALL_TEX_LIVE_DOCKER_IMAGES',
    compileBodySizeLimitMb: 'COMPILE_BODY_SIZE_LIMIT_MB',
    compileSizeLimit: 'COMPILE_SIZE_LIMIT',
    texliveOpenoutAny: 'TEXLIVE_OPENOUT_ANY',
    texliveMaxPrintLine: 'TEXLIVE_MAX_PRINT_LINE',
  },
  conversions: {
    pandocEnabled: 'ENABLE_PANDOC_CONVERSIONS',
    pdfConversions: 'ENABLE_PDF_CONVERSIONS',
    png2pdfConversions: 'ENABLE_PNG2PDF_CONVERSIONS',
    conversionTimeoutSeconds: 'CLSI_CONVERSION_TIMEOUT_SECONDS',
  },
  'git-integration': {
    enabled: 'GIT_BRIDGE_ENABLED',
    host: 'GIT_BRIDGE_HOST',
    port: 'GIT_BRIDGE_PORT',
  },
  'github-sync': {
    enabled: 'GITHUB_SYNC_ENABLED',
    clientId: 'GITHUB_SYNC_CLIENT_ID',
    clientSecret: 'GITHUB_SYNC_CLIENT_SECRET',
    cipherFile: 'GITHUB_TOKEN_CIPHER_FILE',
    cipherLabel: 'GITHUB_TOKEN_CIPHER_LABEL',
  },
  dropbox: {
    enabled: 'DROPBOX_ENABLED',
    appKey: 'DROPBOX_APP_KEY',
    appSecret: 'DROPBOX_APP_SECRET',
    apiDomain: 'DROPBOX_API_DOMAIN',
  },
  email: {
    skipConfirmation: 'EMAIL_CONFIRMATION_DISABLED',
    fromAddress: 'OVERLEAF_EMAIL_FROM_ADDRESS',
    replyTo: 'OVERLEAF_EMAIL_REPLY_TO',
    driver: 'OVERLEAF_EMAIL_DRIVER',
    host: 'OVERLEAF_EMAIL_SMTP_HOST',
    port: 'OVERLEAF_EMAIL_SMTP_PORT',
    secure: 'OVERLEAF_EMAIL_SMTP_SECURE',
    ignoreTLS: 'OVERLEAF_EMAIL_SMTP_IGNORE_TLS',
    name: 'OVERLEAF_EMAIL_SMTP_NAME',
    user: 'OVERLEAF_EMAIL_SMTP_USER',
    pass: 'OVERLEAF_EMAIL_SMTP_PASS',
    accessKeyId: 'OVERLEAF_EMAIL_AWS_SES_ACCESS_KEY_ID',
    sesSecret: 'OVERLEAF_EMAIL_AWS_SES_SECRET_KEY',
    sesRegion: 'OVERLEAF_EMAIL_AWS_SES_REGION',
    adminEmail: 'OVERLEAF_ADMIN_EMAIL',
    customFooter: 'OVERLEAF_CUSTOM_EMAIL_FOOTER',
    enableOnboardingEmails: 'ENABLE_ONBOARDING_EMAILS',
  },
  'linked-file-types': {
    enabledTypes: 'ENABLED_LINKED_FILE_TYPES',
  },
  externalUrl: {
    blockedNetworks: 'OVERLEAF_LINKED_URL_BLOCKED_NETWORKS',
    allowedResourcesRegex: 'OVERLEAF_LINKED_URL_ALLOWED_RESOURCES',
  },
  templates: {
    enabled: 'OVERLEAF_TEMPLATE_GALLERY',
    nonAdminCanPublishTemplates: 'OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES',
  },
  'sso-saml': {
    issuer: 'OVERLEAF_SAML_ISSUER',
    entryPoint: 'OVERLEAF_SAML_ENTRYPOINT',
    idpCert: 'OVERLEAF_SAML_IDP_CERT',
    privateKey: 'OVERLEAF_SAML_PRIVATE_KEY',
    decryptionPvk: 'OVERLEAF_SAML_DECRYPTION_PVK',
  },
  'sso-oidc': {
    issuer: 'OVERLEAF_OIDC_ISSUER',
    clientID: 'OVERLEAF_OIDC_CLIENT_ID',
    clientSecret: 'OVERLEAF_OIDC_CLIENT_SECRET',
    authorizationURL: 'OVERLEAF_OIDC_AUTHORIZATION_URL',
    tokenURL: 'OVERLEAF_OIDC_TOKEN_URL',
  },
  'sso-ldap': {
    url: 'OVERLEAF_LDAP_URL',
    searchBase: 'OVERLEAF_LDAP_SEARCH_BASE',
    bindDN: 'OVERLEAF_LDAP_BIND_DN',
    bindCredentials: 'OVERLEAF_LDAP_BIND_CREDENTIALS',
    searchFilter: 'OVERLEAF_LDAP_SEARCH_FILTER',
  },
  editor: {
    additionalTextExtensions: 'ADDITIONAL_TEXT_EXTENSIONS',
    fileIgnorePattern: 'FILE_IGNORE_PATTERN',
    preciousFilePattern: 'PRECIOUS_FILE_PATTERN',
    maxDocLength: 'MAX_DOC_LENGTH',
    maxJsonRequestSize: 'MAX_JSON_REQUEST_SIZE',
    maxUpdateSize: 'MAX_UPDATE_SIZE',
    commentMentionDelayMs: 'COMMENT_MENTION_DELAY_MS',
  },
  security: {
    adminOnlyLogin: 'ADMIN_ONLY_LOGIN',
    blockCrossOriginRequests: 'BLOCK_CROSS_ORIGIN_REQUESTS',
    allowedOrigins: 'ALLOWED_ORIGINS',
    realTimeAllowedCorsOrigins: 'REAL_TIME_ALLOWED_CORS_ORIGINS',
    cspEnabled: 'CSP_ENABLED',
    cspReportOnly: 'CSP_REPORT_ONLY',
    cspReportUri: 'CSP_REPORT_URI',
    elevatedAccountSecurityAfterFailedLoginMs:
      'ELEVATED_ACCOUNT_SECURITY_AFTER_FAILED_LOGIN_MS',
  },
  sharing: {
    allowPublicAccess: 'OVERLEAF_ALLOW_PUBLIC_ACCESS',
    allowAnonymousReadWriteSharing: 'OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING',
    disableLinkSharing: 'OVERLEAF_DISABLE_LINK_SHARING',
    disableChat: 'OVERLEAF_DISABLE_CHAT',
    linkExpiryTimeout: 'LINK_EXPIRY_TIMEOUT',
  },
  misc: {
    appName: 'APP_NAME',
    navHidePoweredBy: 'NAV_HIDE_POWERED_BY',
    robotsNoindex: 'ROBOTS_NOINDEX',
    projectHardDeletionDelayMs: 'OVERLEAF_PROJECT_HARD_DELETION_DELAY',
    userHardDeletionDelayMs: 'OVERLEAF_USER_HARD_DELETION_DELAY',
    historyRestore: 'OVERLEAF_HISTORY_RESTORE',
    enablePdfCaching: 'ENABLE_PDF_CACHING',
    maxUploadSizeMb: 'MAX_UPLOAD_SIZE',
    maxEntitiesPerProject: 'MAX_ENTITIES_PER_PROJECT',
    defaultLatexCompiler: 'DEFAULT_LATEX_COMPILER',
    projectChangeNotificationDelayMs: 'PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS',
    archiveOnSoftDelete: 'ARCHIVE_ON_SOFT_DELETE',
    keepSoftDeletedDocsArchived: 'KEEP_SOFT_DELETED_DOCS_ARCHIVED',
  },
  services: {
    v1HistoryUrl: 'V1_HISTORY_URL',
    wikiUrl: 'WIKI_URL',
  },
}

/** Allow-list of stored section keys (validator + input cleanup). */
export const SECTION_KNOWN_KEYS = Object.fromEntries(
  Object.entries(SECTION_ENV_FIELDS).map(([name, fields]) => [
    name,
    Object.keys(fields),
  ])
)

export function cleanSectionInput(name, value) {
  const allowed = SECTION_KNOWN_KEYS[name]
  if (!allowed || !value || typeof value !== 'object') return value
  const allow = new Set(allowed)
  return Object.fromEntries(Object.entries(value).filter(([k]) => allow.has(k)))
}

export function invalidateCache() {
  _cache = { at: 0, doc: undefined }
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value))
}

/** Mask encrypted secret fields for read-only API/UI surfaces. */
export function maskSecrets(sectionName, sectionValue) {
  const out = cloneDeep(sectionValue || {})
  for (const field of SECRET_FIELDS[sectionName] || []) {
    const hasValue = typeof out[field] === 'string' && out[field].length > 0
    out[`${field}Set`] = hasValue
    out[field] = ''
  }
  return out
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function envIsSet(env, name) {
  const v = env[name]
  return typeof v === 'string' && v.length > 0
}

function boolFromEnv(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function splitList(raw) {
  return String(raw || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Defaults (third precedence layer) — mirror the services' own defaults
// so the page shows what actually applies when neither env nor a stored
// value is present.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  'sandboxed-compiles': {
    enabled: false,
    dockerRunner: false,
    hostDir: '',
    socketPath: '',
    extraFlags: '',
    imageUser: '',
    defaultImage: 'texlive/texlive:latest-full',
    images: [
      { image: 'texlive/texlive:latest-full', name: 'TeXLive 2025' },
      { image: 'texlive/texlive:TL2024-historic', name: 'TeXLive 2024' },
      { image: 'texlive/texlive:TL2023-historic', name: 'TeXLive 2023' },
    ],
    compileBodySizeLimitMb: 7,
    compileSizeLimit: '7mb',
    texliveOpenoutAny: true,
    texliveMaxPrintLine: 50000,
  },
  conversions: {
    pandocEnabled: false,
    pdfConversions: false,
    png2pdfConversions: false,
    conversionTimeoutSeconds: 60, // the CLSI default
  },
  'git-integration': {
    enabled: false,
    host: 'git-bridge',
    port: 8000,
  },
  'github-sync': {
    enabled: false,
    clientId: '',
    clientSecret: '',
    cipherFile: '',
    cipherLabel: '',
  },
  dropbox: {
    enabled: false,
    appKey: '',
    appSecret: '',
    apiDomain: 'https://api.dropboxapi.com',
  },
  email: {
    skipConfirmation: false,
    fromAddress: '',
    replyTo: '',
    driver: 'smtp',
    host: '',
    port: 587,
    secure: false,
    ignoreTLS: false,
    name: '',
    user: '',
    pass: '',
    accessKeyId: '',
    sesSecret: '',
    sesRegion: '',
    adminEmail: '',
    customFooter: '',
    enableOnboardingEmails: true,
  },
  'linked-file-types': {
    enabledTypes: ['project_file', 'project_output_file'],
  },
  externalUrl: {
    blockedNetworks: [
      '127.0.0.0/8',
      '169.254.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '::1/128',
      'fe80::/10',
      'fc00::/7',
    ],
    allowedResourcesRegex: '',
  },
  templates: {
    enabled: true,
    nonAdminCanPublishTemplates: false,
  },
  'sso-saml': {},
  'sso-oidc': {},
  'sso-ldap': {},
  editor: {
    additionalTextExtensions: [],
    fileIgnorePattern: '',
    preciousFilePattern: '',
    maxDocLength: 1000000,
    maxJsonRequestSize: 1024 * 1024,
    maxUpdateSize: 1024 * 1024,
    commentMentionDelayMs: 1800000, // 30 minutes (the web default)
  },
  security: {
    adminOnlyLogin: false,
    blockCrossOriginRequests: false,
    allowedOrigins: '',
    realTimeAllowedCorsOrigins: '',
    cspEnabled: false,
    cspReportOnly: true,
    cspReportUri: '',
    elevatedAccountSecurityAfterFailedLoginMs: 0,
  },
  sharing: {
    allowPublicAccess: false,
    allowAnonymousReadWriteSharing: false,
    disableLinkSharing: false,
    disableChat: false,
    linkExpiryTimeout: 60000, // ms (the filestore default)
  },
  misc: {
    appName: 'Overleaf (Community Edition)',
    navHidePoweredBy: false,
    robotsNoindex: false,
    projectHardDeletionDelayMs: 7_776_000_000, // 90 days, in ms (the env unit)
    userHardDeletionDelayMs: 7_776_000_000, // 90 days, in ms (the env unit)
    historyRestore: false,
    enablePdfCaching: true,
    maxUploadSizeMb: 50,
    maxEntitiesPerProject: 2000,
    defaultLatexCompiler: 'pdflatex',
    projectChangeNotificationDelayMs: 100,
    archiveOnSoftDelete: false,
    keepSoftDeletedDocsArchived: true,
  },
  services: {
    v1HistoryUrl: '',
    wikiUrl: 'https://learnwiki.overleaf.com',
  },
}

/**
 * Env layer of one section (second-from-top precedence): what the
 * environment currently says, field by field. A field is "env-set" only
 * when its var is a non-empty string — matching the resolution rule in
 * `@overleaf/settings/admin-settings` exactly.
 */
function envLayer(env, name) {
  const fields = SECTION_ENV_FIELDS[name]
  const layer = {}
  const set = {}
  if (!fields) return { layer, set }
  for (const [field, envName] of Object.entries(fields)) {
    if (!envIsSet(env, envName)) continue
    set[field] = true
    const raw = env[envName]
    switch (field) {
      case 'enabled':
      case 'dockerRunner':
      case 'skipConfirmation':
      case 'secure':
      case 'ignoreTLS':
      case 'pandocEnabled':
      case 'pdfConversions':
      case 'png2pdfConversions':
      case 'navHidePoweredBy':
      case 'robotsNoindex':
      case 'historyRestore':
      case 'enablePdfCaching':
      case 'adminOnlyLogin':
      case 'blockCrossOriginRequests':
      case 'cspEnabled':
      case 'cspReportOnly':
      case 'allowPublicAccess':
      case 'allowAnonymousReadWriteSharing':
      case 'disableLinkSharing':
      case 'disableChat':
      case 'archiveOnSoftDelete':
      case 'keepSoftDeletedDocsArchived':
      case 'texliveOpenoutAny':
      case 'nonAdminCanPublishTemplates':
        layer[field] = boolFromEnv(raw)
        break
      case 'port':
      case 'conversionTimeoutSeconds':
      case 'maxDocLength':
      case 'maxJsonRequestSize':
      case 'maxUpdateSize':
      case 'commentMentionDelayMs':
      case 'elevatedAccountSecurityAfterFailedLoginMs':
      case 'maxEntitiesPerProject':
      case 'linkExpiryTimeout':
      case 'texliveMaxPrintLine':
      case 'projectChangeNotificationDelayMs': {
        const n = parseInt(raw, 10)
        layer[field] = Number.isFinite(n) ? n : raw
        break
      }
      case 'compileBodySizeLimitMb':
      case 'maxUploadSizeMb': {
        const n = parseInt(raw, 10)
        layer[field] = Number.isFinite(n) ? n : raw
        break
      }
      case 'images':
        layer[field] = splitList(raw).map((image, i) => ({
          image,
          name: '',
        }))
        break
      case 'enabledTypes':
      case 'additionalTextExtensions':
        layer[field] = splitList(raw)
        break
      case 'blockedNetworks':
        layer[field] = splitList(raw)
        break
      default:
        layer[field] = raw
    }
  }
  return { layer, set }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read one section in the final precedence order — env wins over stored,
 * stored wins over defaults — with the provenance flags the UI needs:
 *
 *   value   — the effective value of every field
 *   envSet  — { field: true } for fields currently controlled by the
 *             environment (their save is effective only while the env
 *             var stays unset/empty)
 *   stored  — the stored fields only, secrets masked + `<field>Set`
 */
export async function getSection(name) {
  const fields = SECTION_ENV_FIELDS[name]
  if (!fields) throw new Error(`unknown site settings section: ${name}`)
  const doc = await loadDoc()
  const stored = (doc && doc[name]) || {}
  const env = globalThis.process.env

  // 1+2. effective value: env ?? stored ?? default
  const value = cloneDeep(DEFAULTS[name] || {})
  const { layer: envLayer_, set: envSet } = envLayer(env, name)
  for (const [field, v] of Object.entries(envLayer_)) value[field] = v
  for (const [field, v] of Object.entries(stored)) {
    if (v === undefined || v === null) continue
    // env wins: a stored value does not overwrite an env-controlled field
    if (envSet[field]) continue
    value[field] = v
  }

  // Secrets: resolve plaintext for the value (admin may want to see the
  // current effective secret source), then mask it in BOTH the value and
  // the stored copy — the API never returns secret material.
  const secrets = SECRET_FIELDS[name] || []
  const storedOut = {}
  for (const field of secrets) {
    let effective = ''
    const envName = fields[field]
    if (envIsSet(env, envName)) {
      effective = env[envName] // env set → effective (masked below)
    } else if (typeof stored[field] === 'string' && stored[field].length > 0) {
      try {
        effective = await decryptText(stored[field])
      } catch (err) {
        logger.warn({ err, section: name, field }, 'SiteSettings: stored secret decrypt failed')
        effective = ''
      }
    }
    value[field] = '' // masked
    value[`${field}Set`] = Boolean(effective)
    storedOut[field] = ''
    storedOut[`${field}Set`] =
      typeof stored[field] === 'string' && stored[field].length > 0
  }

  // Non-secret stored fields: expose a <field>Set flag so the page can
  // mark which values come from this page (their values are already
  // visible in `value`).
  for (const field of Object.keys(fields)) {
    if (secrets.includes(field)) continue
    const v = stored[field]
    if (v === undefined || v === null || v === '') continue
    storedOut[`${field}Set`] = true
  }

  return { value, envSet, stored: storedOut }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Replace a section (admin-only — the router enforces the admin guard and
 * runs the per-section validator first). A secret field in the payload is
 * the PLAINTEXT new value; an empty string means "keep the stored value"
 * (the masked placeholder from the UI).
 *
 * NOTE on the env-wins rule: saving a field that the environment
 * currently controls does not change the running behaviour — it takes
 * effect wherever the env var is unset/empty, or after the env var is
 * removed. The page communicates this via the envSet flags.
 */
export async function setSection(name, value) {
  const fields = SECTION_ENV_FIELDS[name]
  if (!fields) throw new Error(`unknown site settings section: ${name}`)
  const siteSettings = await getCollection()
  if (!siteSettings) {
    throw new Error('SiteSettings: database unavailable')
  }
  const doc = await loadDoc()
  const existing = (doc && doc[name]) ? cloneDeep(doc[name]) : {}
  const next = cleanSectionInput(name, cloneDeep(value || {}))

  for (const field of SECRET_FIELDS[name] || []) {
    const incoming = next[field]
    if (typeof incoming !== 'string' || incoming === '') {
      next[field] = existing[field] || ''
    } else {
      next[field] = await encryptText(incoming)
    }
    delete next[`${field}Set`]
  }

  const result = await siteSettings.updateOne(
    { _id: SECTION_ID },
    {
      $set: {
        [name]: next,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  )
  await writeSnapshot(siteSettings)
  invalidateCache()
  return {
    upserted: result.upsertedCount === 1,
    modified: result.modifiedCount === 1,
  }
}

/**
 * Remove the stored copy of a section: env + defaults stand again.
 * (Useful under the env-wins rule to undo a field's admin override.)
 */
export async function resetSection(name) {
  const fields = SECTION_ENV_FIELDS[name]
  if (!fields) throw new Error(`unknown site settings section: ${name}`)
  const siteSettings = await getCollection()
  if (!siteSettings) {
    throw new Error('SiteSettings: database unavailable')
  }
  await siteSettings.updateOne(
    { _id: SECTION_ID },
    { $unset: { [name]: '' } }
  )
  invalidateCache()
  return { reset: true }
}

/**
 * After every admin save, keep a timestamped full-document snapshot in
 * `site_settings_snapshots` (last 10) — the 6.3.0_post prototype kept
 * production state recoverable in one step with this. Best-effort only.
 */
async function writeSnapshot(siteSettings) {
  try {
    invalidateCache()
    const doc = await siteSettings.findOne({ _id: SECTION_ID })
    let snapshots
    try {
      const dbModule = await import('../../infrastructure/mongodb.mjs')
      snapshots = await dbModule.getCollectionInternal('site_settings_snapshots')
    } catch (err) {
      snapshots = siteSettings.collection
        ? siteSettings.collection.collection('site_settings_snapshots')
        : null
    }
    if (!snapshots) {
      throw new Error('snapshot collection unavailable')
    }
    await snapshots.insertOne({ at: new Date(), doc })
    const all = await snapshots.find({}).sort({ at: -1 }).toArray()
    if (all.length > 10) {
      await snapshots.deleteMany({ _id: { $in: all.slice(10).map(d => d._id) } })
    }
  } catch (err) {
    logger.warn({ err }, 'SiteSettings: snapshot write failed (non-fatal)')
  }
}

// ---------------------------------------------------------------------------
// Validators (run by the router before setSection)
// ---------------------------------------------------------------------------

function isObject(value) {
  return typeof value === 'object' && value !== null
}

function checkBooleans(value, fields, errors) {
  for (const f of fields) {
    if (value[f] !== undefined && typeof value[f] !== 'boolean') {
      errors.push(`${f} must be a boolean`)
    }
  }
}

function checkStrings(value, fields, errors) {
  for (const f of fields) {
    if (value[f] !== undefined && typeof value[f] !== 'string') {
      errors.push(`${f} must be a string`)
    }
  }
}

function checkInts(value, fields, errors, min = 0) {
  for (const f of fields) {
    if (value[f] !== undefined && (!Number.isInteger(value[f]) || value[f] < min)) {
      errors.push(`${f} must be an integer >= ${min}`)
    }
  }
}

function checkStringList(value, field, errors) {
  if (value[field] !== undefined && !Array.isArray(value[field])) {
    errors.push(`${field} must be an array of strings`)
  }
}

export function validateSandboxedCompilesSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(value, ['enabled', 'dockerRunner', 'texliveOpenoutAny'], errors)
  checkStrings(
    value,
    ['hostDir', 'socketPath', 'extraFlags', 'imageUser', 'defaultImage', 'compileSizeLimit'],
    errors
  )
  checkInts(value, ['texliveMaxPrintLine'], errors, 1)
  if (value.compileBodySizeLimitMb !== undefined &&
      (!Number.isInteger(value.compileBodySizeLimitMb) ||
        value.compileBodySizeLimitMb < 1 ||
        typeof value.compileBodySizeLimitMb !== 'number')) {
    errors.push('compileBodySizeLimitMb must be an integer >= 1 (megabytes)')
  }
  if (value.images !== undefined) {
    if (
      !Array.isArray(value.images) ||
      value.images.length < 1 ||
      value.images.some(r => !r || typeof r.image !== 'string' || r.image.length === 0 ||
        (r.name !== undefined && typeof r.name !== 'string'))
    ) {
      errors.push('images must be a non-empty array of { image, name? } rows')
    } else {
      const seen = new Set()
      for (const r of value.images) {
        if (seen.has(r.image)) {
          errors.push(`duplicate image: ${r.image}`)
          break
        }
        seen.add(r.image)
      }
    }
  }
  return errors
}

export function validateConversionsSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(
    value,
    ['pandocEnabled', 'pdfConversions', 'png2pdfConversions'],
    errors
  )
  checkInts(value, ['conversionTimeoutSeconds'], errors, 1)
  return errors
}

export function validateGitIntegrationSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.host !== 'string' || value.host.length === 0) {
      errors.push('host is required to enable git integration')
    }
  }
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) {
    errors.push('port must be an integer between 1 and 65535')
  }
  return errors
}

export function validateGithubSyncSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.clientId !== 'string' || value.clientId.length === 0) {
      errors.push('clientId (GitHub OAuth App ID) is required to enable GitHub sync')
    }
    const hasStored = typeof value.clientSecret === 'string' && value.clientSecret.length > 0
    if (!hasStored && !envIsSet(process.env, 'GITHUB_SYNC_CLIENT_SECRET')) {
      errors.push('clientSecret is required to enable GitHub sync (stored or via GITHUB_SYNC_CLIENT_SECRET env)')
    }
  }
  checkStrings(value, ['cipherFile', 'cipherLabel'], errors)
  return errors
}

export function validateDropboxSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.appKey !== 'string' || value.appKey.length === 0) {
      errors.push('appKey is required to enable Dropbox')
    }
  }
  checkStrings(value, ['apiDomain'], errors)
  return errors
}

export function validateEmailSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(value, ['skipConfirmation', 'secure', 'ignoreTLS', 'enableOnboardingEmails'], errors)
  if (value.driver !== undefined && !['smtp', 'ses'].includes(value.driver)) {
    errors.push('driver must be "smtp" or "ses"')
  }
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) {
    errors.push('port must be an integer between 1 and 65535')
  }
  if (value.driver === 'smtp') {
    if (typeof value.host !== 'string' || value.host.length === 0) {
      errors.push('smtp host is required for the smtp driver')
    }
  }
  if (value.driver === 'ses') {
    if (typeof value.accessKeyId !== 'string' || value.accessKeyId.length === 0) {
      errors.push('SES accessKeyId is required for the ses driver')
    }
    const hasStored = typeof value.sesSecret === 'string' && value.sesSecret.length > 0
    if (!hasStored && !envIsSet(process.env, 'OVERLEAF_EMAIL_AWS_SES_SECRET_KEY')) {
      errors.push('SES secret key is required for the ses driver (stored or env)')
    }
  }
  checkStrings(value, ['fromAddress', 'replyTo', 'user', 'name', 'sesRegion', 'adminEmail', 'customFooter'], errors)
  return errors
}

/** The linked-file agents actually present in this build. */
export const KNOWN_LINKED_FILE_TYPES = [
  'project_file',
  'project_output_file',
  'url',
  'dropbox',
]

export function validateLinkedFileTypesSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  if (!Array.isArray(value.enabledTypes)) {
    return ['enabledTypes must be an array of linked file type names']
  }
  // project_file + project_output_file are fixed on.
  for (const fixed of ['project_file', 'project_output_file']) {
    if (!value.enabledTypes.includes(fixed)) {
      errors.push(`${fixed} is always enabled and cannot be removed`)
    }
  }
  for (const t of value.enabledTypes) {
    if (typeof t !== 'string' || !KNOWN_LINKED_FILE_TYPES.includes(t)) {
      errors.push(`unknown linked file type "${t}" (known: ${KNOWN_LINKED_FILE_TYPES.join(', ')})`)
      break
    }
  }
  return errors
}

export function validateExternalUrlSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkStringList(value, 'blockedNetworks', errors)
  if (Array.isArray(value.blockedNetworks)) {
    for (const cidr of value.blockedNetworks) {
      const ok =
        typeof cidr === 'string' &&
        (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr) ||
          /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}\/\d{1,4}$/.test(cidr) ||
          /^(\d{1,3}\.){3}\d{1,3}$/.test(cidr))
      if (!ok) errors.push(`blockedNetworks: invalid IP/CIDR "${cidr}"`)
    }
  }
  if (value.allowedResourcesRegex !== undefined) {
    if (typeof value.allowedResourcesRegex !== 'string') {
      errors.push('allowedResourcesRegex must be a string ("" to clear)')
    } else if (value.allowedResourcesRegex.length > 0) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(value.allowedResourcesRegex)
      } catch (err) {
        errors.push('allowedResourcesRegex is not a valid regular expression')
      }
    }
  }
  return errors
}

export function validateTemplatesSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(value, ['enabled', 'nonAdminCanPublishTemplates'], errors)
  return errors
}

export function validateSsoSamlSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkStrings(value, ['issuer', 'entryPoint'], errors)
  return errors
}

export function validateSsoOidcSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkStrings(value, ['issuer', 'clientID', 'authorizationURL', 'tokenURL'], errors)
  return errors
}

export function validateSsoLdapSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  if (typeof value.url !== 'undefined' && (typeof value.url !== 'string' || !/^ldaps?:\/\//.test(value.url))) {
    errors.push('url must be an ldapi(s)://… server URL')
  }
  checkStrings(value, ['searchBase', 'bindDN', 'searchFilter'], errors)
  return errors
}

export function validateEditorSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkStringList(value, 'additionalTextExtensions', errors)
  checkStrings(value, ['fileIgnorePattern', 'preciousFilePattern'], errors)
  checkInts(value, ['maxDocLength', 'maxJsonRequestSize', 'maxUpdateSize', 'commentMentionDelayMs'], errors, 1)
  return errors
}

export function validateSecuritySection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(
    value,
    ['adminOnlyLogin', 'blockCrossOriginRequests', 'cspEnabled', 'cspReportOnly'],
    errors
  )
  checkStrings(value, ['allowedOrigins', 'realTimeAllowedCorsOrigins', 'cspReportUri'], errors)
  checkInts(value, ['elevatedAccountSecurityAfterFailedLoginMs'], errors)
  return errors
}

export function validateSharingSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(
    value,
    ['allowPublicAccess', 'allowAnonymousReadWriteSharing', 'disableLinkSharing', 'disableChat'],
    errors
  )
  checkInts(value, ['linkExpiryTimeout'], errors)
  return errors
}

export function validateMiscSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkBooleans(
    value,
    [
      'navHidePoweredBy',
      'robotsNoindex',
      'historyRestore',
      'enablePdfCaching',
      'archiveOnSoftDelete',
      'keepSoftDeletedDocsArchived',
    ],
    errors
  )
  checkInts(value, ['projectHardDeletionDelayMs', 'userHardDeletionDelayMs'], errors, 1)
  checkInts(value, ['maxUploadSizeMb', 'maxEntitiesPerProject'], errors, 1)
  checkInts(value, ['projectChangeNotificationDelayMs'], errors)
  if (value.appName !== undefined &&
    (typeof value.appName !== 'string' ||
      value.appName.length === 0 || value.appName.length > 64)) {
    errors.push('appName must be a non-empty string (<=64 chars)')
  }
  if (value.defaultLatexCompiler !== undefined &&
    (typeof value.defaultLatexCompiler !== 'string' ||
      value.defaultLatexCompiler.length === 0 ||
      !/^[a-z0-9_-]+$/i.test(value.defaultLatexCompiler))) {
    errors.push('defaultLatexCompiler must be a non-empty compiler name (e.g. pdflatex, lualatexmk)')
  }
  return errors
}

export function validateServicesSection(value) {
  if (!isObject(value)) return ['body must be a JSON object']
  const errors = []
  checkStrings(value, ['v1HistoryUrl', 'wikiUrl'], errors)
  return errors
}

export const SECTION_VALIDATORS = {
  'sandboxed-compiles': validateSandboxedCompilesSection,
  conversions: validateConversionsSection,
  'git-integration': validateGitIntegrationSection,
  'github-sync': validateGithubSyncSection,
  dropbox: validateDropboxSection,
  email: validateEmailSection,
  'linked-file-types': validateLinkedFileTypesSection,
  externalUrl: validateExternalUrlSection,
  templates: validateTemplatesSection,
  'sso-saml': validateSsoSamlSection,
  'sso-oidc': validateSsoOidcSection,
  'sso-ldap': validateSsoLdapSection,
  editor: validateEditorSection,
  security: validateSecuritySection,
  sharing: validateSharingSection,
  misc: validateMiscSection,
  services: validateServicesSection,
}

/** The section order of the page (tabs) and of the GET response. */
export const SECTION_ORDER = [
  'sandboxed-compiles',
  'conversions',
  'git-integration',
  'github-sync',
  'dropbox',
  'email',
  'linked-file-types',
  'externalUrl',
  'templates',
  'sso-saml',
  'sso-oidc',
  'sso-ldap',
  'editor',
  'security',
  'sharing',
  'misc',
  'services',
]
