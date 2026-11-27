import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { requireUserFeature } from '../../../instance-features/app/src/UserFeatures.mjs'
import ZoteroController from './ZoteroController.mjs'

// Unlinking stays open: a user can always let go of the account
const requireZotero = requireUserFeature('zotero')

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/zotero/groups',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.getGroups
    )

    // Start the Zotero OAuth flow by redirecting to Zotero's authorization page
    webRouter.get(
      '/user/zotero/oauth',
      AuthenticationController.requireLogin(),
      requireZotero,
      ZoteroController.oauth
    )

    // Callback for the Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth/callback',
      AuthenticationController.requireLogin(),
      requireZotero,
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
