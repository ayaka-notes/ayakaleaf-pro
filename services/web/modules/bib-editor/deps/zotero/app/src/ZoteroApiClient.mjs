import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import {
  fetchNothing,
  fetchJson,
  fetchJsonWithResponse,
  fetchStringWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import { User } from '../../../../../../app/src/models/User.mjs'
import {
   NotFoundError,
   TooManyRequestsError,
   ServiceNotConfiguredError,
   ForbiddenError,
} from '../../../../../../app/src/Features/Errors/Errors.js'
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
  try {
    const groups = await fetchJson(`${ZOTERO_API_URL}/users/${zoteroUserId}/groups`, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return groups.map(g => ({
      id: String(g.id),
      name: g.data?.name || `Group ${g.id}`,
    }))
  } catch (err) {
    normalizeApiError(err, 'getGroupsForUser')
  }
}

/**
 * Export a library as BibTeX / BibLaTeX.
 */
async function getLibraryBibtex(userId, groupId, format) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    throw new ServiceNotConfiguredError({
      message: 'RefProvider credentials missed',
      info: { userId, status: 400 }
    })
  }

  // Main library or group?
  let basePath
  if (groupId) basePath = `/groups/${groupId}/items`
  else basePath = `/users/${credentials.zoteroUserId}/items`

  return _fetchBibtex(credentials.apiKey, basePath, format)
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
      const url = `${ZOTERO_API_URL}${basePath}?format=${format}&limit=${limit}&start=${start}`
      const { body: bibtexFetched, response } = await fetchStringWithResponse(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      const bibtex = bibtexFetched.replace(/^@misc\{noauthor_notitle_nodate(?:-\d+)?,\r?\n\}\r?\n*/gm, '')

      if (bibtex.trim()) allBibtex += bibtex

      const totalResults = parseInt(response.headers.get('Total-Results') || '0', 10)
      start += limit
      if (start >= totalResults) {
        break
      }
    }
  } catch (err) {
    normalizeApiError(err, '_fetchBibtex', url)
  }
  return allBibtex
}

/**
 * P4 (2026-08-28): picker helpers — libraries, collections, items and
 * combined BibTeX export for a selection of item keys. `scope` =
 * { kind: 'user' (main library) | 'group', id } (id ignored for 'user').
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
  const url = `${ZOTERO_API_URL}${itemUrlPath}?format=${format}`
  const NOISE_RE = /^@misc\{noauthor_notitle_nodate(?:-\d+)?,\r?\n\}\r?\n*/gm
  const req = (u) =>
    fetchStringWithResponse(u, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).then(({ body }) => body.replace(NOISE_RE, ''))
  try {
    return await req(url)
  } catch (err) {
    // Multi-key requests (…/items/KEY1,KEY2) are the failing shape in the
    // field: fetch the keys one by one and concatenate whatever resolves.
    const last = itemUrlPath.split('/').pop() || ''
    const keys = last.split(',').filter(Boolean)
    const authErr =
      err?.response?.status === 401 || err?.response?.status === 403
    if (keys.length > 1 && !authErr) {
      const base = itemUrlPath.slice(0, -last.length).replace(/\/$/, '')
      let out = ''
      for (const k of keys) {
        try {
          out += await req(`${ZOTERO_API_URL}/${base}/${k}?format=${format}`)
        } catch (perErr) {
          // Log and CONTINUE — normalizeApiError rethrows, which would
          // abort the remaining keys.
          logger.error(
            {
              operation: '_fetchBibtexKeys(perKey)',
              url: `${base}/${k}?format=${format}`,
              status: perErr?.response?.status,
              message: perErr?.message,
            },
            'Zotero API request failed',
          )
        }
      }
      if (out.trim()) return out
    }
    normalizeApiError(err, '_fetchBibtexKeys', url)
  }
  return ''
}

/**
 * Unlink a Zotero account.
 */
async function unlinkAccount(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return

  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.zotero': 1 } }
  ).exec()

  try {
    const { apiKey } = credentials
    await fetchNothing(`${ZOTERO_API_URL}/keys/${apiKey}`, {
      method: 'DELETE',
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
     logger.error({ err }, 'failed to detete key from Zotero account')
  }

}

function normalizeApiError(err, operation, url) {
  logger.error(
    { operation, url: url || undefined, status: err?.response?.status, message: err?.message },
    'Zotero API request failed',
  )

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
      message: 'Rate limit exeeded',
      info: { operation, status }
    }).withCause(err)
  }

  throw new OError('RefProvider request error', { operation, status }).withCause(err)
}

export {
  getLibrariesForPicker,
  getCollectionsForPicker,
  getItemsForPicker,
  getItemsBibtexForPicker,
}

export default {
  getConnectionStatus,
  getGroupsForUser,
  getLibraryBibtex,
  unlinkAccount,
  getLibrariesForPicker,
  getCollectionsForPicker,
  getItemsForPicker,
  getItemsBibtexForPicker,
}
