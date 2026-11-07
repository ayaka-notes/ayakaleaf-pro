import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { isConfigured } from '../../../workbench/app/src/WorkbenchAiClient.mjs'
import { isFeatureOn } from './UserFeatures.mjs'

// Reports which features this user can use: those the instance has, unless an
// admin turned them off for the user (user.features, the admin panel's
// switches). The bundled UI of each feature hides itself by this answer.
// (Need login to avoid abuse)
// 1. githubSync: whether GitHub Sync is enabled
//    (env var GITHUB_SYNC_ENABLED; via Features.hasFeature, same as git-bridge)
//    gitlabSync: whether GitLab Sync is enabled (env var GITLAB_SYNC_ENABLED;
//    the gitlab-sync module sets Settings.gitlabSync only when enabled)
//    giteaSync: whether Gitea Sync is enabled (env var GITEA_SYNC_ENABLED;
//    the gitea-sync module sets Settings.giteaSync only when enabled)
//    dropbox: whether Dropbox sync is enabled (env var DROPBOX_ENABLED;
//    the dropbox module sets Settings.dropbox only when enabled)
//    gitBridge: whether git-bridge is enabled (env var GIT_BRIDGE_ENABLED)
// 2. zotero / mendeley: whether each reference-manager integration is enabled
//    (env var ENABLED_LINKED_FILE_TYPES includes the provider name; no Features
//    case exists for them, so we read the setting directly)
// AI is per user through its own /workbench/access.

export default {
  apply(webRouter) {
    webRouter.get(
      '/system/features',
      AuthenticationController.requireLogin(),
      expressify(async (req, res) => {
        const user = await UserGetter.promises.getUser(
          SessionManager.getLoggedInUserId(req.session),
          { features: 1 }
        )
        res.json({
          ai: isConfigured(),
          githubSync:
            Features.hasFeature('github-sync') && isFeatureOn(user, 'github'),
          gitlabSync: Boolean(Settings.gitlabSync),
          giteaSync: Boolean(Settings.giteaSync),
          dropbox: Boolean(Settings.dropbox) && isFeatureOn(user, 'dropbox'),
          zotero:
            Boolean(Settings.enabledLinkedFileTypes?.includes('zotero')) &&
            isFeatureOn(user, 'zotero'),
          mendeley:
            Boolean(Settings.enabledLinkedFileTypes?.includes('mendeley')) &&
            isFeatureOn(user, 'mendeley'),
          gitBridge:
            Features.hasFeature('git-bridge') && isFeatureOn(user, 'gitBridge'),
        })
      })
    )
  },
}
