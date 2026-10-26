import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  CustomHttpAgent,
  CustomHttpsAgent,
  fetchJson,
  fetchNothing,
  fetchString,
  fetchStringWithResponse,
} from '@overleaf/fetch-utils'
import { User } from '../../../../app/src/models/User.mjs'
import { createAccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'

const AccessTokenEncryptor = createAccessTokenEncryptor('zotero')

const ZOTERO_API_URL = 'https://api.zotero.org'
const ZOTERO_OAUTH_REQUEST_URL = 'https://www.zotero.org/oauth/request'
const ZOTERO_OAUTH_AUTHORIZE_URL = 'https://www.zotero.org/oauth/authorize'
const ZOTERO_OAUTH_ACCESS_URL = 'https://www.zotero.org/oauth/access'
const REQUEST_TIMEOUT_MS = 60 * 1000

// Route the module's server-side Zotero requests through an HTTP proxy when
// ZOTERO_PROXY_URL is set (mirrors the github-sync module's proxy support).
const zoteroProxyAgent = process.env.ZOTERO_PROXY_URL
  ? new HttpsProxyAgent(process.env.ZOTERO_PROXY_URL)
  : undefined

// fetch-utils' default agent gives up connecting after 1s, too short for
// external APIs, so direct requests get a 3s connect timeout instead
const MAX_CONNECT_TIME = 3000
const httpAgent = new CustomHttpAgent({ connectTimeout: MAX_CONNECT_TIME })
const httpsAgent = new CustomHttpsAgent({ connectTimeout: MAX_CONNECT_TIME })

function withProxy(options) {
  return {
    ...options,
    agent:
      zoteroProxyAgent ||
      (url => (url.protocol === 'https:' ? httpsAgent : httpAgent)),
  }
}

/**
 * Decrypt stored Zotero credentials from user record.
 * Returns { apiKey, zoteroUserId } or null if not linked.
 */
async function _getCredentials(userId) {
  const user = await User.findById(userId, 'refProviders.zotero').exec()
  if (!user?.refProviders?.zotero?.apiKeyEncrypted) {
    return null
  }
  try {
    const decrypted = await AccessTokenEncryptor.promises.decryptToJson(
      user.refProviders.zotero.apiKeyEncrypted
    )
    return decrypted
  } catch (err) {
    throw OError.tag(err, 'failed to decrypt Zotero credentials', { userId })
  }
}

/**
 * Make a request to the Zotero API with the user's API key.
 */
async function _zoteroApiRequest(apiKey, path, opts = {}) {
  const url = `${ZOTERO_API_URL}${path}`
  const headers = {
    'Zotero-API-Version': '3',
    'Zotero-API-Key': apiKey,
    ...(opts.headers || {}),
  }
  return { url, headers }
}

/**
 * Get the list of groups for a user.
 */
async function getGroupsForUser(userId) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  const { apiKey, zoteroUserId } = credentials
  const { url, headers } = await _zoteroApiRequest(
    apiKey,
    `/users/${zoteroUserId}/groups`
  )
  try {
    const groups = await fetchJson(
      url,
      withProxy({
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    )
    return groups.map(g => ({
      id: String(g.id),
      name: g.data?.name || `Group ${g.id}`,
    }))
  } catch (err) {
    logger.err({ err, userId }, 'error fetching Zotero groups')
    if (err.response?.status === 403) {
      throw new ZoteroForbiddenError('forbidden')
    }
    throw OError.tag(err, 'error fetching Zotero groups')
  }
}

/**
 * Export the user's entire library as BibTeX.
 */
async function getUserLibraryBibtex(userId) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  return _fetchBibtex(
    credentials.apiKey,
    `/users/${credentials.zoteroUserId}/items`
  )
}

/**
 * Export a group library as BibTeX.
 */
async function getGroupLibraryBibtex(userId, groupId) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  return _fetchBibtex(credentials.apiKey, `/groups/${groupId}/items`)
}

/**
 * Fetch all items from a Zotero library endpoint as BibTeX.
 * Handles pagination (Zotero API limits to 100 items per request).
 */
