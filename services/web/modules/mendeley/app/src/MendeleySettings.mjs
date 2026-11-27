/**
 * Mendeley connector settings + OAuth URL builder.
 * Pure (only Settings) — imported by the API client, the router gate, and
 * the /bib/services endpoint, and unit-tested directly.
 *
 * Seeded from MENDELEY_* env in modules/bib-editor/index.mjs (client id AND
 * secret both required for the connector to be "configured" — the frontend
 * hides the UI when either is missing).
 */
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'

const AUTHORIZE_URL = 'https://api.mendeley.com/oauth/authorize'

export function getMendeleySettings() {
  const m = Settings.mendeley || {}
  return {
    enabled: m.enabled !== false,
    clientID: m.clientID || m.clientId || '',
    clientSecret: m.clientSecret || '',
    callbackURL: m.callbackURL || '',
  }
}

export function isMendeleyConfigured() {
  const s = getMendeleySettings()
  return s.enabled && Boolean(s.clientID && s.clientSecret)
}

export function assertMendeleyConfigured() {
  if (!isMendeleyConfigured()) {
    throw new OError('Mendeley is not configured on this site', { status: 403 })
  }
}

export function getMendeleyAuthorizeUrl(state) {
  const s = getMendeleySettings()
  const q = new URLSearchParams({
    client_id: s.clientID,
    redirect_uri: s.callbackURL,
    response_type: 'code',
    scope: 'all',
    state,
  })
  return `${AUTHORIZE_URL}?${q.toString()}`
}
