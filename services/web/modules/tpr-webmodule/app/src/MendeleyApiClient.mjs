import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { fetchJson, fetchStringWithResponse } from '@overleaf/fetch-utils'
import { User } from '../../../../app/src/models/User.mjs'
import { createAccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'

const AccessTokenEncryptor = createAccessTokenEncryptor('mendeley')

// Mendeley uses OAuth 2.0 (authorization-code flow with refresh tokens).
const MENDELEY_API_URL = 'https://api.mendeley.com'
const MENDELEY_OAUTH_AUTHORIZE_URL = 'https://api.mendeley.com/oauth/authorize'
const MENDELEY_OAUTH_TOKEN_URL = 'https://api.mendeley.com/oauth/token'
const MENDELEY_SCOPE = 'all'

// Route the module's server-side Mendeley requests through an HTTP proxy when
// MENDELEY_PROXY_URL is set (mirrors the github-sync / zotero modules).
const mendeleyProxyAgent = process.env.MENDELEY_PROXY_URL
  ? new HttpsProxyAgent(process.env.MENDELEY_PROXY_URL)
  : undefined

function withProxy(options) {
  return mendeleyProxyAgent
    ? { ...options, agent: mendeleyProxyAgent }
    : options
}

function _basicAuthHeader() {
  const creds = `${Settings.mendeley?.clientID}:${Settings.mendeley?.clientSecret}`
  return `Basic ${Buffer.from(creds).toString('base64')}`
}

// ---- OAuth 2.0 -----------------------------------------------------------

/** Step 1: the URL the user is redirected to in order to authorize access. */
function getOAuthAuthorizeUrl(state) {
  const url = new URL(MENDELEY_OAUTH_AUTHORIZE_URL)
  url.searchParams.set('client_id', Settings.mendeley?.clientID)
  url.searchParams.set('redirect_uri', Settings.mendeley?.callbackURL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', MENDELEY_SCOPE)
  url.searchParams.set('state', state)
  return url
}

/** Step 2: exchange the authorization code for access + refresh tokens. */
async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: Settings.mendeley?.callbackURL,
  })
  return _requestToken(body)
}

async function _refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    // Mendeley's docs show redirect_uri in the refresh example, even though
    // RFC 6749 §6 does not ask for it and the endpoint accepts the request
    // without it. Sent to match the documented form.
    redirect_uri: Settings.mendeley?.callbackURL,
  })
  return _requestToken(body)
}

