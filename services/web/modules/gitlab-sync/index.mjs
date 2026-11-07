import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let GitLabSyncModule = {}
if (process.env.GITLAB_SYNC_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling GitLab Sync module')

  // Set before importing the app modules: GitLabApiClient reads the
  // GitLab endpoints at import time
  const siteUrl = Settings.siteUrl.replace(/\/+$/, '')

  // GitLab.com and self-managed GitLab (CE/EE) serve the REST API under
  // /api/v4 of the web URL
  //
  //   GITLAB_SYNC_URL            REST API
  // 1) https://gitlab.com         https://gitlab.com/api/v4
  // 2) https://HOST               https://HOST/api/v4
  //
  // GITLAB_SYNC_API_URL overrides the derived endpoint
  const url = (process.env.GITLAB_SYNC_URL || 'https://gitlab.com').replace(/\/+$/, '')
  const apiUrl = process.env.GITLAB_SYNC_API_URL?.replace(/\/+$/, '') || `${url}/api/v4`

  Settings.gitlabSync = {
    clientID: process.env.GITLAB_SYNC_CLIENT_ID,
    clientSecret: process.env.GITLAB_SYNC_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/gitlab-sync/oauth2/callback`,
    url,
    apiUrl,
  }

  // Import lazily so these modules are only evaluated when GitLab Sync is enabled.
  // TokenManager builds an AccessTokenEncryptor at import time (requiring
  // GITLAB_TOKEN_CIPHER_PASSWORD)
  const [{ default: GitLabSyncRouter },
         { default: SyncStateManager },
         { default: TokenManager }
        ] =
    await Promise.all([
      import('./app/src/GitLabSyncRouter.mjs'),
      import('./app/src/SyncStateManager.mjs'),
      import('./app/src/TokenManager.mjs'),
    ])

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await SyncStateManager.removeProjectState(projectId)
      logger.debug({ projectId }, 'on project expire: removed GitLab sync state')
    } catch (err) {
      logger.warn({ projectId, err }, 'on project expire: failed to remove GitLab sync state')
    }
  })

  // Delete user gitlab token from mongo (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await TokenManager.removeUserToken(userId)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user token')
    }
  })

  GitLabSyncModule = {
    router: GitLabSyncRouter,
  }
}

export default GitLabSyncModule
