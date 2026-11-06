import Settings from '@overleaf/settings'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { isConfigured } from '../../../workbench/app/src/WorkbenchAiClient.mjs'
import { resolveWorkbenchLane } from '../../../workbench/app/src/LlmBridge.mjs'

// Reports instance features independently of user permissions.
// (Need login to avoid abuse)
// 1. githubSync: whether GitHub Sync is enabled
//    (env var GITHUB_SYNC_ENABLED; via Features.hasFeature, same as git-bridge)
//    gitlabSync: whether GitLab Sync is enabled (env var GITLAB_SYNC_ENABLED;
//    the gitlab-sync module sets Settings.gitlabSync only when enabled)
//    giteaSync: whether Gitea Sync is enabled (env var GITEA_SYNC_ENABLED;
//    the gitea-sync module sets Settings.giteaSync only when enabled)
//    dropbox: whether Dropbox sync is enabled (env var DROPBOX_ENABLED;
//    the dropbox module sets Settings.dropbox only when enabled)
// 2. zotero / mendeley: whether each reference-manager integration is enabled
//    (env var ENABLED_LINKED_FILE_TYPES includes the provider name; no Features
//    case exists for them, so we read the setting directly)

export default {
  apply(webRouter) {
    webRouter.get(
      '/system/features',
      AuthenticationController.requireLogin(),
      async (req, res) => {
        // overleaf-lab (2026-11, BYO phase 1): `ai` is USER-SCOPED — true when
        // the operator gateway is configured OR this user can resolve an LLM
        // lane (BYO row / site provider). The workbench UI gates its composer
        // on this flag (useInstanceFeatures -> useAiAccess), so without this
        // change BYO users get an inert (disabled) composer even though
        // /workbench/chat itself works.
        let ai = isConfigured()
        if (!ai) {
          try {
            const userId = SessionManager.getLoggedInUserId(req.session)
            if (userId) {
              ai = Boolean(await resolveWorkbenchLane(userId))
            }
          } catch {
            ai = false
          }
        }
        res.json({
          ai,
          githubSync: Features.hasFeature('github-sync'),
          gitlabSync: Boolean(Settings.gitlabSync),
          giteaSync: Boolean(Settings.giteaSync),
          dropbox: Boolean(Settings.dropbox),
          zotero: Boolean(Settings.enabledLinkedFileTypes?.includes('zotero')),
          mendeley: Boolean(
            Settings.enabledLinkedFileTypes?.includes('mendeley')
          ),
        })
      }
    )
  },
}
