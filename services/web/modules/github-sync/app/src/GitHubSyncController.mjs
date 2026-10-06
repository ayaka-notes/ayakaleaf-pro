import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import { FileTooLargeError } from '../../../../app/src/Features/Errors/Errors.js'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import Csrf from '../../../../app/src/infrastructure/Csrf.mjs'
import GitHubSyncHandler from './GitHubSyncHandler.mjs'
import TokenManager from './TokenManager.mjs'
import api from './GitHubApiClient.mjs'
import { doGitMerge } from './GitMerge.mjs'
import { InvalidTokenError, GitNotLinkedError } from './GitSyncErrors.mjs'

async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const isConnected = await GitHubSyncHandler.getGitConnState(userId)
    res.json(isConnected)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed to check user connection")
    return res.status(errStatus).json({ message: err.message })
  }
}

async function getProjectState(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const pss = await GitHubSyncHandler.getProjectState(userId, projectId)
    return res.json(pss)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed get project sync state")
    return res.status(errStatus).json({ message: err.message })
  }
}

async function getUserAndOrgs(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const userAndOrgs = await GitHubSyncHandler.getUserAndOrgs(userId)
  res.json(userAndOrgs)
}
async function listUserRepos(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const repos = await GitHubSyncHandler.listUserRepos(userId)
    res.json({ repos })

  } catch (err) {
    if (err instanceof InvalidTokenError) {
      return res.json(null)
    }
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ userId, info }, 'Failed to get repositories list')
    return res.status(errStatus).json({ message: err.message })
  }
}

async function getMergeOverview(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const commitsAndStatus = await GitHubSyncHandler.getMergeOverview(userId, projectId)
    res.json(commitsAndStatus)

  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error listing commits since last sync')
    return res.status(errStatus).json({ message: err.message })
  }
}

// Import a GitHub repository as a new project
async function importRepo(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { name, fullName, defaultBranchName } = req.body

  try {
    const projectId = await GitHubSyncHandler.importRepo(userId, name, fullName, defaultBranchName)
    res.json({ projectId })
  } catch (error) {
    logger.error({ error, userId }, 'Failed to import git repository from server')
    if (error instanceof FileTooLargeError) {
      return res.status(422).json({ message: req.i18n.translate('file_too_large') })
    }
    res.status(error.status || 500).json({ message: error.message })
  }
}

// Redirect user to Git server OAuth2 authorization URL
async function oauth2(req, res) {
  const oauth2Url = api.getOAuth2Url()
  oauth2Url.searchParams.append('state', req.csrfToken())
  res.redirect(oauth2Url.toString())
}

// callback
async function oauth2Callback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { code, state } = req.query

  try {
    await Csrf.promises.validateToken(state, req.session)
  } catch {
    HttpErrorHandler.forbidden(req, res, 'Invalid CSRF token')
    return
  }

  let token
  try {
    token = await api.exchangeCodeForToken(code)
    if (!token) {
      HttpErrorHandler.badRequest(req, res, 'Failed to obtain access token from Git server')
      return
    }
  } catch (err) {
    const info = OError.getFullInfo(err)
    logger.error(OError.getFullStack(err))
    logger.error({ info, userId }, 'Failed to obtain access token from Git server')
    HttpErrorHandler.badRequest(req, res, err.message || 'Bad request')
    return
  }

  try {
    await TokenManager.saveUserToken(userId, token)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, userId }, 'Error saving user token')
    HttpErrorHandler.handleErrorByStatusCode(req, res, err, errStatus)
    return
  }

  // Save success message in session to display on redirect
  req.session.projectSyncSuccessMessage =
    req.i18n.translate('github_successfully_linked_description')
  res.redirect('/user/settings?oauth-complete=github#project-sync')
}

// Unlink user's Git server account
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await TokenManager.removeUserToken(userId)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error removing user credentials')
    return res.status(errStatus).json({ message: err.message })
  }
  res.sendStatus(200)
}

// Export project to Git server
// Expected req.body:
//   name (string): repository name
//   description (string, optional): repository description
//   isPublic (boolean, optional): if true, the repository is public
//   org (string, optional): if provided, repository will be created under this organization

async function exportProject(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params

  try {
    await GitHubSyncHandler.exportProject(userId, projectId, req.body)

  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error exporting project')
    const key = 'github_validation_check'
    return res.status(errStatus).json({ key, message: err.message })
  }
  res.sendStatus(200)
}

async function gitMerge(req, res) {
  const { project_id: projectId } = req.params
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const commitMessage =  req.body?.message || 'Updates from Overleaf'
    const claimConflictIsResolved = req.body.claimConflictIsResolved

    const mergeResult = await doGitMerge(userId, projectId, commitMessage, claimConflictIsResolved)

    res.json(mergeResult)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error syncing project to GitHub')
    return res.status(errStatus).json({ message: err.message })
  }
}

// Unlink user's Git server account
async function unlinkRepo(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const ownerEmail = await GitHubSyncHandler.unlinkRepo(userId, projectId)
    if (ownerEmail) return res.status(403).json({ ownerEmail })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error unlinking repo from project')
    return res.status(errStatus).json({ message: err.message })
  }
  res.sendStatus(200)
}
export default {
  getConnectionStatus: expressify(getConnectionStatus),
  getProjectState: expressify(getProjectState),
  oauth2: expressify(oauth2),
  unlink: expressify(unlink),
  getUserAndOrgs: expressify(getUserAndOrgs),
  oauth2Callback: expressify(oauth2Callback),
  listUserRepos: expressify(listUserRepos),
  importRepo: expressify(importRepo),
  exportProject: expressify(exportProject),
  getMergeOverview: expressify(getMergeOverview),
  gitMerge: expressify(gitMerge),
  unlinkRepo: expressify(unlinkRepo),
}
