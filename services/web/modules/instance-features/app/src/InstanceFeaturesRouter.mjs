import Settings from '@overleaf/settings'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { isConfigured } from '../../../workbench/app/src/WorkbenchAiClient.mjs'

// Reports instance features independently of user permissions.
// (Need login to avoid abuse)
// 1. githubSync: whether GitHub Sync is enabled
//    (env var GITHUB_SYNC_ENABLED; via Features.hasFeature, same as git-bridge)
// 2. zotero / mendeley: whether each reference-manager integration is enabled
//    (env var ENABLED_LINKED_FILE_TYPES includes the provider name; no Features
//    case exists for them, so we read the setting directly)

export default {
  apply(webRouter) {
    webRouter.get(
      '/system/features',
      AuthenticationController.requireLogin(),
      (req, res) => {
        res.json({
          ai: isConfigured(),
          githubSync: Features.hasFeature('github-sync'),
          zotero: Boolean(Settings.enabledLinkedFileTypes?.includes('zotero')),
          mendeley: Boolean(
            Settings.enabledLinkedFileTypes?.includes('mendeley')
          ),
        })
      }
    )
  },
}
