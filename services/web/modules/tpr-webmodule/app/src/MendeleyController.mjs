import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import MendeleyApiClient from './MendeleyApiClient.mjs'
import {
  MendeleyAccountNotLinkedError,
  MendeleyExpiredError,
  MendeleyForbiddenError,
} from './MendeleyApiClient.mjs'

/**
 * GET /mendeley/groups
 * Returns the user's Mendeley groups (for the create-file modal).
 */
async function getGroups(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const groups = await MendeleyApiClient.getGroupsForUser(userId)
    res.json({ groups })
  } catch (err) {
    // _authHeaders refreshes the token before the request, so an expired or
    // unlinked account surfaces here rather than as an API 401/403.
    if (
      err instanceof MendeleyForbiddenError ||
      err instanceof MendeleyExpiredError ||
      err instanceof MendeleyAccountNotLinkedError
    ) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'mendeley_groups_relink',
      })
    }
    logger.err({ err, userId }, 'error fetching Mendeley groups')
    res.status(500).json({
      error: 'internal',
      message: 'mendeley_groups_loading_error',
    })
  }
}

/**
 * GET /user/mendeley/oauth
 * Start the Mendeley OAuth 2.0 flow: generate a CSRF `state`, remember it in
 * the session and redirect the user to Mendeley's authorization page.
 */
async function oauth(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const state = crypto.randomBytes(16).toString('hex')
    req.session.mendeleyOAuthState = state
    res.redirect(MendeleyApiClient.getOAuthAuthorizeUrl(state).toString())
  } catch (err) {
    logger.err({ err, userId }, 'error starting Mendeley OAuth flow')
    res.redirect('/user/settings?oauth-error=mendeley#references')
  }
}

/**
 * GET /user/mendeley/oauth/callback
 * Complete the Mendeley OAuth flow: verify `state`, exchange the authorization
 * code for access + refresh tokens and store them encrypted.
 */
async function oauthCallback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { code, state } = req.query
  const expectedState = req.session.mendeleyOAuthState
  delete req.session.mendeleyOAuthState

  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect('/user/settings?oauth-error=mendeley#references')
  }

  try {
    const tokens = await MendeleyApiClient.exchangeCodeForToken(code)
    await MendeleyApiClient.storeCredentials(userId, tokens)
    res.redirect('/user/settings?oauth-complete=mendeley#references')
  } catch (err) {
    logger.err({ err, userId }, 'error completing Mendeley OAuth flow')
    res.redirect('/user/settings?oauth-error=mendeley#references')
  }
}

/**
 * POST /mendeley/unlink
 * Unlinks the user's Mendeley account.
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await MendeleyApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    logger.err({ err, userId }, 'error unlinking Mendeley')
    res.sendStatus(500)
  }
}

export default {
  getGroups,
  oauth,
  oauthCallback,
  unlink,
}
