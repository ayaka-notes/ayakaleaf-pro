import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import {
  fetchNothing,
  fetchJson,
  fetchJsonWithResponse,
  fetchStringWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import { User } from '../../../../app/src/models/User.mjs'
import {
   NotFoundError,
   TooManyRequestsError,
   ServiceNotConfiguredError,
   ForbiddenError,
} from '../../../../app/src/Features/Errors/Errors.js'
import TokenManager from './TokenManager.mjs'

const ZOTERO_API_URL = 'https://api.zotero.org'
const REQUEST_TIMEOUT_MS = 60 * 1000
// TODO: implement conditional requests 

/**
 * Build a header for Zotero API request.
 */
function buildHeaders(apiKey, opts = {}) {
  const headers = {
    'Zotero-API-Version': '3',
    'Zotero-API-Key': apiKey,
    'User-Agent': 'Overleaf-CEP-Zotero',
    ...opts,
  }
  return headers
}

/**
 * Checks connection to Zotero by calling /keys/{key}.
 */
async function getConnectionStatus(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return false

  const { apiKey } = credentials
  try {
    await fetchJson(`${ZOTERO_API_URL}/keys/${apiKey}`, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return true
  } catch (err) {
    normalizeApiError(err, 'getConnectionStatus')
  }
}

/**
 * Get the list of groups for a user.
 */
async function getGroupsForUser(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null

  const { apiKey, zoteroUserId } = credentials
  const groups = []
  const limit = 100

  try {
    for (let start = 0; ; start += limit) {
      const page = await fetchJson(`${ZOTERO_API_URL}/users/${zoteroUserId}/groups?limit=${limit}&start=${start}`, {
        headers: buildHeaders(apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      groups.push(...page.map(g => ({
        id: String(g.id),
        name: g.data?.name || `Group ${g.id}`,
      })))
      if (page.length < limit) break
    }
    return groups

  } catch (err) {
    normalizeApiError(err, 'getGroupsForUser')
  }
}

/**
 * Return the Zotero path for a personal or group library.
 * Identifiers are validated before they become URL path components.
 */
function getLibraryPath(zoteroUserId, groupId) {
  const id = groupId || zoteroUserId
  if (!/^\d+$/.test(String(id))) {
    throw new OError('Invalid Zotero library ID', { status: 400 })
  }
  return groupId ? `/groups/${id}` : `/users/${id}`
}

/**
 * List all collections, including nested collections, in a library.
 */
async function getCollectionsForLibrary(userId, groupId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null

  const libraryPath = getLibraryPath(credentials.zoteroUserId, groupId)
  const collections = []
  const limit = 100

  try {
    for (let start = 0; ; start += limit) {
      const page = await fetchJson(
        `${ZOTERO_API_URL}${libraryPath}/collections?limit=${limit}&start=${start}`,
        {
          headers: buildHeaders(credentials.apiKey),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      )
      if (!Array.isArray(page)) throw new OError('Invalid Zotero collections response', { status: 500 })

      collections.push(...page.map(collection => ({
        key: collection.key,
        name: collection.data.name,
        parentCollection: collection.data.parentCollection || null,
      })))
      if (page.length < limit) break
    }
  } catch (err) {
    normalizeApiError(err, 'getCollectionsForLibrary')
  }

  return collections
}

/**
 * Export a library, collection, or personal My Publications view as BibTeX / BibLaTeX.
 */
async function getLibraryBibtex(userId, groupId, format, collectionKey) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    throw new ServiceNotConfiguredError({
      message: 'RefProvider credentials missing',
      info: { userId, status: 400 }
    })
  }

  const libraryPath = getLibraryPath(credentials.zoteroUserId, groupId)
  // "publications" is a local selector value, not a Zotero collection key.
  const isPublications = collectionKey === 'publications'
  if (isPublications && groupId) {
    throw new OError('My Publications is only available in personal libraries', { status: 400 })
  }
  if (collectionKey != null && !isPublications &&
      (typeof collectionKey !== 'string' || !/^[A-Za-z0-9]{8}$/.test(collectionKey))) {
    throw new OError('Invalid Zotero collection key', { status: 400 })
  }

  let basePath = `${libraryPath}/items`
  if (isPublications) {
    basePath = `${libraryPath}/publications/items`
  } else if (collectionKey) {
    basePath = `${libraryPath}/collections/${collectionKey}/items`
  }

  return _fetchBibtex(credentials.apiKey, basePath, format === 'biblatex' ? 'biblatex' : 'bibtex')
}

/**
 * Fetch all items from a Zotero library endpoint as BibTeX.
 * Handles pagination (Zotero API limits to 100 items per request).
 */
async function _fetchBibtex(apiKey, basePath, format) {
  const limit = 100
  let allBibtex = ''

  try {
    let start = 0
    const headers = buildHeaders(apiKey)
    while (true) {
      const url = `${ZOTERO_API_URL}${basePath}?format=${format}&limit=${limit}&start=${start}&includeTrashed=0`
      const { body: bibtexFetched, response } = await fetchStringWithResponse(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      const bibtex = bibtexFetched.replace(/^@misc\{noauthor_notitle_nodate(?:-\d+)?,\r?\n\}\r?\n*/gm, '')

      if (bibtex.trim()) allBibtex += bibtex

      const totalResultsHeader = response.headers.get('Total-Results')
      const totalResults = Number(totalResultsHeader)
      if (totalResultsHeader === null || !/^\d+$/.test(totalResultsHeader) ||
          !Number.isSafeInteger(totalResults)) {
        throw new OError('Missing or invalid Zotero Total-Results header', { status: 500 })
      }
      start += limit
      if (start >= totalResults) {
        break
      }
    }
  } catch (err) {
    normalizeApiError(err, '_fetchBibtex')
  }
  return allBibtex
}

/**
 * Unlink a Zotero account.
 */
async function unlinkAccount(userId) {
  const credentials = await TokenManager.getCredentials(userId)

  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.zotero': 1 } }
  ).exec()

  if (!credentials) return

  try {
    const { apiKey } = credentials
    await fetchNothing(`${ZOTERO_API_URL}/keys/${apiKey}`, {
      method: 'DELETE',
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
     logger.error({ err }, 'failed to delete key from Zotero account')
  }
}

function normalizeApiError(err, operation) {
  logger.error({ operation }, 'Zotero API request failed')

  if (err.name === 'AbortError') {
    throw new OError('RefProvider request timed out', { operation, status: 504 }).withCause(err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new OError('Something wrong with RefProvider request', { operation, status: 500 }).withCause(err)
  }

  const status = err.response?.status || 500

  if (status === 403) {
    throw new ForbiddenError({
       message: 'Access denied',
       info: { operation, status }
    }).withCause(err)
  }

  if (status === 404) {
    throw new NotFoundError({
       message: 'Not found',
       info: { operation, status }
    }).withCause(err)
  }

  if (status === 429) {
    throw new TooManyRequestsError({
      message: 'Rate limit exceeded',
      info: { operation, status }
    }).withCause(err)
  }

  throw new OError('RefProvider request error', { operation, status }).withCause(err)
}

/**
 * Picker helpers (library-page surface, ported 2026-11-05):
 * libraries, collections, items and combined BibTeX export for a selection
 * of item keys. `scope` = { kind: 'user' (main library) | 'group', id }
 * (id ignored for 'user'). Live-tuned: per-key bibtex fetch with retry
 * (Zotero answers multi-key item fetches with 404; verified on a live
 * account), placeholder-entry noise filtered, 409 semantics for unlinked.
 */
/** The user's libraries: main library first, then groups. */
async function getLibrariesForPicker(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null
  const libraries = [{ id: '', kind: 'user', name: 'My Library' }]
  try {
    const groups = (await getGroupsForUser(userId)) || []
    libraries.push(...groups.map(g => ({ id: g.id, kind: 'group', name: g.name })))
  } catch (err) {
    // groups are optional; keep main library
  }
  return libraries
}

/** Top-level collections of one library. */
async function getCollectionsForPicker(userId, scope) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null
  const base =
    scope.kind === 'group'
      ? `/groups/${scope.id}/collections`
      : `/users/${credentials.zoteroUserId}/collections`
  try {
    const cols = await fetchJson(`${ZOTERO_API_URL}${base}?limit=200`, {
      headers: buildHeaders(credentials.apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return cols.map(c => ({ key: c.key, name: c.data?.name || c.key }))
  } catch (err) {
    normalizeApiError(err, 'getCollectionsForPicker')
  }
  return []
}

/** Items of a library (or one of its collections), newest first. */
async function getItemsForPicker(userId, scope, collectionKey, limit, start) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null
  const basePath =
    scope.kind === 'group'
      ? `/groups/${scope.id}`
      : `/users/${credentials.zoteroUserId}`
  const itemsPath = collectionKey
    ? `${basePath}/_collections/${collectionKey}/items`
    : `${basePath}/items`
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500)
  const safeStart = Math.max(parseInt(start, 10) || 0, 0)
  try {
    const { json: items, response } = await fetchJsonWithResponse(
      `${ZOTERO_API_URL}${itemsPath}?limit=${safeLimit}&start=${safeStart}&sort=dateAdded&direction=desc`,
      {
        headers: buildHeaders(credentials.apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
    const total = parseInt(response.headers.get('Total-Results') || String(Array.isArray(items) ? items.length : 0), 10)
    const list = Array.isArray(items) ? items : []
    return {
      items: list.map(item => {
        const creators = (item.data?.creators || [])
          .map(c => {
            if (item.data?.itemType === 'book' || item.data?.itemType === 'bookSection') {
              const editor = item.data?.creators?.find(x => x.creatorType === 'editor')
              return editor ? editor.name : (c.firstName || c.name || '')
            }
            return c.firstName || c.name || ''
          })
        return {
          key: item.key,
          title: item.data?.title || '',
          itemType: item.data?.itemType || '',
          date: item.data?.date || '',
          firstCreator: creators[0] || '',
        }
      }),
      total,
    }
  } catch (err) {
    normalizeApiError(err, 'getItemsForPicker')
  }
  return { items: [], total: 0 }
}

/** Combined BibTeX for a list of item keys (one Zotero request). */
async function getItemsBibtexForPicker(userId, scope, itemKeys) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    // Distinct from a Zotero-side 404 (items not found): 409 = credentials
    // missing/undecryptable, 404 = the item keys are not in that library.
    throw new ServiceNotConfiguredError({
      message: 'Zotero account is not linked',
      info: { userId, status: 409 },
    })
  }
  const keys = (itemKeys || []).slice(0, 200)
  if (!keys.length) {
    throw new OError('no items selected', { status: 400 })
  }
  const basePath =
    scope.kind === 'group'
      ? `/groups/${scope.id}/items`
      : `/users/${credentials.zoteroUserId}/items`
  return _fetchBibtexKeys(
    credentials.apiKey,
    `${basePath}/${keys.join(',')}`,
    'bibtex'
  )
}

async function _fetchBibtexKeys(apiKey, itemUrlPath, format) {
  const NOISE_RE = /^@misc\{noauthor_notitle_nodate(?:-\d+)?,\r?\n\}\r?\n*/gm
  const req = (u) =>
    fetchStringWithResponse(u, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).then(({ body }) => body.replace(NOISE_RE, ''))
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  const lastSeg = itemUrlPath.split('/').pop() || ''
  const keys = lastSeg.split(',').filter(Boolean)

  // Single key: one request, original error semantics
  if (keys.length === 1) {
    const url = `${ZOTERO_API_URL}${itemUrlPath}?format=${format}`
    try {
      return await req(url)
    } catch (err) {
      normalizeApiError(err, '_fetchBibtexKeys', url)
    }
    return ''
  }

  // Multiple keys: the current Zotero API answers multi-key item fetches
  // (…/items/KEY1,KEY2) with 404, so fetch each key individually. Short
  // spacing + one retry per key absorb the transient 404s Zotero returns
  // under burst traffic (verified on a live account: single-key 200,
  // multi-key 404, retry 200).
  const base = itemUrlPath.slice(0, -lastSeg.length).replace(/\/+$/, '')
  let out = ''
  let lastErr = null
  for (let i = 0; i < keys.length; i++) {
    if (i) await sleep(120)
    const u = `${ZOTERO_API_URL}${base}/${keys[i]}?format=${format}`
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await sleep(800)
      try {
        out += await req(u)
        break
      } catch (err) {
        lastErr = err
        const status = err?.response?.status
        if (status === 401 || status === 403) {
          // Credential problem — no point retrying
          normalizeApiError(err, '_fetchBibtexKeys', u)
        }
        logger.error(
          { operation: '_fetchBibtexKeys', url: u, attempt, status, message: err?.message },
          'Zotero item bibtex fetch failed (retrying/continuing)',
        )
      }
    }
  }
  if (out.trim()) return out

  logger.error(
    { operation: '_fetchBibtexKeys', url: itemUrlPath, status: lastErr?.response?.status },
    'Zotero item bibtex fetch failed for all selected keys',
  )
  throw new OError(
    'Selected Zotero items could not be fetched',
    { status: 404 },
  ).withCause(lastErr)
}

export default {
  getConnectionStatus,
  getGroupsForUser,
  getCollectionsForLibrary,
  getLibraryBibtex,
  unlinkAccount,
  getLibrariesForPicker,
  getCollectionsForPicker,
  getItemsForPicker,
  getItemsBibtexForPicker,
}
