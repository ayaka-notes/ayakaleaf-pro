/**
 * Mendeley API client (reference-manager "Core" API at api.mendeley.com).
 *
 * OAuth: the "Elsevier" flow — authorization code against
 * api.mendeley.com/oauth/authorize, tokens from /oauth/token with HTTP Basic
 * auth (clientId:clientSecret). Stored per user (encrypted JSON):
 * { accessToken, refreshToken, expiresAt } under user.refProviders.mendeley.
 *
 * Picker:
 *   GET /documents          (Accept application/vnd.mendeley-document.1+json)
 *   GET /documents/{id}     (Accept application/x-bibtex → native BibTeX,
 *                            with a local serializer as fallback)
 *   GET /groups?type=all    (Accept application/vnd.mendeley-group.1+json)
 */
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import { User } from '../../../../app/src/models/User.mjs'
import {
  fetchJson,
  fetchStringWithResponse,
} from '@overleaf/fetch-utils'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'
import {
  assertMendeleyConfigured,
  getMendeleyAuthorizeUrl,
  getMendeleySettings,
  isMendeleyConfigured,
} from './MendeleySettings.mjs'

export { getMendeleySettings, isMendeleyConfigured, assertMendeleyConfigured, getMendeleyAuthorizeUrl }
const assertConfigured = assertMendeleyConfigured

const MEND_API_URL = 'https://api.mendeley.com'
const TOKEN_URL = 'https://api.mendeley.com/oauth/token'
const DOC_ACCEPT = 'application/vnd.mendeley-document.1+json'
const GROUPS_ACCEPT = 'application/vnd.mendeley-group.1+json'
const BIBTEX_ACCEPT = 'application/x-bibtex'
const REQUEST_TIMEOUT_MS = Number(process.env.MENDELEY_TIMEOUT_MS || 30000)

// ---------------------------------------------------------------------------
// Credentials (user.refProviders.mendeley.encrypted)
// ---------------------------------------------------------------------------

function notLinkedError() {
  // The controller maps 404 → 409 "mendeley_not_linked" (same UX as zotero).
  return new OError('Mendeley account not linked', { status: 404 })
}

export async function getMendeleyCredentials(userId) {
  const user = await User.findById(userId, 'refProviders.mendeley').exec()
  const encrypted = user?.refProviders?.mendeley?.encrypted
  if (!encrypted) return null
  try {
    return await AccessTokenEncryptor.decryptToJson(encrypted)
  } catch (err) {
    logger.error(
      { userId, err },
      'failed to decrypt Mendeley credentials, treating as not connected',
    )
    return null
  }
}

export async function storeMendeleyCredentials(userId, creds) {
  const encrypted = await AccessTokenEncryptor.encryptJson({
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken || creds.accessToken,
    expiresAt: creds.expiresAt || 0,
  })
  await User.updateOne(
    { _id: userId },
    { $set: { 'refProviders.mendeley': { encrypted } } },
  ).exec()
}

export async function unlinkMendeley(userId) {
  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.mendeley': 1 } },
  ).exec()
}

export async function isMendeleyConnected(userId) {
  const creds = await getMendeleyCredentials(userId)
  return Boolean(creds)
}

// ---------------------------------------------------------------------------
// OAuth (Elsevier flow)
// ---------------------------------------------------------------------------

function basicAuthHeader(clientID, clientSecret) {
  const raw = Buffer.from(`${clientID}:${clientSecret}`).toString('base64')
  return `Basic ${raw}`
}

async function requestMendeleyToken(form) {
  const s = getMendeleySettings()
  const res = await fetch(`${TOKEN_URL}`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(s.clientID, s.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    logger.error(
      { status: res.status, body: bodyText.slice(0, 300) },
      'Mendeley token request failed',
    )
    // 400/401 = bad code/secret → treat as link problem (controller → 409)
    throw new OError('Mendeley token request failed', {
      status: 404,
      cause: new Error(`HTTP ${res.status}`),
    })
  }
  let data
  try {
    data = JSON.parse(bodyText)
  } catch {
    throw new OError('Mendeley token response invalid', { status: 404 })
  }
  if (!data.access_token) {
    throw new OError('Mendeley token response missing access_token', { status: 404 })
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600) * 1000,
  }
}

