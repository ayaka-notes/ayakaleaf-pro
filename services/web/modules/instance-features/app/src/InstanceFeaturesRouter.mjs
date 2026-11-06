import Settings from '@overleaf/settings'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { isConfigured } from '../../../workbench/app/src/WorkbenchAiClient.mjs'

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
// 2. zotero / mendeley: whether each reference-manager integration is usable
//    on this instance. Site requirement: a provider's UI (settings
//    "Reference managers" section, editor Integrations card, picker menu
//    entries) is hidden whenever its OAuth client id and/or secret is not
//    configured — with credentials missing the Link button can never work.
//    The credentials are therefore THE switch for both providers, keeping
//    this flag consistent with the bib-editor module's /bib/services gate.

export function referenceManagerFeatureFlags({ zoteroCredentials, mendeleyCredentials }) {
  return {
    zotero: Boolean(zoteroCredentials),
    mendeley: Boolean(mendeleyCredentials),
  }
}

function referenceManagerCredentials(id) {
  const clientId =
    process.env[`${id.toUpperCase()}_CLIENT_ID`] ||
    process.env[`${id.toUpperCase()}_CLIENT_KEY`]
  return Boolean(clientId && process.env[`${id.toUpperCase()}_CLIENT_SECRET`])
}

export default {
  apply(webRouter) {
    webRouter.get(
      '/system/features',
      AuthenticationController.requireLogin(),
      (req, res) => {
        res.json({
          ai: isConfigured(),
          githubSync: Features.hasFeature('github-sync'),
          gitlabSync: Boolean(Settings.gitlabSync),
          giteaSync: Boolean(Settings.giteaSync),
          dropbox: Boolean(Settings.dropbox),
          ...referenceManagerFeatureFlags({
            zoteroCredentials: referenceManagerCredentials('zotero'),
            mendeleyCredentials: referenceManagerCredentials('mendeley'),
          }),
        })
      }
    )
  },
}
