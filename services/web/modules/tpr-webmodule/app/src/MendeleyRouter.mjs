import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { requireUserFeature } from '../../../instance-features/app/src/UserFeatures.mjs'
import MendeleyController from './MendeleyController.mjs'

// Unlinking stays open: a user can always let go of the account
const requireMendeley = requireUserFeature('mendeley')

export default {
  apply(webRouter) {
    // Get Mendeley groups for the create-file modal
    webRouter.get(
      '/mendeley/groups',
      AuthenticationController.requireLogin(),
      requireMendeley,
      MendeleyController.getGroups
    )

    // Start the Mendeley OAuth flow by redirecting to Mendeley's authorization page
    webRouter.get(
      '/user/mendeley/oauth',
      AuthenticationController.requireLogin(),
      requireMendeley,
      MendeleyController.oauth
    )

    // Callback for the Mendeley OAuth flow
    webRouter.get(
      '/user/mendeley/oauth/callback',
      AuthenticationController.requireLogin(),
      requireMendeley,
      MendeleyController.oauthCallback
    )

    // Unlink Mendeley account
    webRouter.post(
      '/mendeley/unlink',
      AuthenticationController.requireLogin(),
      MendeleyController.unlink
    )
  },
}
