import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { fetchString } from '@overleaf/fetch-utils'
import OAuth from 'oauth-1.0a'
import crypto from 'crypto'

const ZOTERO_OAUTH_URL = 'https://www.zotero.org/oauth'

function hashFunctionSha1(baseString, key) {
  return crypto.createHmac('sha1', key)
    .update(baseString)
    .digest('base64')
}

/**
 * Resolve the Zotero app credentials. This base has no site_settings admin
 * section, so the env seeds (Settings.zotero, seeded at module boot in
 * modules/bib-editor/index.mjs from ZOTERO_CLIENT_KEY/SECRET) are the
 * single source of truth.
 */
async function getCredentials() {
  const clientKey = String(Settings.zotero?.clientKey || process.env.ZOTERO_CLIENT_KEY || '').trim()
  const clientSecret = String(
    Settings.zotero?.clientSecret || process.env.ZOTERO_CLIENT_SECRET || ''
  ).trim()
  if (!clientKey || !clientSecret) {
    throw new OError(
      'Zotero is enabled but its app credentials are not configured — set ZOTERO_CLIENT_KEY / ZOTERO_CLIENT_SECRET',
      { status: 500 }
    )
  }
  return { clientKey, clientSecret }
}

function createOAuthClient(credentials) {
  return OAuth({
    consumer: {
      key: credentials.clientKey,
      secret: credentials.clientSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function: hashFunctionSha1,
  })
}

function buildAuthorizationHeader(requestData, tokenData, credentials) {
  const oauth = createOAuthClient(credentials)
  const authData = oauth.authorize(requestData, tokenData)

  return oauth.toHeader(authData).Authorization
}

function parseOAuthResponse(body) {
  return Object.fromEntries(new URLSearchParams(body).entries())
}

function getAuthorizationUrl(oauthToken) {
  const params = new URLSearchParams({
    oauth_token: oauthToken,
    library_access: '1',
    all_groups: 'read',
  })

  return `${ZOTERO_OAUTH_URL}/authorize?${params}`
}
/*
function getAuthorizationUrl(oauthToken) {
  return `${ZOTERO_OAUTH_URL}/authorize?oauth_token=${oauthToken}`
}
*/

async function getRequestToken({ credentials, callbackURL }) {
  const url = `${ZOTERO_OAUTH_URL}/request`

  try {
    const body = await fetchString(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthorizationHeader(
          {
            url,
            method: 'POST',
            data: {
              oauth_callback: callbackURL,
            },
          },
          undefined,
          credentials
        ),
      },
    })

    return parseOAuthResponse(body)
  } catch (err) {
    throw OError.tag(err, 'error obtaining Zotero request token')
  }
}

async function exchangeRequestTokenForAccessToken(
  oauthToken,
  oauthTokenSecret,
  oauthVerifier,
  credentials,
) {
  const url = `${ZOTERO_OAUTH_URL}/access`

  try {
    const body = await fetchString(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthorizationHeader(
          {
            url,
            method: 'POST',
            data: {
              oauth_verifier: oauthVerifier,
            },
          },
          {
            key: oauthToken,
            secret: oauthTokenSecret,
          },
          credentials
        ),
      },
    })

    const data = parseOAuthResponse(body)

    return {
      accessToken: data.oauth_token,
      apiKeySecret: data.oauth_token_secret,
      zoteroUserId: data.userID,
      username: data.username,
    }
  } catch (err) {
    logger.err(
      { err, oauthToken },
      'error obtaining Zotero access token'
    )

    throw OError.tag(err, 'error obtaining Zotero access token')
  }
}

export default {
  getCredentials,
  getAuthorizationUrl,
  getRequestToken,
  exchangeRequestTokenForAccessToken,
}
