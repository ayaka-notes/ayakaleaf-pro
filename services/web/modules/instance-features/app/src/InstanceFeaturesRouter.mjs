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
//    on this instance. A provider is only offered in the UI (settings
//    "Reference managers" section, editor Integrations card) when its OAuth
//    client credentials are configured — with the client id and/or secret
//    missing the Link button can never work, so the option must be hidden
//    (site requirement). zotero additionally honors the explicit provider
//    switch ENABLED_LINKED_FILE_TYPES, which already lists it on this
//    deployment; mendeley is not in that list here, so its credentials are
//    the switch.

export function referenceManagerFeatureFlags({ enabled = [], zoteroCredentials, mendeleyCredentials }) {
  return {
    zotero: Boolean(enabled.includes('zotero') && zoteroCredentials),
    mendeley: Boolean(mendeleyCredentials),
  }
}

function credentialsFor(id) {
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
            enabled: Settings.enabledLinkedFileTypes || [],
            zoteroCredentials: credentialsFor('zotero'),
            mendeleyCredentials: credentialsFor('mendeley'),
          }),
        })
      }
    )
  },
}
