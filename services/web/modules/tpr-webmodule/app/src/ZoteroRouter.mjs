import { expressify } from '@overleaf/promise-utils'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ZoteroController from './ZoteroController.mjs'

/**
 * Session-authenticated project permission check (the shared git-bridge helper
 * is OAuth-only, so it cannot be reused for browser routes).
 */
function requireProjectPermission(checkPermission) {
  return expressify(async (req, res, next) => {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const allowed = await checkPermission(userId, req.params.project_id)
    if (!allowed) {
      return res.status(403).json({ error: 'forbidden' })
    }
    next()
  })
}

const requireProjectRead = requireProjectPermission(
  AuthorizationManager.promises.canUserReadProject
)
const requireProjectWrite = requireProjectPermission(
  AuthorizationManager.promises.canUserWriteProjectContent
)

export default {
  apply(webRouter) {
    // Get Zotero groups (legacy create-file modal)
    webRouter.get(
      '/zotero/groups',
      AuthenticationController.requireLogin(),
      ZoteroController.getGroups
    )

    // Libraries and collections for the pickers
    webRouter.get(
      '/zotero/libraries',
      AuthenticationController.requireLogin(),
      ZoteroController.getLibraries
    )
    webRouter.get(
      '/zotero/collections',
      AuthenticationController.requireLogin(),
      ZoteroController.getCollections
    )
    webRouter.get(
      '/zotero/items',
      AuthenticationController.requireLogin(),
      ZoteroController.searchItems
    )

    // Project-scoped actions
    webRouter.get(
      '/project/:project_id/zotero/bib-files',
      AuthenticationController.requireLogin(),
      requireProjectRead,
      ZoteroController.listBibFiles
    )
    webRouter.post(
      '/project/:project_id/zotero/cite',
      AuthenticationController.requireLogin(),
      requireProjectWrite,
      ZoteroController.cite
    )
    webRouter.post(
      '/project/:project_id/zotero/import',
      AuthenticationController.requireLogin(),
      requireProjectWrite,
      ZoteroController.importItems
    )
    webRouter.post(
      '/project/:project_id/zotero/sync',
      AuthenticationController.requireLogin(),
      requireProjectWrite,
      ZoteroController.sync
    )

    // Start the Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth',
      AuthenticationController.requireLogin(),
      ZoteroController.oauth
    )

    // Callback for the Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth/callback',
      AuthenticationController.requireLogin(),
      ZoteroController.oauthCallback
    )

    // Unlink Zotero account
    webRouter.post(
      '/zotero/unlink',
      AuthenticationController.requireLogin(),
      ZoteroController.unlink
    )
  },
}
