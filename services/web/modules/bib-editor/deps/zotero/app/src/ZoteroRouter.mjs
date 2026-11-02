import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ZoteroController from './ZoteroController.mjs'

// Vendored into the bib-editor module. This base has no site-settings
// admin section, so enablement is the env-secrets gate: without
// ZOTERO_CLIENT_KEY/SECRET the connector is off — same 403 semantics as
// the upstream ensureZoteroEnabled (Settings.zotero is seeded at module
// boot in modules/bib-editor/index.mjs).
function ensureZoteroEnabled(req, res, next) {
  if (Settings.zotero && (Settings.zotero.clientKey || Settings.zotero.clientID)) {
    return next()
  }
  logger.info({}, 'zotero: rejected — connector not configured')
  return res.status(403).send('Zotero is disabled on this site')
}

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/user/zotero/groups',
      AuthenticationController.requireLogin(),
      ensureZoteroEnabled,
      ZoteroController.getGroups
    )

    // Unlink Zotero account
    webRouter.delete(
      '/user/zotero',
      AuthenticationController.requireLogin(),
      ZoteroController.unlink
   )
    webRouter.get(
      '/user/zotero/status',
      AuthenticationController.requireLogin(),
      ZoteroController.getConnectionStatus
    )

    webRouter.get(
      '/user/zotero/oauth',
      AuthenticationController.requireLogin(),
      ensureZoteroEnabled,
      ZoteroController.oauth
    )
    // callback for Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth/callback',
      AuthenticationController.requireLogin(),
      ZoteroController.oauthCallback
    )

    // P4 (2026-08-28): "Import from Zotero" picker — the user's linked
    // libraries/collections/items + combined BibTeX for a selection.
    webRouter.get(
      '/user/zotero/picker/libraries',
      AuthenticationController.requireLogin(),
      ensureZoteroEnabled,
      ZoteroController.getPickerLibraries
    )
    webRouter.get(
      '/user/zotero/picker/collections',
      AuthenticationController.requireLogin(),
      ensureZoteroEnabled,
      ZoteroController.getPickerCollections
    )
    webRouter.get(
      '/user/zotero/picker/items',
      AuthenticationController.requireLogin(),
      ensureZoteroEnabled,
      ZoteroController.getPickerItems
    )
    webRouter.get(
      '/user/zotero/picker/bibtex',
      AuthenticationController.requireLogin(),
      ensureZoteroEnabled,
      ZoteroController.getPickerBibtex
    )



  },
}
