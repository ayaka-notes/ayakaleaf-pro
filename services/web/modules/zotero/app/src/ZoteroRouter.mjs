import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { requireUserFeature } from '../../../instance-features/app/src/UserFeatures.mjs'
import ZoteroController from './ZoteroController.mjs'

// Per-user switch (admin panel): a user with Zotero turned off gets 403.
// Unlinking stays open: a user can always let go of the account.
const requireZotero = requireUserFeature('zotero')

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/user/zotero/groups',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getGroups
    )

    // legacy path (tpr-webmodule create-file mode + older host UIs) — same handler
    webRouter.get(
      '/zotero/groups',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getGroups
    )

    webRouter.get(
      '/user/zotero/collections',
      AuthenticationController.requireLogin(),
      requireZotero,
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
      requireZotero,
      ZoteroController.oauth
    )
    // callback for Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth/callback',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.oauthCallback
    )

    // Library-page picker surface (bib-editor module, ported 2026-11-05)
    webRouter.get(
      '/user/zotero/picker/libraries',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getPickerLibraries
    )
    webRouter.get(
      '/user/zotero/picker/collections',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getPickerCollections
    )
    webRouter.get(
      '/user/zotero/picker/items',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getPickerItems
    )
    webRouter.get(
      '/user/zotero/picker/bibtex',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getPickerBibtex
    )



  },
}
