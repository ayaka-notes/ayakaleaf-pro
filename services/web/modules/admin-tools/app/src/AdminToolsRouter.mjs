import logger from '@overleaf/logger'
import UserListController from './UserListController.mjs'
import ProjectListController from './ProjectListController.mjs'
import SystemMessagesController from './SystemMessagesController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init AdminTools router')

    webRouter.get('/user/activate', UserListController.activateAccountPage)
    AuthenticationController.addEndpointToLoginWhitelist('/user/activate')

    // "System Messages" pane of the classic /admin page, moved to its own
    // React page (the CRUD endpoints live in app/src/router.mjs).
    webRouter.get('/admin/messages',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      SystemMessagesController.manageMessagesPage
    )

    webRouter.get('/admin/user',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserListController.manageUsersPage
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
