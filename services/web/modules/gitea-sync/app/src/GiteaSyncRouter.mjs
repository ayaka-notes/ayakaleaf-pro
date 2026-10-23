import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

import GiteaSyncController from './GiteaSyncController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init gitea-sync router')
    // expose the Gitea web URL for repo/commit links in the frontend
    webRouter.use('/project', (req, res, next) => {
      res.locals.ExposedSettings.giteaUrl = Settings.giteaSync.url
      next()
    })

    // start the Gitea OAuth flow by redirecting to Gitea authorization page
    webRouter.get(
      '/user/gitea-sync/oauth2',
      AuthenticationController.requireLogin(),
      GiteaSyncController.oauth2
    )

    // callback for Gitea OAuth flow
    webRouter.get(
      '/user/gitea-sync/oauth2/callback',
      AuthenticationController.requireLogin(),
      GiteaSyncController.oauth2Callback
    )

    // unlink Gitea account
    webRouter.post(
      '/user/gitea-sync/unlink',
      AuthenticationController.requireLogin(),
      GiteaSyncController.unlink
    )

    // get user git connection status
    webRouter.get(
      '/user/gitea-sync/status',
      AuthenticationController.requireLogin(),
      GiteaSyncController.getConnectionStatus
    )

    // get git user name and user's organizations
    webRouter.get(
      '/user/gitea-sync/orgs',
      AuthenticationController.requireLogin(),
      GiteaSyncController.getUserAndOrgs
    )

    // list user's repos
    webRouter.get(
      '/user/gitea-sync/repos',
      AuthenticationController.requireLogin(),
      GiteaSyncController.listUserRepos
    )

    // create a new project from git server repo
    webRouter.post(
      '/project/new/gitea-sync',
      AuthenticationController.requireLogin(),
      GiteaSyncController.importRepo
    )

    // export project to git server
    webRouter.post(
      '/project/:project_id/gitea-sync/export',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GiteaSyncController.exportProject
    )

    // get project sync state
    webRouter.get(
      '/project/:project_id/gitea-sync/state',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GiteaSyncController.getProjectState
    )

    // get overview of the coming merge:
    // merge state (clean or diverged), unmerged commits, is OL version changed?
    webRouter.get(
      '/project/:project_id/gitea-sync/merge/overview',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GiteaSyncController.getMergeOverview
    )

    // merge OL project with Git server repo
    webRouter.post(
      '/project/:project_id/gitea-sync/merge',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GiteaSyncController.gitMerge
    )

    // unlink Git repo from Git server
    webRouter.delete(
      '/project/:project_id/gitea-sync',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GiteaSyncController.unlinkRepo
    )
  },
}