async function _requestToken(body) {
  try {
    const data = await fetchJson(
      MENDELEY_OAUTH_TOKEN_URL,
      withProxy({
        method: 'POST',
        headers: {
          Authorization: _basicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
    )
    if (!data.access_token) {
      throw new OError('Mendeley token response missing access_token')
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    }
  } catch (err) {
    // 400 covers invalid_grant (expired/revoked token), per RFC 6749 §5.2.
    const status = err.response?.status
    if (status === 400 || status === 401) {
      throw new MendeleyForbiddenError('Mendeley token request unauthorized')
    }
    throw OError.tag(err, 'error requesting Mendeley token')
  }
}

// ---- credential storage --------------------------------------------------

async function _getStoredCredentials(userId) {
  const user = await User.findById(userId, 'refProviders.mendeley').exec()
  if (!user?.refProviders?.mendeley?.encrypted) {
    return null
  }
  try {
    return await AccessTokenEncryptor.promises.decryptToJson(
      user.refProviders.mendeley.encrypted
    )
  } catch (err) {
    throw OError.tag(err, 'failed to decrypt Mendeley credentials', { userId })
  }
}

async function _saveCredentials(userId, credentials) {
  const encrypted = await AccessTokenEncryptor.promises.encryptJson(credentials)
  await User.updateOne(
    { _id: userId },
    { $set: { 'refProviders.mendeley': { encrypted } } }
  ).exec()
}

/** Store credentials after the OAuth callback. */
async function storeCredentials(userId, tokens) {
  await _saveCredentials(userId, tokens)
}

/**
 * Return a valid access token for the user, transparently refreshing (and
 * re-storing) it when the current one has expired.
 */
async function _getAccessToken(userId) {
  const credentials = await _getStoredCredentials(userId)
  if (!credentials) {
    throw new MendeleyAccountNotLinkedError()
  }
  // refresh a bit early to avoid edge-of-expiry failures
  if (credentials.expiresAt && credentials.expiresAt - Date.now() > 60_000) {
    return credentials.accessToken
  }
  if (!credentials.refreshToken) {
    throw new MendeleyExpiredError('Mendeley token expired')
  }
  try {
    const refreshed = await _refreshAccessToken(credentials.refreshToken)
    // Mendeley may not return a new refresh token; keep the existing one.
    if (!refreshed.refreshToken) {
      refreshed.refreshToken = credentials.refreshToken
    }
    await _saveCredentials(userId, refreshed)
    return refreshed.accessToken
  } catch (err) {
    if (err instanceof MendeleyForbiddenError) {
      throw new MendeleyExpiredError('Mendeley token expired')
    }
    throw err
  }
}

// ---- API calls -----------------------------------------------------------

async function _authHeaders(userId, accept) {
  const accessToken = await _getAccessToken(userId)
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(accept ? { Accept: accept } : {}),
  }
}

/** Get the list of groups for a user (for the create-file modal). */
async function getGroupsForUser(userId) {
  const headers = await _authHeaders(userId, 'application/vnd.mendeley-group.1+json')
  try {
    const groups = await fetchJson(
      `${MENDELEY_API_URL}/groups?type=all`,
      withProxy({ headers })
    )
    return (groups || []).map(g => ({
      id: String(g.id),
      name: g.name || `Group ${g.id}`,
    }))
  } catch (err) {
    logger.err({ err, userId }, 'error fetching Mendeley groups')
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new MendeleyForbiddenError('forbidden')
    }
    throw OError.tag(err, 'error fetching Mendeley groups')
  }
}

/** Export the user's entire library as BibTeX. */
async function getUserLibraryBibtex(userId) {
  return _fetchBibtex(userId, `${MENDELEY_API_URL}/documents?view=bib&limit=100`)
}

/** Export a group library as BibTeX. */
async function getGroupLibraryBibtex(userId, groupId) {
  return _fetchBibtex(
    userId,
    `${MENDELEY_API_URL}/documents?view=bib&limit=100&group_id=${encodeURIComponent(groupId)}`
  )
}

/**
 * Fetch all documents from a Mendeley endpoint as BibTeX, following the
 * `Link: <…>; rel="next"` pagination headers Mendeley returns.
 */
async function _fetchBibtex(userId, firstUrl) {
  let allBibtex = ''
  let url = firstUrl

  while (url) {
    const headers = await _authHeaders(userId, 'application/x-bibtex')
    try {
      const { body: bibtex, response } = await fetchStringWithResponse(
        url,
        withProxy({ headers })
      )
      if (bibtex.trim()) {
        allBibtex += bibtex + '\n'
      }
      url = _parseNextLink(response.headers.get('Link'))
    } catch (err) {
      if (err instanceof MendeleyForbiddenError) {
        throw err
      }
      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new MendeleyForbiddenError('Mendeley API returned 401/403')
      }
      throw OError.tag(err, 'error fetching BibTeX from Mendeley')
    }
  }
  return allBibtex
}

function _parseNextLink(linkHeader) {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (match) return match[1]
  }
  return null
}

/** Unlink a Mendeley account (remove stored credentials). */
async function unlinkAccount(userId) {
  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.mendeley': 1 } }
  ).exec()
}

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

export default {
  getOAuthAuthorizeUrl,
  exchangeCodeForToken,
  storeCredentials,
  getGroupsForUser,
  getUserLibraryBibtex,
  getGroupLibraryBibtex,
  unlinkAccount,
  MendeleyForbiddenError,
  MendeleyExpiredError,
  MendeleyAccountNotLinkedError,
}
