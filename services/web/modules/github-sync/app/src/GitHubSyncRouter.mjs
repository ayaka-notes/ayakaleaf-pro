import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

import GitHubSyncController from './GitHubSyncController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import { requireUserFeature } from '../../../instance-features/app/src/UserFeatures.mjs'

// Unlinking stays open: a user can always let go of an account or a repository
const requireGitHub = requireUserFeature('github')

export default {
  apply(webRouter) {
    logger.debug({}, 'Init github-sync router')
    // expose the GitHub web URL for repo/commit links in the frontend
    webRouter.use('/project', (req, res, next) => {
      res.locals.ExposedSettings.githubUrl = Settings.githubSync.url
      next()
    })

    // start the GitHub OAuth flow by redirecting to GitHub authorization page
    webRouter.get(
      '/user/github-sync/oauth2',
      AuthenticationController.requireLogin(),
      requireGitHub,
      GitHubSyncController.oauth2
    )

    // callback for GitHub OAuth flow
    webRouter.get(
      '/user/github-sync/oauth2/callback',
      AuthenticationController.requireLogin(),
      requireGitHub,
      GitHubSyncController.oauth2Callback
    )

    // unlink GitHub account
    webRouter.post(
      '/user/github-sync/unlink',
      AuthenticationController.requireLogin(),
      GitHubSyncController.unlink
    )

    // get user git connection status
    webRouter.get(
      '/user/github-sync/status',
      AuthenticationController.requireLogin(),
      requireGitHub,
      GitHubSyncController.getConnectionStatus
    )

    // get git user name and user's organizations
    webRouter.get(
      '/user/github-sync/orgs',
      AuthenticationController.requireLogin(),
      requireGitHub,
      GitHubSyncController.getUserAndOrgs
    )

    // list user's repos
    webRouter.get(
      '/user/github-sync/repos',
      AuthenticationController.requireLogin(),
      requireGitHub,
      GitHubSyncController.listUserRepos
    )

    // create a new project from git server repo
    webRouter.post(
      '/project/new/github-sync',
      AuthenticationController.requireLogin(),
      requireGitHub,
      GitHubSyncController.importRepo
    )

    // export project to git server
    webRouter.post(
      '/project/:project_id/github-sync/export',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      requireGitHub,
      GitHubSyncController.exportProject
    )

    // get project sync state
    webRouter.get(
      '/project/:project_id/github-sync/state',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      requireGitHub,
      GitHubSyncController.getProjectState
    )

    // get overview of the coming merge:
    // merge state (clean or diverged), unmerged commits, is OL version changed?
    webRouter.get(
      '/project/:project_id/github-sync/merge/overview',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      requireGitHub,
      GitHubSyncController.getMergeOverview
    )

    // merge OL project with Git server repo
    webRouter.post(
      '/project/:project_id/github-sync/merge',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      requireGitHub,
      GitHubSyncController.gitMerge
    )

    // unlink Git repo from Git server
    webRouter.delete(
      '/project/:project_id/github-sync',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitHubSyncController.unlinkRepo
    )
  },
}