export async function exchangeMendeleyCode(code) {
  const s = getMendeleySettings()
  return requestMendeleyToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: s.callbackURL,
  })
}

export function refreshMendeleyToken(refreshToken) {
  const s = getMendeleySettings()
  return requestMendeleyToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: s.callbackURL,
  })
}

/**
 * A usable access token, refreshing when within 60 s of expiry.
 * Throws 404 (→ controller 409 "mendeley_not_linked") when unlinked or
 * when the stored token can no longer be refreshed.
 */
export async function getMendeleyAccessToken(userId) {
  assertConfigured()
  const creds = await getMendeleyCredentials(userId)
  if (!creds?.accessToken) throw notLinkedError()
  if (creds.expiresAt && creds.expiresAt > Date.now() + 60_000) {
    return creds.accessToken
  }
  if (!creds.refreshToken) throw notLinkedError()
  const refreshed = await refreshMendeleyToken(creds.refreshToken)
  if (!refreshed.refreshToken) refreshed.refreshToken = creds.refreshToken
  try {
    await storeMendeleyCredentials(userId, refreshed)
  } catch (err) {
    // usable anyway — don't kill the request because of a write failure
    logger.warn({ err }, 'failed to persist refreshed Mendeley token')
  }
  return refreshed.accessToken
}

// ---------------------------------------------------------------------------
// Picker: items, bibtex, groups
// ---------------------------------------------------------------------------

function apiHeaders(token, accept) {
  return {
    Authorization: `Bearer ${token}`,
    ...(accept ? { Accept: accept } : {}),
  }
}

function asArray(data, keys = ['items', 'documents', 'results', 'body']) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k]
    }
  }
  return []
}

function nextFrom(data) {
  if (!data || typeof data !== 'object') return null
  const next = data.next
  if (!next) return null
  if (typeof next === 'string') {
    try {
      const u = new URL(next)
      return u.searchParams.get('cursor')
    } catch {
      return null
    }
  }
  if (typeof next === 'object' && next.cursor) return String(next.cursor)
  return null
}

/**
 * Page of the user's documents (own library or a group).
 * @returns {Promise<{ items: Array<object>, next: (string|null) }>}
 */
