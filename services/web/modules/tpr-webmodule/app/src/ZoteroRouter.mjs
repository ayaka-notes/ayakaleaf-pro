import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ZoteroController from './ZoteroController.mjs'

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/zotero/groups',
      AuthenticationController.requireLogin(),
      ZoteroController.getGroups
    )

    // Start the Zotero OAuth flow by redirecting to Zotero's authorization page
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