async function _fetchBibtex(apiKey, basePath) {
  let allBibtex = ''
  let start = 0
  const limit = 100

  while (true) {
    const { url, headers } = await _zoteroApiRequest(apiKey, basePath, {
      headers: {},
    })
    const fullUrl = `${url}?format=bibtex&limit=${limit}&start=${start}`
    try {
      const { body, response } = await fetchStringWithResponse(
        fullUrl,
        withProxy({
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      )
      // Zotero exports attachments and notes as empty @misc entries
      const bibtex = body.replace(
        /^@misc\{noauthor_notitle_nodate(?:-\d+)?,\r?\n\}\r?\n*/gm,
        ''
      )
      if (bibtex.trim()) {
        allBibtex += bibtex + '\n'
      }
      const totalResults = parseInt(
        response.headers.get('Total-Results') || '0',
        10
      )
      start += limit
      if (start >= totalResults) {
        break
      }
    } catch (err) {
      if (err instanceof ZoteroForbiddenError) {
        throw err
      }
      if (err.response?.status === 403) {
        throw new ZoteroForbiddenError('Zotero API returned 403')
      }
      throw OError.tag(err, 'error fetching BibTeX from Zotero', { basePath })
    }
  }
  return allBibtex
}

// ---- Zotero OAuth 1.0a ----------------------------------------------------
// Zotero authenticates third-party apps with OAuth 1.0a. The access token
// returned by the final step IS the user's Zotero API key, so it is stored the
// same way as a manually-created key.

function _rfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

function _signOAuth1(method, url, params, tokenSecret = '') {
  const paramString = Object.keys(params)
    .sort()
    .map(k => `${_rfc3986(k)}=${_rfc3986(params[k])}`)
    .join('&')
  const base = [
    method.toUpperCase(),
    _rfc3986(url),
    _rfc3986(paramString),
  ].join('&')
  const signingKey = `${_rfc3986(Settings.zotero?.clientSecret || '')}&${_rfc3986(
    tokenSecret
  )}`
  return crypto.createHmac('sha1', signingKey).update(base).digest('base64')
}

function _oauthAuthHeader(method, url, extraParams = {}, tokenSecret = '') {
  const params = {
    oauth_consumer_key: Settings.zotero?.clientID,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...extraParams,
  }
  params.oauth_signature = _signOAuth1(method, url, params, tokenSecret)
  return (
    'OAuth ' +
    Object.keys(params)
      .sort()
      .map(k => `${_rfc3986(k)}="${_rfc3986(params[k])}"`)
      .join(', ')
  )
}

/**
 * Step 1: obtain a temporary request token (+ secret) from Zotero.
 */
async function getOAuthRequestToken() {
  const authHeader = _oauthAuthHeader('POST', ZOTERO_OAUTH_REQUEST_URL, {
    oauth_callback: Settings.zotero?.callbackURL,
  })
  const body = await fetchString(
    ZOTERO_OAUTH_REQUEST_URL,
    withProxy({
      method: 'POST',
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  )
  const parsed = new URLSearchParams(body)
  const token = parsed.get('oauth_token')
  const secret = parsed.get('oauth_token_secret')
  if (!token || !secret) {
    throw new OError('invalid Zotero OAuth request token response')
  }
  return { token, secret }
}

/**
 * Step 2: URL the user is redirected to in order to authorize access.
 */
function getOAuthAuthorizeUrl(requestToken) {
  const url = new URL(ZOTERO_OAUTH_AUTHORIZE_URL)
  url.searchParams.set('oauth_token', requestToken)
  url.searchParams.set('library_access', '1')
  url.searchParams.set('all_groups', 'read')
  url.searchParams.set('write_access', '0')
  return url
}

/**
 * Step 3: exchange the authorized request token for the access token, which is
 * the user's Zotero API key. Returns { apiKey, zoteroUserId }.
 */
async function exchangeOAuthAccessToken(requestToken, requestTokenSecret, verifier) {
  const authHeader = _oauthAuthHeader(
    'POST',
    ZOTERO_OAUTH_ACCESS_URL,
    { oauth_token: requestToken, oauth_verifier: verifier },
    requestTokenSecret
  )
  const body = await fetchString(
    ZOTERO_OAUTH_ACCESS_URL,
    withProxy({
      method: 'POST',
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  )
  const parsed = new URLSearchParams(body)
  const apiKey = parsed.get('oauth_token')
  const zoteroUserId = parsed.get('userID')
  if (!apiKey || !zoteroUserId) {
    throw new OError('invalid Zotero OAuth access token response')
  }
  return { apiKey, zoteroUserId: String(zoteroUserId) }
}

/**
 * Link a Zotero account (store encrypted credentials).
 */
async function storeCredentials(userId, apiKey, zoteroUserId) {
  const apiKeyEncrypted = await AccessTokenEncryptor.promises.encryptJson({
    apiKey,
    zoteroUserId: String(zoteroUserId),
  })
  const previous = await User.findOneAndUpdate(
    { _id: userId },
    { $set: { 'refProviders.zotero': { apiKeyEncrypted } } },
    { projection: { 'refProviders.zotero': 1 } }
  ).exec()
  // linking again (e.g. another account) replaces the key: revoke the old
  // one, fire-and-forget
  const previousEncrypted = previous?.refProviders?.zotero?.apiKeyEncrypted
  if (previousEncrypted) {
    AccessTokenEncryptor.promises
      .decryptToJson(previousEncrypted)
      .then(old => revokeApiKey(old.apiKey))
      .catch(err => {
        logger.warn({ err, userId }, 'failed to revoke replaced Zotero API key')
      })
  }
}

/**
 * Unlink a Zotero account.
 */
/**
 * Revoke a Zotero API key on Zotero's side (best-effort).
 */
async function revokeApiKey(apiKey) {
  await fetchNothing(
    `${ZOTERO_API_URL}/keys/${encodeURIComponent(apiKey)}`,
    withProxy({
      method: 'DELETE',
      headers: { 'Zotero-API-Version': '3', 'Zotero-API-Key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  )
}

/**
 * Unlink a Zotero account: revoke the key on Zotero (best-effort), then remove
 * the stored credentials.
 */
async function unlinkAccount(userId) {
  try {
    const credentials = await _getCredentials(userId)
    if (credentials?.apiKey) {
      await revokeApiKey(credentials.apiKey)
    }
  } catch (err) {
    logger.warn({ err, userId }, 'failed to revoke Zotero API key')
  }
  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.zotero': 1 } }
  ).exec()
}


// ---- libraries, collections and items ------------------------------------
//
// Everything below backs the reference picker (search + cite) and collection
// sync. Items are addressed through a library: 'user' for the personal
// library, or the numeric id of a Zotero group.

function _libraryPath(libraryId, zoteroUserId) {
  return libraryId && libraryId !== 'user'
    ? `/groups/${encodeURIComponent(libraryId)}`
    : `/users/${encodeURIComponent(zoteroUserId)}`
}

/**
 * Authenticated GET against the Zotero API. `pathOrFn` may be a function of the
 * decrypted credentials when the path needs the Zotero user id.
 */
async function _request(userId, pathOrFn) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  const path =
    typeof pathOrFn === 'function' ? pathOrFn(credentials) : pathOrFn
  try {
    const { body, response } = await fetchStringWithResponse(
      `${ZOTERO_API_URL}${path}`,
      withProxy({
        headers: {
          'Zotero-API-Version': '3',
          'Zotero-API-Key': credentials.apiKey,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    )
    return { body, response, credentials }
  } catch (err) {
    if (err.response?.status === 403) {
      throw new ZoteroForbiddenError('Zotero API returned 403')
    }
    throw OError.tag(err, 'error requesting Zotero API', { path })
  }
}

/**
 * Personal library plus the groups the linked account can read.
 */
async function getLibraries(userId) {
  const me = JSON.parse((await _request(userId, '/keys/current')).body)
  const groups = JSON.parse(
    (
      await _request(
        userId,
        credentials => `/users/${credentials.zoteroUserId}/groups`
      )
    ).body
  )
  return {
    personal: { id: 'user', name: me.username || 'My Library' },
    groups: groups.map(group => ({
      id: String(group.id),
      name: group.data?.name || `Group ${group.id}`,
    })),
  }
}

/**
 * Collections of one library, flat, with their parent collection key.
 */
async function getCollections(userId, { libraryId }) {
  const body = (
    await _request(
      userId,
      credentials =>
        `${_libraryPath(libraryId, credentials.zoteroUserId)}/collections?limit=100`
    )
  ).body
  const collections = JSON.parse(body).map(collection => ({
    key: collection.key,
    name: collection.data?.name || collection.key,
    numItems: collection.meta?.numItems ?? null,
    parent: collection.data?.parentCollection || null,
    deleted: Boolean(collection.data?.deleted),
  }))

  // Zotero keeps deleted collections (and their children) in the trash; the
  // list endpoint still returns them. Hide the whole subtree.
  const byKey = new Map(collections.map(collection => [collection.key, collection]))
  const isTrashed = collection => {
    let current = collection
    const seen = new Set()
    while (current) {
      if (current.deleted) {
        return true
      }
      if (!current.parent || seen.has(current.parent)) {
        return false
      }
      seen.add(current.parent)
      current = byKey.get(current.parent)
    }
    return false
  }

  return collections
    .filter(collection => !isTrashed(collection))
    .map(({ deleted, ...collection }) => collection)
}

function _isReferenceItem(item) {
  const type = item?.data?.itemType
  return type !== 'attachment' && type !== 'note' && !item?.data?.deleted
}

function _mapItem(item) {
  const data = item.data || {}
  return {
    key: item.key,
    version: item.version,
    itemType: data.itemType,
    title: data.title || '',
    date: data.date || '',
    publication:
      data.publicationTitle || data.bookTitle || data.proceedingsTitle || '',
    creators: (data.creators || []).map(creator => ({
      firstName: creator.firstName || '',
      lastName: creator.lastName || '',
      name: creator.name || '',
    })),
    url: data.url || '',
    doi: data.DOI || '',
  }
}

/**
 * One page of references in a library or collection.
 */
async function listItems(
  userId,
  { libraryId, collectionKey = null, q, limit = 50, start = 0, mode = 'library' }
) {
  if (mode === 'trash') {
    return await listTrashedItems(userId, { libraryId, limit, start })
  }
  if (mode === 'unfiled') {
    return await listUnfiledItems(userId, { libraryId, q, limit, start })
  }

  const params = new URLSearchParams({
    limit: String(limit),
    start: String(start),
    itemType: '-attachment',
  })
  if (q) {
    params.set('q', q)
  }
  const { body, response } = await _request(userId, credentials => {
    const base = _libraryPath(libraryId, credentials.zoteroUserId)
    const collection = collectionKey
      ? `/collections/${encodeURIComponent(collectionKey)}`
      : ''
    return `${base}${collection}/items?${params.toString()}`
  })
  const parsed = JSON.parse(body)
  return {
    items: parsed.filter(_isReferenceItem).map(_mapItem),
    total: Number(response.headers.get('Total-Results') || 0),
    fetched: parsed.length,
    libraryVersion: Number(response.headers.get('Last-Modified-Version') || 0),
  }
}

/**
 * Page through a library/collection (Zotero caps a page at 100 items).
 */
async function listAllItems(
  userId,
  { libraryId, collectionKey = null, max = 2000 }
) {
  const items = []
  let start = 0
  while (items.length < max) {
    const page = await listItems(userId, {
      libraryId,
      collectionKey,
      limit: 100,
      start,
    })
    items.push(...page.items)
    if (page.fetched === 0 || start + page.fetched >= page.total) {
      break
    }
    start += page.fetched
  }
  return items
}

/**
 * Metadata (including the library version) for specific items.
 */

/**
 * Items in the Zotero trash. Read-only for our purposes.
 */
async function listTrashedItems(userId, { libraryId, limit = 50, start = 0 }) {
  const params = new URLSearchParams({
    limit: String(limit),
    start: String(start),
  })
  const { body, response } = await _request(
    userId,
    credentials =>
      `${_libraryPath(libraryId, credentials.zoteroUserId)}/items/trash?${params.toString()}`
  )
  const parsed = JSON.parse(body)
  return {
    items: parsed.filter(item => item.data?.itemType !== 'attachment').map(_mapItem),
    total: Number(response.headers.get('Total-Results') || 0),
    fetched: parsed.length,
    libraryVersion: Number(response.headers.get('Last-Modified-Version') || 0),
  }
}

/**
 * Top-level items that belong to no collection ("Unfiled Items" in Zotero).
 * The public API has no unfiled filter, so scan the top-level items once and
 * filter client-side. Capped to keep a single request bounded.
 */
async function listUnfiledItems(
  userId,
  { libraryId, q, limit = 50, start = 0, max = 1000 }
) {
  const unfiled = []
  let pageStart = 0
  let libraryVersion = 0

  while (pageStart < max) {
    const params = new URLSearchParams({
      limit: '100',
      start: String(pageStart),
      itemType: '-attachment',
    })
    if (q) {
      params.set('q', q)
    }
    const { body, response } = await _request(
      userId,
      credentials =>
        `${_libraryPath(libraryId, credentials.zoteroUserId)}/items/top?${params.toString()}`
    )
    libraryVersion = Number(
      response.headers.get('Last-Modified-Version') || libraryVersion
    )
    const page = JSON.parse(body)
    for (const item of page) {
      if (
        _isReferenceItem(item) &&
        (item.data?.collections || []).length === 0
      ) {
        unfiled.push(_mapItem(item))
      }
    }
    const total = Number(response.headers.get('Total-Results') || 0)
    if (page.length === 0 || pageStart + 100 >= total) {
      break
    }
    pageStart += 100
  }

  return {
    items: unfiled.slice(start, start + limit),
    total: unfiled.length,
    fetched: Math.min(unfiled.length, start + limit),
    libraryVersion,
  }
}

async function getItems(userId, { libraryId, itemKeys }) {
  if (!itemKeys?.length) {
    return []
  }
  const params = new URLSearchParams({
    itemKey: itemKeys.join(','),
    limit: String(itemKeys.length),
  })
  const { body } = await _request(
    userId,
    credentials =>
      `${_libraryPath(libraryId, credentials.zoteroUserId)}/items?${params.toString()}`
  )
  return JSON.parse(body).filter(_isReferenceItem).map(_mapItem)
}

/**
 * BibTeX for a single item, together with the citation key Zotero generates
 * for it (used directly inside \cite{...}).
 */
async function getItemBibtex(userId, { libraryId, itemKey }) {
  const { body } = await _request(
    userId,
    credentials =>
      `${_libraryPath(libraryId, credentials.zoteroUserId)}/items/${encodeURIComponent(
        itemKey
      )}?format=bibtex`
  )
  const match = body.match(/@\w+\s*\{\s*([^,\s]+)\s*,/)
  return {
    itemKey,
    bibtex: body.trim(),
    citationKey: match ? match[1] : null,
  }
}

/**
 * BibTeX for several items. Zotero has no batch "give me citation keys" API,
 * so items are fetched individually with a small concurrency limit.
 */
async function getItemsBibtex(userId, { libraryId, itemKeys }) {
  const results = []
  const queue = [...new Set(itemKeys || [])]
  const workers = Array.from(
    { length: Math.min(4, queue.length) },
    async () => {
      while (queue.length) {
        const itemKey = queue.shift()
        try {
          results.push(await getItemBibtex(userId, { libraryId, itemKey }))
        } catch (err) {
          logger.warn({ err, itemKey }, 'failed to fetch Zotero item bibtex')
        }
      }
    }
  )
  await Promise.all(workers)
  return results
}

export class ZoteroForbiddenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZoteroForbiddenError'
  }
}

export class ZoteroAccountNotLinkedError extends Error {
  constructor(message = 'Zotero account not linked') {
    super(message)
    this.name = 'ZoteroAccountNotLinkedError'
  }
}

export default {
  getGroupsForUser,
  getLibraries,
  getCollections,
  listItems,
  listAllItems,
  getItems,
  getItemBibtex,
  getItemsBibtex,
  getUserLibraryBibtex,
  getGroupLibraryBibtex,
  getOAuthRequestToken,
  getOAuthAuthorizeUrl,
  exchangeOAuthAccessToken,
  storeCredentials,
  unlinkAccount,
  ZoteroForbiddenError,
  ZoteroAccountNotLinkedError,
}
