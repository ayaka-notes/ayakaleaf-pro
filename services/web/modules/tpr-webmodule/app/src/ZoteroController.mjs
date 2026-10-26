import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import ZoteroProjectSync from './ZoteroProjectSync.mjs'
import {
  ZoteroAccountNotLinkedError,
  ZoteroForbiddenError,
} from './ZoteroApiClient.mjs'

function _sendProviderError(res, err, fallbackKey) {
  if (
    err instanceof ZoteroForbiddenError ||
    err instanceof ZoteroAccountNotLinkedError
  ) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'zotero_groups_relink',
    })
  }
  logger.err({ err }, 'unexpected Zotero error')
  res.status(500).json({ error: 'internal', message: fallbackKey })
}

/**
 * GET /zotero/groups
 * Returns the user's Zotero groups (kept for the legacy create-file modal).
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
 * GET /zotero/libraries
 * Personal library plus the readable groups, for the library selectors.
 */
async function getLibraries(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const libraries = await ZoteroApiClient.getLibraries(userId)
    res.json(libraries)
  } catch (err) {
    _sendProviderError(res, err, 'zotero_groups_loading_error')
  }
}

/**
 * GET /zotero/collections?library=user|<groupId>
 */
async function getCollections(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const collections = await ZoteroApiClient.getCollections(userId, {
      libraryId: req.query.library,
    })
    res.json({ collections })
  } catch (err) {
    _sendProviderError(res, err, 'zotero_groups_loading_error')
  }
}

/**
 * GET /zotero/items?library=&collection=&q=&limit=&start=
 * Item search used by the reference picker and the create-file modal.
 */
async function searchItems(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  const start = Math.max(Number(req.query.start) || 0, 0)
  try {
    const result = await ZoteroApiClient.listItems(userId, {
      libraryId: req.query.library,
      collectionKey: req.query.collection || null,
      q: req.query.q,
      limit,
      start,
      mode: req.query.mode || 'library',
    })
    res.json(result)
  } catch (err) {
    _sendProviderError(res, err, 'zotero_reference_loading_error')
  }
}

/**
 * GET /project/:project_id/zotero/bib-files
 * The .bib documents entries can be written to.
 */
async function listBibFiles(req, res) {
  const bibDocs = await ZoteroProjectSync.listBibDocs(req.params.project_id)
  res.json({ files: bibDocs.map(doc => doc.path) })
}

/**
 * POST /project/:project_id/zotero/cite
 * Adds the selected items to a .bib document and returns their citation keys.
 */
async function cite(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { libraryId, collectionKey, itemKeys, targetPath } = req.body || {}
  try {
    const result = await ZoteroProjectSync.citeItems(
      req.params.project_id,
      userId,
      { libraryId, collectionKey, itemKeys, targetPath }
    )
    res.json(result)
  } catch (err) {
    logger.err({ err }, 'error citing Zotero items')
    _sendProviderError(res, err, 'zotero_reference_loading_error')
  }
}

/**
 * POST /project/:project_id/zotero/import
 * Import only the selected items as a .bib document.
 */
async function importItems(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { libraryId, collectionKey, itemKeys, name, mirror } = req.body || {}
  try {
    const result = await ZoteroProjectSync.importSelected(
      req.params.project_id,
      userId,
      { libraryId, collectionKey, itemKeys, name, mirror: Boolean(mirror) }
    )
    res.json(result)
  } catch (err) {
    logger.err({ err }, 'error importing Zotero items')
    _sendProviderError(res, err, 'zotero_reference_loading_error')
  }
}

/**
 * POST /project/:project_id/zotero/sync
 * Incremental sync of every Zotero-managed entry in the project.
 */
async function sync(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { path } = req.body || {}
  try {
    const summary = await ZoteroProjectSync.syncProject(
      req.params.project_id,
      userId,
      { path }
    )
    res.json(summary)
  } catch (err) {
    logger.err({ err }, 'error syncing Zotero references')
    _sendProviderError(res, err, 'zotero_sync_changed')
  }
}

/**
 * GET /user/zotero/oauth - start the OAuth 1.0a flow.
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
 * GET /user/zotero/oauth/callback - exchange the request token for an API key.
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
  getLibraries,
  getCollections,
  searchItems,
  listBibFiles,
  cite,
  importItems,
  sync,
  oauth,
  oauthCallback,
  unlink,
}
