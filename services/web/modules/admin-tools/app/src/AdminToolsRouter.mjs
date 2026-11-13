import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AdminProjectController from './AdminProjectController.mjs'
import AdminUserController from './AdminUserController.mjs'

// Every route is for site admins. Loaded before core's user-activate module
// (moduleImportSequence), whose /admin/user only redirects to its own page.
export default {
  apply(webRouter) {
    logger.debug({}, 'Init AdminTools router')

    // core's login check first: a list fetched after the session ended gets
    // a 401, not the login page that the admin check redirects to
    const admin = [
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
    ]

    // the user list
    webRouter.get('/admin/user', admin, AdminUserController.usersPage)
    webRouter.get('/admin/users/list', admin, AdminUserController.usersJson)
    webRouter.post('/admin/user/create', admin, AdminUserController.createUser)

    // a user's page
    webRouter.get('/admin/user/:userId', admin, AdminUserController.userPage)
    webRouter.get(
      '/admin/user/:userId/projects/list',
      admin,
      AdminUserController.projectsJson
    )
    webRouter.get(
      '/admin/user/:userId/audit-log/list',
      admin,
      AdminUserController.auditLogJson
    )
    webRouter.get(
      '/admin/user/:userId/ai-usage',
      admin,
      AdminUserController.aiUsage
    )
    webRouter.post(
      '/admin/user/:userId/ai-usage/reset',
      admin,
      AdminUserController.resetAiUsage
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
      AdminUserController.activationLink
    )
    webRouter.post(
      '/admin/user/:userId/send-activation',
      admin,
      AdminUserController.sendActivationEmail
    )
    webRouter.post(
      '/admin/user/:userId/send-password-reset',
      admin,
      AdminUserController.sendPasswordReset
    )
    webRouter.post(
      '/admin/user/:userId/update',
      admin,
      AdminUserController.updateUser
    )
    webRouter.post(
      '/admin/user/:userId/remove-email',
      admin,
      AdminUserController.removeEmail
    )
    webRouter.post(
      '/admin/user/:userId/transfer-projects',
      admin,
      AdminUserController.transferProjects
    )
    webRouter.post(
      '/admin/user/:userId/delete',
      admin,
      AdminUserController.deleteUser
    )
    webRouter.post(
      '/admin/user/:userId/restore',
      admin,
      AdminUserController.restoreDeletedUser
    )
    webRouter.delete(
      '/admin/user/:userId',
      admin,
      AdminUserController.purgeDeletedUser
    )

    // every project of the site, where the core navbar's "Project/Object
    // Lookup" links, and the templates of the gallery
    webRouter.get('/admin/project', admin, AdminProjectController.projectsPage)
    webRouter.get(
      '/admin/projects/list',
      admin,
      AdminProjectController.projectsJson
    )
    webRouter.get(
      '/admin/templates/list',
      admin,
      AdminProjectController.templatesJson
    )
    webRouter.delete(
      '/admin/templates/:templateId',
      admin,
      AdminProjectController.deleteTemplate
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
      AdminProjectController.auditLogJson
    )
    webRouter.post(
      '/admin/project/:projectId/doc/:docId/restore',
      admin,
      AdminProjectController.restoreDeletedDoc
    )
    webRouter.delete(
      '/admin/project/:projectId',
      admin,
      AdminProjectController.deleteProject
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
