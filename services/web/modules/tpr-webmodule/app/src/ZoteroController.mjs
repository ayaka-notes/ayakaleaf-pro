import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import {
  ZoteroAccountNotLinkedError,
  ZoteroForbiddenError,
} from './ZoteroApiClient.mjs'

/**
 * GET /zotero/groups
 * Returns the user's Zotero groups (for the create-file modal).
 */
async function getGroups(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const groups = await ZoteroApiClient.getGroupsForUser(userId)
    res.json({ groups })
  } catch (err) {
    if (
      err instanceof ZoteroForbiddenError ||
      err instanceof ZoteroAccountNotLinkedError
    ) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'zotero_groups_relink',
      })
    }
    logger.err({ err, userId }, 'error fetching Zotero groups')
    res.status(500).json({
      error: 'internal',
      message: 'zotero_groups_loading_error',
    })
  }
}

/**
 * GET /user/zotero/oauth
 * Start the Zotero OAuth 1.0a flow: obtain a temporary request token and
 * redirect the user to Zotero's authorization page.
 */
async function oauth(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const { token, secret } = await ZoteroApiClient.getOAuthRequestToken()
    req.session.zoteroOAuth = { token, secret }
    res.redirect(ZoteroApiClient.getOAuthAuthorizeUrl(token).toString())
  } catch (err) {
    logger.err({ err, userId }, 'error starting Zotero OAuth flow')
    res.redirect('/user/settings?oauth-error=zotero#references')
  }
}

/**
 * GET /user/zotero/oauth/callback
 * Complete the Zotero OAuth flow: exchange the authorized request token for the
 * access token (the Zotero API key) and store the encrypted credentials.
 */
async function oauthCallback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { oauth_token: oauthToken, oauth_verifier: verifier } = req.query
  const stored = req.session.zoteroOAuth
  delete req.session.zoteroOAuth

  if (!stored || !oauthToken || !verifier || stored.token !== oauthToken) {
    return res.redirect('/user/settings?oauth-error=zotero#references')
  }

  try {
    const { apiKey, zoteroUserId } =
      await ZoteroApiClient.exchangeOAuthAccessToken(
        oauthToken,
        stored.secret,
        verifier
      )
    await ZoteroApiClient.storeCredentials(userId, apiKey, zoteroUserId)
    res.redirect('/user/settings?oauth-complete=zotero#references')
  } catch (err) {
    logger.err({ err, userId }, 'error completing Zotero OAuth flow')
    res.redirect('/user/settings?oauth-error=zotero#references')
  }
}

/**
 * POST /zotero/unlink
 * Unlinks the user's Zotero account.
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await ZoteroApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    logger.err({ err, userId }, 'error unlinking Zotero')
    res.sendStatus(500)
  }
}

export default {
  getGroups,
  oauth,
  oauthCallback,
  unlink,
}
