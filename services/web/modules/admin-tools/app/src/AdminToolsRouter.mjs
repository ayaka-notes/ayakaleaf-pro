import logger from '@overleaf/logger'
import UserListController from './UserListController.mjs'
import ProjectListController from './ProjectListController.mjs'
import NotificationAdminController from './NotificationAdminController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init AdminTools router')

    webRouter.get('/user/activate', UserListController.activateAccountPage)
    AuthenticationController.addEndpointToLoginWhitelist('/user/activate')

    webRouter.get('/admin/user',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.manageUsersPage
    )

    // Notification dispatch management (Apprise)
    webRouter.get('/admin/notifications',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.notificationsAdminPage
    )
    webRouter.post('/admin/notifications/state',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.state
    )
    webRouter.post('/admin/notifications/dry-run',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.setDryRun
    )
    webRouter.post('/admin/notifications/user-url',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.setUserUrl
    )
    webRouter.post('/admin/notifications/test',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.testSend
    )
    webRouter.post('/admin/notifications/queue/retry',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.queueRetry
    )
    webRouter.post('/admin/notifications/queue/clear',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.queueClear
    )
    webRouter.post('/admin/notifications/channels',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      NotificationAdminController.saveChannels
    )

    webRouter.post(
      '/admin/user/create',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.registerNewUser
    )
    webRouter.post('/admin/user/:userId/send-activation',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.sendActivationEmail
    )
    webRouter.get('/admin/user/:userId/info',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getAdditionalUserInfo,
    )
    webRouter.post('/admin/users',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getUsersJson
    )
    webRouter.post('/admin/users/search',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getUsersJsonBySearch
    )
    webRouter.post('/admin/projects/search',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.getProjectsJsonBySearch
    )
    webRouter.post('/admin/user/:userId/delete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.deleteUser
    )
    webRouter.post('/admin/user/:userId/update',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.updateUser,
    )
    webRouter.get('/admin/user/:userId/ai-usage',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.getAiUsage,
    )
    webRouter.post('/admin/user/:userId/ai-usage/reset',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.resetAiUsage,
    )
    webRouter.delete('/admin/user/:userId',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.purgeDeletedUser
    )
    webRouter.post('/admin/user/:userId/restore',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.restoreDeletedUser
    )
    webRouter.post('/admin/user/:userId/projects',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.getProjectsJson
    )

    webRouter.get('/admin/project',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.manageProjectsPage
    )
    webRouter.post('/admin/project/:project_id/trash',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.trashProjectForUser
    )
    webRouter.post('/admin/project/:project_id/untrash',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.untrashProjectForUser
    )
    webRouter.delete('/admin/project/:project_id/purge',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.purgeDeletedProject
    )
    webRouter.post('/admin/project/:project_id/undelete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      ProjectListController.undeleteProject
    )
  },
}
