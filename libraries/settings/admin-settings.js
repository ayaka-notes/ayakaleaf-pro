/*
 * Admin-managed site settings — self-contained hydration for service
 * config files (config/settings.defaults.js).
 *
 * The web admin page ("Site Settings", /admin/site-settings) stores
 * admin-chosen values in the `site_settings` collection of the site's
 * MongoDB (one document, `_id: 'global'`, one key per section). This
 * helper lets every service resolve those stored values at config load
 * time, self-contained: no snapshot files, no config server, no boot
 * script — the stored document comes straight from the MongoDB the site
 * already runs.
 *
 * Precedence (owner requirement, 2026-11-10):
 *   1. the process environment (docker compose / docker -e) — ALWAYS wins
 *   2. the stored admin value (the site_settings document)
 *   3. the fallback (the setting's own default)
 *
 * The stored document is read once per process (memoized) by a short
 * lived `node` child that performs the async MongoDB read and prints
 * the document as JSON on stdout. The child inherits the container
 * environment (OVERLEAF_MONGO_URL / MONGO_URL and, in the PnP image,
 * the NODE_OPTIONS PnP hooks), so it needs nothing else. Any failure —
 * mongo unreachable, timeout, no stored document — degrades to "no
 * stored values": the environment and the setting defaults stand,
 * exactly as before this feature existed. Boot is never blocked for
 * more than ~8 s (and never on the happy path, where the read takes a
 * few hundred ms).
 *
 * Usage in a service's config/settings.defaults.js:
 *
 *   const { stored, resolveEnv } = require('@overleaf/settings/admin-settings')
 *
 *   // compact form — env first, then the stored admin value, then the
 *   // setting's own default:
 *   host: process.env.OVERLEAF_EMAIL_SMTP_HOST || stored('email', 'host') || '',
 *
 *   // or the explicit form when you want one call to do the resolution:
 *   host: resolveEnv('OVERLEAF_EMAIL_SMTP_HOST', 'email', 'host', ''),
 *
 * `stored(...)` returns `undefined` when the section/field has no stored
 * value, so it composes with `||` chains exactly like the existing
 * `process.env.X || default` lines do.
 */
'use strict'

const { execFileSync } = require('node:child_process')
const Path = require('node:path')

const READ_SCRIPT = Path.join(__dirname, 'admin-settings-read.cjs')
const READ_TIMEOUT_MS = 8000

let cachedDoc = null // null = not read yet; {} = read (empty) or failed

/**
 * The stored site_settings document, or {} when it cannot be read.
 * Memoized per process; the read happens at most once per boot.
 */
function readStoredDoc() {
  if (cachedDoc !== null) return cachedDoc
  try {
    const out = execFileSync(process.execPath, [READ_SCRIPT], {
      encoding: 'utf8',
      timeout: READ_TIMEOUT_MS,
      // stderr is piped (not inherited) so a failing read stays silent;
      // the degradation is to defaults, which is the documented behavior.
      stdio: ['ignore', 'pipe', 'pipe'],
      // a document with every section is small; a large cap is harmless
      maxBuffer: 1024 * 1024,
    })
    const parsed = JSON.parse(out || '{}')
    cachedDoc = parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    // No mongo, timeout, malformed output — stored values stand in for
    // nothing; env and defaults apply. (Debug: set
    // OVERLEAF_ADMIN_SETTINGS_DEBUG=1 to see the reason.)
    cachedDoc = {}
    if (process.env.OVERLEAF_ADMIN_SETTINGS_DEBUG) {
      console.warn('admin-settings: no stored values (', err.message, ')')
    }
  }
  return cachedDoc
}

/**
 * One stored field, or undefined when not stored.
 *
 * @param {string} section  section key of the site_settings document
 * @param {string} field    field key inside that section
 * @returns {any|undefined}
 */
function stored(section, field) {
  const doc = readStoredDoc()
  const value = doc && doc[section] ? doc[section][field] : undefined
  if (value === undefined || value === null || value === '') return undefined
  return value
}

/**
 * The whole stored section, or {} when not stored.
 *
 * @param {string} section
 * @returns {object}
 */
function section(sectionName) {
  const doc = readStoredDoc()
  const value = doc && doc[sectionName]
  return value && typeof value === 'object' ? value : {}
}

/**
 * Env-wins resolution of one admin-managed parameter:
 * non-empty process env → stored admin value → fallback.
 *
 * @param {string} envName    the environment variable the admin page mirrors
 * @param {string} section    the site_settings section
 * @param {string} field      the field inside that section
 * @param {*} [fallback]      the setting's own default
 * @returns {*}
 */
function resolveEnv(envName, section, field, fallback) {
  const envValue = process.env[envName]
  if (typeof envValue === 'string' && envValue.length > 0) return envValue
  const storedValue = stored(section, field)
  if (storedValue !== undefined) return storedValue
  return fallback
}

/**
 * Mirror stored admin values into the process environment — for services
 * whose code (settings.defaults and modules) reads the mirrored env vars
 * directly. Rules, exactly as for the direct resolution:
 *  - a NON-EMPTY existing env var is never touched (docker env wins);
 *  - an empty/unset var is filled from the stored section/field when one
 *    is stored;
 *  - stored values are stringified the way the services expect (booleans
 *    as "true"/"false", numbers as decimal strings, lists comma-joined).
 *
 * Call it at the TOP of config/settings.defaults.js with the list of
 * [envName, section, field] triples the service consumes — one place, the
 * whole set of admin-managed parameters of the service:
 *
 *   const { mirrorIntoEnv } = require('@overleaf/settings/admin-settings')
 *   mirrorIntoEnv([
 *     ['ENABLE_PDF_CONVERSIONS', 'conversions', 'pdfConversions'],
 *     ['COMPILE_SIZE_LIMIT', 'sandboxed-compiles', 'compileSizeLimit'],
 *   ])
 *
 * The existing `process.env.X || default` lines then pick the stored
 * values up unchanged. No-op when the stored document is empty.
 *
 * @param {Array<[string, string, string]>} pairs
 */
function mirrorIntoEnv(pairs) {
  if (!Array.isArray(pairs)) return
  const doc = readStoredDoc()
  for (const pair of pairs) {
    const envName = pair[0]
    const sectionName = pair[1]
    const field = pair[2]
    const current = process.env[envName]
    if (typeof current === 'string' && current.length > 0) continue // env wins
    const storedValue = doc && doc[sectionName] ? doc[sectionName][field] : undefined
    if (storedValue === undefined || storedValue === null || storedValue === '') continue
    process.env[envName] = stringifyForEnv(storedValue)
  }
}

/** Stored value → the string a service expects from an env var. */
function stringifyForEnv(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    // images: [{image, name}] rows are not an env format — mirror the
    // image list (the names are consumed from the settings object, not
    // the env line, in the services that care)
    if (value.length && value[0] && typeof value[0] === 'object') {
      return value.map(r => (r && r.image) || '').filter(Boolean).join(',')
    }
    return value.map(v => String(v)).join(',')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

module.exports = {
  stored,
  section,
  resolveEnv,
  mirrorIntoEnv,
  readStoredDoc,
  // test seam
  __test: {
    reset: () => {
      cachedDoc = null
    },
  },
}
