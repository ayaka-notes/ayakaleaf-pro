import logger from '@overleaf/logger'
import WakaTimeController from './WakaTimeController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init wakatime router')

    // account-level linking (Account Settings)
    webRouter.get(
      '/user/wakatime/status',
      AuthenticationController.requireLogin(),
      WakaTimeController.getConnectionStatus
    )

    webRouter.put(
      '/user/wakatime',
      AuthenticationController.requireLogin(),
      WakaTimeController.link
    )

    webRouter.delete(
      '/user/wakatime',
      AuthenticationController.requireLogin(),
      WakaTimeController.unlink
    )

    // the logged-in user's own stats across all projects (settings panel)
    webRouter.get(
      '/user/wakatime/summary',
      AuthenticationController.requireLogin(),
      WakaTimeController.getUserSummary
    )

    // dedicated in-Overleaf coding statistics page
    webRouter.get(
      '/user/coding-statistics',
      AuthenticationController.requireLogin(),
      WakaTimeController.codingStatisticsPage
    )

    // WakaTime.com OAuth2 handshake (no client secret ever reaches the browser)
    webRouter.get(
      '/user/wakatime/oauth/authorize',
      AuthenticationController.requireLogin(),
      WakaTimeController.oauthAuthorize
    )

    webRouter.get(
      '/user/wakatime/oauth/callback',
      AuthenticationController.requireLogin(),
      WakaTimeController.oauthCallback
    )

    // per-project heartbeats, sent by the editor's activity tracker
    webRouter.post(
      '/project/:project_id/wakatime/heartbeat',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      WakaTimeController.heartbeat
    )

    webRouter.post(
      '/project/:project_id/wakatime/heartbeats/bulk',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      WakaTimeController.heartbeatsBulk
    )

    // total time tracked for a project, shown in the Integrations panel
    webRouter.get(
      '/project/:project_id/wakatime/summary',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      WakaTimeController.summary
    )
  },
}
