import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
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

// Route the module's server-side Zotero requests through an HTTP proxy when
// ZOTERO_PROXY_URL is set (mirrors the github-sync module's proxy support).
const zoteroProxyAgent = process.env.ZOTERO_PROXY_URL
  ? new HttpsProxyAgent(process.env.ZOTERO_PROXY_URL)
  : undefined

function withProxy(options) {
  return zoteroProxyAgent ? { ...options, agent: zoteroProxyAgent } : options
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
    const groups = await fetchJson(url, withProxy({ headers }))
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
        withProxy({ headers })
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

/**
 * Validate a Zotero API key by calling /keys/{key}.
 * Returns { zoteroUserId } on success, throws on failure.
 */
async function validateApiKey(apiKey) {
  const url = `${ZOTERO_API_URL}/keys/${encodeURIComponent(apiKey)}`
  try {
    const data = await fetchJson(
      url,
      withProxy({ headers: { 'Zotero-API-Version': '3' } })
    )
    if (!data.userID) {
      throw new Error('Zotero API key response missing userID')
    }
    return { zoteroUserId: String(data.userID) }
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 403) {
      throw new ZoteroForbiddenError('Invalid Zotero API key')
    }
    throw OError.tag(err, 'error validating Zotero API key')
  }
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
  await User.updateOne(
    { _id: userId },
    { $set: { 'refProviders.zotero': { apiKeyEncrypted } } }
  ).exec()
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
  getUserLibraryBibtex,
  getGroupLibraryBibtex,
  validateApiKey,
  getOAuthRequestToken,
  getOAuthAuthorizeUrl,
  exchangeOAuthAccessToken,
  storeCredentials,
  unlinkAccount,
  ZoteroForbiddenError,
  ZoteroAccountNotLinkedError,
}