export async function getMendeleyDocuments(
  userId,
  { groupId = '', query = '', cursor = '', limit = 100 } = {},
) {
  assertConfigured()
  const token = await getMendeleyAccessToken(userId)
  const params = new URLSearchParams({ view: 'bib' })
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 100)
  params.set('limit', String(lim))
  if (groupId) params.set('group_id', String(groupId))
  if (query) params.set('query', String(query).slice(0, 300))
  if (cursor) params.set('cursor', String(cursor))
  try {
    const data = await fetchJson(`${MEND_API_URL}/documents?${params.toString()}`, {
      headers: apiHeaders(token, DOC_ACCEPT),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return {
      items: asArray(data).slice(0, lim),
      next: nextFrom(data),
    }
  } catch (err) {
    _rethrowAsLinkError(err)
    throw err
  }
}

/**
 * BibTeX for one document. Prefers Mendeley's native export
 * (Accept: application/x-bibtex); falls back to a local serialization of
 * the bib/all view JSON (robust against endpoints that lack the bibtex
 * content type).
 */
export async function getMendeleyDocumentBibtex(userId, docId) {
  assertConfigured()
  const token = await getMendeleyAccessToken(userId)
  const id = encodeURIComponent(String(docId))
  try {
    const { body } = await fetchStringWithResponse(
      `${MEND_API_URL}/documents/${id}`,
      {
        headers: apiHeaders(token, BIBTEX_ACCEPT),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
    const text = String(body || '').replace(/\s+$/, '')
    if (/@\w+\{[^{]+\,.{0,400}/s.test(text)) return text
  } catch (err) {
    // fall through to the serializer
  }
  // Fallback: serialize the documented JSON view ourselves.
  let doc
  try {
    doc = await fetchJson(`${MEND_API_URL}/documents/${id}?view=all`, {
      headers: apiHeaders(token, DOC_ACCEPT),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    _rethrowAsLinkError(err)
    throw err
  }
  const bibtex = serializeMendeleyDocument(doc)
  if (!bibtex) {
    throw new OError('Mendeley returned nothing usable for this item', {
      status: 400,
    })
  }
  return bibtex
}

function _rethrowAsLinkError(err) {
  const status = err?.response?.status
  if (status === 401 || status === 403) {
    throw new OError('Mendeley account not linked (token rejected)', {
      status: 404,
      cause: err,
    })
  }
}

/**
 * Groups the user can list (library tabs) — [] when none.
 * Returns null when the token is rejected (→ controller 409 not-linked).
 */
export async function getMendeleyGroups(userId) {
  assertConfigured()
  const token = await getMendeleyAccessToken(userId).catch(() => {
    return null
  })
  if (!token) return null
  try {
    const data = await fetchJson(`${MEND_API_URL}/groups?type=all`, {
      headers: apiHeaders(token, GROUPS_ACCEPT),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return asArray(data, ['groups', 'items']).map(g => ({
      id: String(g.id ?? g.groupId ?? ''),
      name: g.name || `Group ${g.id ?? ''}`,
    })).filter(g => g.id)
  } catch (err) {
    _rethrowAsLinkError(err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// BibTeX serialization (see MendeleyBibtexSerializer.mjs)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Linked-file surface (ported from the tpr-webmodule lineage, 2026-11-05):
// full-library BibTeX export + the error classes the linked-file agent and
// the base UI code catch on. The Go Mendeley reference (overleaf/go
// services/web/features/mendeley) documents these as the contract.
// ---------------------------------------------------------------------------

export class MendeleyForbiddenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MendeleyForbiddenError'
  }
}

export class MendeleyExpiredError extends Error {
  constructor(message = 'Mendeley token expired') {
    super(message)
    this.name = 'MendeleyExpiredError'
  }
}

export class MendeleyAccountNotLinkedError extends Error {
  constructor(message = 'Mendeley account not linked') {
    super(message)
    this.name = 'MendeleyAccountNotLinkedError'
  }
}

function _parseNextLink(linkHeader) {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (match) return match[1]
  }
  return null
}

/** Export the user's entire Mendeley library as BibTeX. */
export async function getUserLibraryBibtex(userId) {
  return _fetchLibraryBibtex(userId, `${MEND_API_URL}/documents?view=bib&limit=100`)
}

/** Export one Mendeley group library as BibTeX. */
export async function getGroupLibraryBibtex(userId, groupId) {
  return _fetchLibraryBibtex(
    userId,
    `${MEND_API_URL}/documents?view=bib&limit=100&group_id=${encodeURIComponent(String(groupId))}`
  )
}

async function _fetchLibraryBibtex(userId, firstUrl) {
  assertConfigured()
  let allBibtex = ''
  let url = firstUrl
  while (url) {
    const token = await getMendeleyAccessToken(userId).catch(err => {
      if (err?.status === 404) throw new MendeleyAccountNotLinkedError()
      throw err
    })
    try {
      const { body: bibtex, response } = await fetchStringWithResponse(url, {
        headers: apiHeaders(token, 'application/x-bibtex'),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (bibtex.trim()) {
        allBibtex += bibtex + '\n'
      }
      url = _parseNextLink(response.headers.get('Link'))
    } catch (err) {
      if (err instanceof MendeleyAccountNotLinkedError) throw err
      const status = err?.response?.status
      if (status === 401 || status === 403) {
        throw new MendeleyForbiddenError('Mendeley API returned 401/403')
      }
      throw new OError('error fetching BibTeX from Mendeley', { userId }).withCause
        ? new OError('error fetching BibTeX from Mendeley', { userId }).withCause(err)
        : err
    }
  }
  return allBibtex
}

export { serializeMendeleyDocument } from './MendeleyBibtexSerializer.mjs'
