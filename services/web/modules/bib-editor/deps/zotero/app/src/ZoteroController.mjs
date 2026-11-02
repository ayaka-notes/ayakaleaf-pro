import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import crypto from 'node:crypto'
import SessionManager from '../../../../../../app/src/Features/Authentication/SessionManager.mjs'
import HttpErrorHandler from '../../../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import ZoteroOAuth from './ZoteroOAuth.mjs'
import TokenManager from './TokenManager.mjs'

function _callbackUrlFrom(req) {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
  const host = req.get('host') || ''
  return `${proto}://${host}/user/zotero/oauth/callback`
}

async function oauth(req, res) {
  try {
    // R6 (2026-08-29): credentials come from site_settings (P3c) — the
    // old code read Settings.zotero, which is undefined in this deployment
    // (no ZOTERO_* env), so the OAuth start always 400'd.
    const credentials = await ZoteroOAuth.getCredentials()
    const requestToken = await ZoteroOAuth.getRequestToken({
      credentials,
      callbackURL: _callbackUrlFrom(req),
    })
    const isPopup = req.query.popup === '1'

    req.session.zoteroOAuth = {
      token: requestToken.oauth_token,
      tokenSecret: requestToken.oauth_token_secret,
      isPopup
    }

    const authUrl = ZoteroOAuth.getAuthorizationUrl(requestToken.oauth_token)
    res.redirect(authUrl)

  } catch (err) {
    logger.error(OError.getFullStack(err))
    const info = OError.getFullInfo(err)
    logger.error({ info }, "Failed to start Zotero authorization")

    if (err?.status === 500) {
      res.status(503).json({ message: 'Failed to start Zotero authorization (credentials not configured)' })
      return
    }
    HttpErrorHandler.badRequest(req, res, 'Failed to start Zotero authorization')
    return
  }
}

async function oauthCallback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  const {
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
  } = req.query

  const saved = req.session.zoteroOAuth
  delete req.session.zoteroOAuth

  if (!saved || saved.token !== oauthToken) {
    HttpErrorHandler.forbidden(req, res, 'Invalid OAuth token')
    return
  }

  try {
    const credentials = await ZoteroOAuth.getCredentials()
    const { accessToken, zoteroUserId } = await ZoteroOAuth.exchangeRequestTokenForAccessToken(
      oauthToken,
      saved.tokenSecret,
      oauthVerifier,
      credentials,
    )
    await TokenManager.storeCredentials(userId, accessToken, zoteroUserId)

  } catch (err) {
    logger.error(OError.getFullStack(err))
    const info = OError.getFullInfo(err)
    logger.error({ info }, "Failed to obtain Zotero access token'")

    HttpErrorHandler.badRequest(req, res, 'Failed to obtain Zotero access token')
    return
  }

  const nonce = crypto.randomBytes(16).toString('base64')
  const csp = res.getHeader('Content-Security-Policy')

  res.setHeader(
    'Content-Security-Policy',
    `${csp}; script-src 'nonce-${nonce}'`
  )

  res.send(`
    <!doctype html>
    <html>
      <body>
        <script nonce="${nonce}">
          const channel = new BroadcastChannel('zotero')
          channel.postMessage({ type: 'zotero-linked' })
          ${saved.isPopup
            ? 'window.close()'
            : "location.href = '/user/settings#references'"
          }
        </script>
      </body>
    </html>
  `)
}

/**
 * GET /user/zotero/status
 * Returns the user's Zotero connection status, true or false
 */
async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const isConnected = await ZoteroApiClient.getConnectionStatus(userId)
    res.json(isConnected)

  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed to check user connection")
    return res.status(errStatus).json({ message: err.message })
  }
}

/**
 * GET /user/zotero/groups
 * Returns the user's Zotero groups or null, if account is not linked
 */
async function getGroups(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const groups = await ZoteroApiClient.getGroupsForUser(userId)
    res.json(groups)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed to get user groups")
    return res.status(errStatus).json({ message: err.message })
  }
}

/**
 * DELETE /user/zotero/unlink
 * Unlinks the user's Zotero account.
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await ZoteroApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "error unlinking Zotero account")
    return res.status(errStatus).json({ message: err.message })
  }
}

/**
 * P4 (2026-08-28): "Import from Zotero" picker (same UX as the ORCID
 * picker) — the user's OWN linked Zotero:
 *   GET /user/zotero/picker/libraries
 *   GET /user/zotero/picker/collections?library=&libraryKind=
 *   GET /user/zotero/picker/items?library=&libraryKind=&collection=&limit=&start=
 *   GET /user/zotero/picker/bibtex?library=&libraryKind=&keys=k1,k2
 * All are login-required and gated by ensureZoteroEnabled.
 * "not linked" responses use status 409 (the modal shows a Link action).
 */
function _scopeFromQuery(query) {
  return {
    kind: query.libraryKind === 'group' ? 'group' : 'user',
    id: query.library || '',
  }
}

async function getPickerLibraries(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const libraries = await ZoteroApiClient.getLibrariesForPicker(userId)
    if (libraries === null) {
      return res.status(409).json({ message: 'zotero_not_linked' })
    }
    res.json(libraries)
  } catch (err) {
    _pickerError(req, res, err)
  }
}

async function getPickerCollections(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const scope = _scopeFromQuery(req.query)
  try {
    const collections = await ZoteroApiClient.getCollectionsForPicker(userId, scope)
    if (collections === null) {
      return res.status(409).json({ message: 'zotero_not_linked' })
    }
    res.json(collections)
  } catch (err) {
    _pickerError(req, res, err)
  }
}

async function getPickerItems(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const scope = _scopeFromQuery(req.query)
  try {
    const result = await ZoteroApiClient.getItemsForPicker(
      userId,
      scope,
      req.query.collection || '',
      req.query.limit,
      req.query.start
    )
    if (result === null) {
      return res.status(409).json({ message: 'zotero_not_linked' })
    }
    res.json(result)
  } catch (err) {
    _pickerError(req, res, err)
  }
}

async function getPickerBibtex(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const scope = _scopeFromQuery(req.query)
  let keys = []
  try {
    keys = String(req.query.keys || '')
      .split(',')
      .map(k => decodeURIComponent(k.trim()))
      .filter(Boolean)
  } catch (err) {
    keys = []
  }
  if (!keys.length) {
    return res.status(400).json({ message: 'no items selected' })
  }
  try {
    const bibtex = await ZoteroApiClient.getItemsBibtexForPicker(userId, scope, keys)
    res.json({ bibtex })
  } catch (err) {
    const info = OError.getFullInfo(err)
    if (info?.status === 404) {
      return res.status(409).json({ message: 'zotero_not_linked' })
    }
    _pickerError(req, res, err)
  }
}

function _pickerError(req, res, err) {
  const info = OError.getFullInfo(err)
  if (info?.status === 404) {
    return res.status(409).json({ message: 'zotero_not_linked' })
  }
  const status = info?.status || 500
  logger.error({ err }, 'zotero picker request failed')
  res.status(status).json({ message: err.message })
}

export default {
  oauth,
  oauthCallback,
  getConnectionStatus,
  getGroups,
  unlink,
  getPickerLibraries,
  getPickerCollections,
  getPickerItems,
  getPickerBibtex,
}
