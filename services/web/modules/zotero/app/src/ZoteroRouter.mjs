import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ZoteroController from './ZoteroController.mjs'

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/user/zotero/groups',
      AuthenticationController.requireLogin(),
      ZoteroController.getGroups
    )

    // legacy path (tpr-webmodule create-file mode + older host UIs) — same handler
    webRouter.get(
      '/zotero/groups',
      AuthenticationController.requireLogin(),
      ZoteroController.getGroups
    )

    webRouter.get(
      '/user/zotero/collections',
      AuthenticationController.requireLogin(),
      ZoteroController.getCollections
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
      ZoteroController.oauth
    )
    // callback for Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth/callback',
      AuthenticationController.requireLogin(),
      ZoteroController.oauthCallback
    )

    // Library-page picker surface (bib-editor module, ported 2026-11-05)
    webRouter.get(
      '/user/zotero/picker/libraries',
      AuthenticationController.requireLogin(),
      ZoteroController.getPickerLibraries
    )
    webRouter.get(
      '/user/zotero/picker/collections',
      AuthenticationController.requireLogin(),
      ZoteroController.getPickerCollections
    )
    webRouter.get(
      '/user/zotero/picker/items',
      AuthenticationController.requireLogin(),
      ZoteroController.getPickerItems
    )
    webRouter.get(
      '/user/zotero/picker/bibtex',
      AuthenticationController.requireLogin(),
      ZoteroController.getPickerBibtex
    )



  },
}
