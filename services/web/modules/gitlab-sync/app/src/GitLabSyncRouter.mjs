import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

import GitLabSyncController from './GitLabSyncController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init gitlab-sync router')
    // expose the GitLab web URL for repo/commit links in the frontend
    webRouter.use('/project', (req, res, next) => {
      res.locals.ExposedSettings.gitlabUrl = Settings.gitlabSync.url
      next()
    })

    // start the GitLab OAuth flow by redirecting to GitLab authorization page
    webRouter.get(
      '/user/gitlab-sync/oauth2',
      AuthenticationController.requireLogin(),
      GitLabSyncController.oauth2
    )

    // callback for GitLab OAuth flow
    webRouter.get(
      '/user/gitlab-sync/oauth2/callback',
      AuthenticationController.requireLogin(),
      GitLabSyncController.oauth2Callback
    )

    // unlink GitLab account
    webRouter.post(
      '/user/gitlab-sync/unlink',
      AuthenticationController.requireLogin(),
      GitLabSyncController.unlink
    )

    // get user git connection status
    webRouter.get(
      '/user/gitlab-sync/status',
      AuthenticationController.requireLogin(),
      GitLabSyncController.getConnectionStatus
    )

    // get git user name and user's organizations
    webRouter.get(
      '/user/gitlab-sync/orgs',
      AuthenticationController.requireLogin(),
      GitLabSyncController.getUserAndOrgs
    )

    // list user's repos
    webRouter.get(
      '/user/gitlab-sync/repos',
      AuthenticationController.requireLogin(),
      GitLabSyncController.listUserRepos
    )

    // create a new project from git server repo
    webRouter.post(
      '/project/new/gitlab-sync',
      AuthenticationController.requireLogin(),
      GitLabSyncController.importRepo
    )

    // export project to git server
    webRouter.post(
      '/project/:project_id/gitlab-sync/export',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitLabSyncController.exportProject
    )

    // get project sync state
    webRouter.get(
      '/project/:project_id/gitlab-sync/state',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitLabSyncController.getProjectState
    )

    // get overview of the coming merge:
    // merge state (clean or diverged), unmerged commits, is OL version changed?
    webRouter.get(
      '/project/:project_id/gitlab-sync/merge/overview',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitLabSyncController.getMergeOverview
    )

    // merge OL project with Git server repo
    webRouter.post(
      '/project/:project_id/gitlab-sync/merge',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitLabSyncController.gitMerge
    )

    // unlink Git repo from Git server
    webRouter.delete(
      '/project/:project_id/gitlab-sync',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitLabSyncController.unlinkRepo
    )
  },
}
