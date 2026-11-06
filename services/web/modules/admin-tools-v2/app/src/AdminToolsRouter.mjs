import logger from '@overleaf/logger'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AdminUsersController from './AdminUsersController.mjs'
import AdminUserController from './AdminUserController.mjs'
import AdminUserActionsController from './AdminUserActionsController.mjs'
import AdminUserListsController from './AdminUserListsController.mjs'
import AdminProjectController from './AdminProjectController.mjs'

// Every route is for site admins. Loaded before core's user-activate module
// (moduleImportSequence), whose /admin/user only redirects to its own page.
export default {
  apply(webRouter) {
    logger.debug({}, 'Init AdminTools router')

    const admin = AuthorizationMiddleware.ensureUserIsSiteAdmin

    // the user list
    webRouter.get('/admin/user', admin, AdminUsersController.usersPage)
    webRouter.get('/admin/users/list', admin, AdminUsersController.usersJson)
    webRouter.post(
      '/admin/user/create',
      admin,
      AdminUserActionsController.createUser
    )

    // a user's page
    webRouter.get('/admin/user/:userId', admin, AdminUserController.userPage)
    webRouter.get(
      '/admin/user/:userId/projects/list',
      admin,
      AdminUserListsController.projectsJson
    )
    webRouter.get(
      '/admin/user/:userId/audit-log/list',
      admin,
      AdminUserListsController.auditLogJson
    )
    webRouter.get(
      '/admin/user/:userId/ai-usage',
      admin,
      AdminUserActionsController.aiUsage
    )
    webRouter.post(
      '/admin/user/:userId/ai-usage/reset',
      admin,
      AdminUserActionsController.resetAiUsage
    )
    webRouter.post(
      '/admin/user/:userId/clear-sessions',
      admin,
      AdminUserController.clearSessions
    )

    // what happens to an account
    webRouter.get(
      '/admin/user/:userId/info',
      admin,
      AdminUserActionsController.activationLink
    )
    webRouter.post(
      '/admin/user/:userId/send-activation',
      admin,
      AdminUserActionsController.sendActivationEmail
    )
    webRouter.post(
      '/admin/user/:userId/update',
      admin,
      AdminUserActionsController.updateUser
    )
    webRouter.post(
      '/admin/user/:userId/transfer-projects',
      admin,
      AdminUserController.transferProjects
    )
    webRouter.post(
      '/admin/user/:userId/delete',
      admin,
      AdminUserActionsController.deleteUser
    )
    webRouter.post(
      '/admin/user/:userId/restore',
      admin,
      AdminUserActionsController.restoreDeletedUser
    )
    webRouter.delete(
      '/admin/user/:userId',
      admin,
      AdminUserActionsController.purgeDeletedUser
    )

    // every project of the site, where the core navbar's "Project/Object
    // Lookup" links, and the templates of the gallery
    webRouter.get('/admin/project', admin, AdminProjectController.projectsPage)
    webRouter.get(
      '/admin/projects/list',
      admin,
      AdminUserListsController.allProjectsJson
    )
    webRouter.get(
      '/admin/templates/list',
      admin,
      AdminUserListsController.templatesJson
    )

    // a project's page
    webRouter.get(
      '/admin/project/:projectId',
      admin,
      AdminProjectController.projectPage
    )
    webRouter.get(
      '/admin/project/:projectId/audit-log/list',
      admin,
      AdminUserListsController.projectAuditLogJson
    )
    webRouter.post(
      '/admin/project/:projectId/doc/:docId/restore',
      admin,
      AdminProjectController.restoreDeletedDoc
    )
    webRouter.post(
      '/admin/project/:projectId/undelete',
      admin,
      AdminProjectController.undeleteProject
    )
    webRouter.delete(
      '/admin/project/:projectId/purge',
      admin,
      AdminProjectController.purgeDeletedProject
    )
  },
}
