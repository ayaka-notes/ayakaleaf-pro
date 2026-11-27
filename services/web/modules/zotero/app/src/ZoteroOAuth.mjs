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

function createOAuthClient() {
  return OAuth({
    consumer: {
      key: Settings.zotero.clientKey,
      secret: Settings.zotero.clientSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function: hashFunctionSha1,
  })
}

function buildAuthorizationHeader(requestData, tokenData) {
  const oauth = createOAuthClient()
  const authData = oauth.authorize(requestData, tokenData)

  return oauth.toHeader(authData).Authorization
}

function parseOAuthResponse(body, requiredFields) {
  const data = Object.fromEntries(new URLSearchParams(body).entries())
  if (requiredFields.some(field => !data[field]?.trim())) {
    throw new OError('Invalid Zotero OAuth response')
  }
  return data
}

function getAuthorizationUrl(oauthToken) {
  const params = new URLSearchParams({
    oauth_token: oauthToken,
    library_access: '1',
    all_groups: 'read',
  })

  return `${ZOTERO_OAUTH_URL}/authorize?${params}`
}

async function getRequestToken() {
  const url = `${ZOTERO_OAUTH_URL}/request`

  try {
    const body = await fetchString(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthorizationHeader({
          url,
          method: 'POST',
          data: {
            oauth_callback: Settings.zotero.callbackURL,
          },
        }),
      },
    })

    return parseOAuthResponse(body, ['oauth_token', 'oauth_token_secret'])
  } catch (err) {
    throw OError.tag(err, 'error obtaining Zotero request token')
  }
}

async function exchangeRequestTokenForAccessToken(
  oauthToken,
  oauthTokenSecret,
  oauthVerifier,
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
          }
        ),
      },
    })

    const data = parseOAuthResponse(body, ['oauth_token', 'userID'])
    if (!/^\d+$/.test(data.userID)) {
      throw new OError('Invalid Zotero user ID in OAuth response')
    }

    return {
      accessToken: data.oauth_token,
      zoteroUserId: data.userID,
    }
  } catch (err) {
    logger.error(
      { err, oauthToken },
      'error obtaining Zotero access token'
    )

    throw OError.tag(err, 'error obtaining Zotero access token')
  }
}

export default {
  getAuthorizationUrl,
  getRequestToken,
  exchangeRequestTokenForAccessToken,
}
