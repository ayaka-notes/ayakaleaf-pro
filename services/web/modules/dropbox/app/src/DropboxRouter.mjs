import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import DropboxController from './DropboxController.mjs'

// 'Manual syncing is limited to one per minute' (dropbox_sync_now_rate_limited)
const syncNowRateLimiter = new RateLimiter('dropbox-sync-now', {
  points: 1,
  duration: 60,
})

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    logger.debug({}, 'Init dropbox router')

    // start the Dropbox OAuth flow by redirecting to Dropbox
    webRouter.get(
      '/user/dropbox/oauth',
      AuthenticationController.requireLogin(),
      DropboxController.oauth2
    )

    // callback for the Dropbox OAuth flow
    webRouter.get(
      '/user/dropbox/oauth/callback',
      AuthenticationController.requireLogin(),
      DropboxController.oauth2Callback
    )

    webRouter.post(
      '/user/dropbox/unlink',
      AuthenticationController.requireLogin(),
      DropboxController.unlink
    )

    webRouter.get(
      '/user/dropbox/status',
      AuthenticationController.requireLogin(),
      DropboxController.getStatus
    )

    webRouter.post(
      '/project/:Project_id/dropbox/sync-now',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(syncNowRateLimiter, {
        params: ['Project_id'],
      }),
      DropboxController.syncNow
    )

    // Dropbox webhook: called by Dropbox, which signs the body with the app
    // secret. On the public API router, outside the CSRF protection.
    publicApiRouter.get('/dropbox/webhook', DropboxController.verifyWebhook)
    publicApiRouter.post('/dropbox/webhook', DropboxController.notifyWebhook)
  },
}
