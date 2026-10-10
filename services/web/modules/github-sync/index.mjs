import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let GitHubSyncModule = {}
if (process.env.GITHUB_SYNC_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling GitHub Sync module')

  // Set before importing the app modules: GitHubApiClient reads the
  // GitHub endpoints at import time
  const siteUrl = Settings.siteUrl.replace(/\/+$/, '')

  // GitHub endpoints, derived like the gh CLI: github.com and GHE.com
  // serve the API on an api. subdomain, GitHub Enterprise Server under /api
  //
  //   GITHUB_SYNC_URL         REST API                     GraphQL API
  // 1) https://github.com      https://api.github.com       https://api.github.com/graphql
  // 2) https://SUB.ghe.com     https://api.SUB.ghe.com      https://api.SUB.ghe.com/graphql
  // 3) https://HOST            https://HOST/api/v3          https://HOST/api/graphql
  //
  // GITHUB_SYNC_API_URL and GITHUB_SYNC_GRAPHQL_URL override the derived
  // endpoints; when only the REST API is set, GraphQL is derived from it
  const url = (process.env.GITHUB_SYNC_URL || 'https://github.com').replace(/\/+$/, '')
  const { hostname } = new URL(url)
  const apiUrl = process.env.GITHUB_SYNC_API_URL?.replace(/\/+$/, '') ||
    (hostname === 'github.com' || hostname.endsWith('.ghe.com')
      ? url.replace('://', '://api.')
      : `${url}/api/v3`)
  const graphqlUrl = process.env.GITHUB_SYNC_GRAPHQL_URL?.replace(/\/+$/, '') ||
    (apiUrl.endsWith('/api/v3') ? apiUrl.replace(/\/v3$/, '/graphql') : `${apiUrl}/graphql`)

  Settings.githubSync = {
    clientID: process.env.GITHUB_SYNC_CLIENT_ID,
    clientSecret: process.env.GITHUB_SYNC_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/github-sync/oauth2/callback`,
    url,
    apiUrl,
    graphqlUrl,
  }

  // Import lazily so these modules are only evaluated when GitHub Sync is enabled.
  // TokenManager builds an AccessTokenEncryptor at import time (requiring
  // GITHUB_TOKEN_CIPHER_PASSWORD)
  const [{ default: GitHubSyncRouter },
         { default: SyncStateManager },
         { default: TokenManager }
        ] =
    await Promise.all([
      import('./app/src/GitHubSyncRouter.mjs'),
      import('./app/src/SyncStateManager.mjs'),
      import('./app/src/TokenManager.mjs'),
    ])

  // Delete project sync state from mongo (hook 'projectExpired')

  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await SyncStateManager.removeProjectState(projectId)
      logger.debug({ projectId }, 'on project expire: removed Git sync state')
    } catch (err) {
      logger.warn({ projectId, err }, 'on project expire: failed to remove Git sync state')
    }
  })

  // Delete user github token from mongo (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await TokenManager.removeUserToken(userId)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user token')
    }
  })

  GitHubSyncModule = {
    router: GitHubSyncRouter,
  }
}

export default GitHubSyncModule
