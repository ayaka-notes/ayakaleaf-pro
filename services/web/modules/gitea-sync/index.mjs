import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let GiteaSyncModule = {}
if (process.env.GITEA_SYNC_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling Gitea Sync module')

  // Set before importing the app modules: GiteaApiClient reads the
  // Gitea endpoints at import time
  const siteUrl = Settings.siteUrl.replace(/\/+$/, '')

  // Gitea serves the REST API under /api/v1 of its ROOT_URL (1.23 or later
  // is required)
  //
  //   GITEA_SYNC_URL             REST API
  // 1) https://gitea.com          https://gitea.com/api/v1
  // 2) https://HOST/PATH          https://HOST/PATH/api/v1
  //
  // GITEA_SYNC_API_URL overrides the derived endpoint
  const url = (process.env.GITEA_SYNC_URL || 'https://gitea.com').replace(/\/+$/, '')
  const apiUrl = process.env.GITEA_SYNC_API_URL?.replace(/\/+$/, '') || `${url}/api/v1`

  Settings.giteaSync = {
    clientID: process.env.GITEA_SYNC_CLIENT_ID,
    clientSecret: process.env.GITEA_SYNC_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/gitea-sync/oauth2/callback`,
    url,
    apiUrl,
  }

  // Import lazily so these modules are only evaluated when Gitea Sync is enabled.
  // TokenManager builds an AccessTokenEncryptor at import time (requiring
  // GITEA_TOKEN_CIPHER_PASSWORD)
  const [{ default: GiteaSyncRouter },
         { default: SyncStateManager },
         { default: TokenManager }
        ] =
    await Promise.all([
      import('./app/src/GiteaSyncRouter.mjs'),
      import('./app/src/SyncStateManager.mjs'),
      import('./app/src/TokenManager.mjs'),
    ])

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await SyncStateManager.removeProjectState(projectId)
      logger.debug({ projectId }, 'on project expire: removed Gitea sync state')
    } catch (err) {
      logger.warn({ projectId, err }, 'on project expire: failed to remove Gitea sync state')
    }
  })

  // Delete user gitea token from mongo (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await TokenManager.removeUserToken(userId)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user token')
    }
  })

  GiteaSyncModule = {
    router: GiteaSyncRouter,
  }
}

export default GiteaSyncModule
