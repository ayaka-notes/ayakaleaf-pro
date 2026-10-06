import Path from 'path'
import fs from 'fs'
import { pipeline } from 'node:stream/promises'
import crypto from 'crypto'
import pLimit from 'p-limit'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectUploadManager from '../../../../app/src/Features/Uploads/ProjectUploadManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import { SizeLimitedStream } from '../../../../app/src/infrastructure/FileWriter.mjs'
import api from './GitHubApiClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import HistoryManager from './HistoryManager.mjs'
import TokenManager from './TokenManager.mjs'
import {
  GitNotLinkedError,
  InvalidTokenError,
  NotFoundError,
  PermissionDeniedError,
} from './GitSyncErrors.mjs'

async function getGitConnState(userId) {
  try {
    const token = await TokenManager.getUserToken(userId)
    await api.getUser(token)
    return true
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      logger.debug( { err, userId }, 'token invalid, treating as not connected')
      return false
    }
    throw OError.tag(err, 'failed to validate token', { userId })
  }
}

async function getProjectState(userId, projectId) {
  let pss = null
  const projection = { _id: 0, mergeStatus: 1, repoFullName: 1, unmergedBranchName: 1 }
  pss = await SyncStateManager.getProjectState(projectId, projection)
  if (!pss) {
    pss = { mergeStatus: 'need-export' }
    try {
      const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
      if (owner_ref.toString() !== userId) {
        pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
      }
    } catch (err) {
      pss.ownerEmail = 'nobody@nowhere'
      logger.error({ err }, "failed get user email")
    }
    return pss
  }
  let canPush
  try {
    const token = await TokenManager.getUserToken(userId)
    canPush = await api.getPushPermission(token, pss.repoFullName)
  } catch (err) {
    if ((err instanceof NotFoundError) ||
        (err instanceof PermissionDeniedError)
    ) canPush = false
    else throw err
  }
  if (!canPush) {
    pss.mergeStatus = 'need-permission'
    // send owner's email to collaborator
    // send nothing to the owner
    try {
      const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
      if (owner_ref.toString() !== userId) {
        pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
      }
    } catch (err) {
      logger.error({ err, userId }, "failed get user email")
      pss.ownerEmail = 'nobody@nowhere'
    }
  }
  return pss
}

async function unlinkRepo(userId, projectId) {
  const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
  if (owner_ref.toString() !== userId) {
    let ownerEmail
    try {
      ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
    } catch (err) {
      logger.error({ err, userId }, "failed get user email")
      ownerEmail = 'nobody@nowhere'
    }
    return ownerEmail
  }
  await SyncStateManager.removeProjectState(projectId)
  return null
}


async function listUserRepos(userId) {
  const token = await TokenManager.getUserToken(userId)
  return await api.listUserRepos(token)
}

async function getUserAndOrgs(userId) {
  const token = await TokenManager.getUserToken(userId)
  return await api.getUserAndOrgs(token)
}

async function getMergeOverview(userId, projectId) {
  const projectSyncState = await SyncStateManager.getProjectState(projectId)
  if (!projectSyncState) throw new GitNotLinkedError(projectId)
  const { repoFullName, defaultBranchName, lastSyncCommit, lastSyncVersion, mergeStatus } = projectSyncState

  if (mergeStatus === 'conflict') return null

  const token = await TokenManager.getUserToken(userId)
  const currentVersion = await HistoryManager.latestVersion(projectId.toString())
  const isProjectUpdated = currentVersion !== lastSyncVersion
  try {
    const commitsAndStatus = await api.listNewCommitsWithStatus(token, repoFullName, defaultBranchName, lastSyncCommit)
    if(commitsAndStatus.diverged) {
      await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' } )
    }
    return { ...commitsAndStatus, isProjectUpdated }
  } catch (err) {
    if (err instanceof NotFoundError) {
      // what is the reason of NotFoundError? is it a missing commit or not?
      let canPush
      try {
        canPush = await api.getPushPermission(token, repoFullName)
      } catch (e) {
        logger.error({ error: e }, "failed to check push permission")
        canPush = false
      }
      if (!canPush) throw err
      await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' } )
      return { commits: [], diverged: true, isProjectUpdated }
    } else {
      throw err
    }
  }
}

async function importRepo(userId, projectName, repoFullName, defaultBranchName) {
  const token = await TokenManager.getUserToken(userId)
  const defaultBranchHead = await api.getBranchHead(token, repoFullName, defaultBranchName)
  const fsPath = Path.join(Settings.path.dumpFolder, `github_import_${crypto.randomUUID()}`)

  let project_id

  try {
    const stream = await api.getRepoZipball(token, repoFullName, defaultBranchHead)
    await pipeline(stream, new SizeLimitedStream({ maxSizeBytes: Settings.maxUploadSize }), fs.createWriteStream(fsPath))

    const { project } = await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
      userId,
      projectName,
      fsPath
    )

    project_id = project?._id
  } catch (err) {
    throw OError.tag(
      err,
      'failed importing git repo',
      { userId, projectName, repoFullName, defaultBranchName, fsPath }
    )
  } finally {
    await fs.promises.rm(fsPath, { force: true }).catch(() => {})
  }

  try {
    const projectVersion = await HistoryManager.latestVersion(project_id.toString())
    await SyncStateManager.createProjectState(project_id, {
      repoFullName,
      mergeStatus: 'clean',
      lastSyncCommit: defaultBranchHead,
      defaultBranchName,
      lastSyncVersion: projectVersion
    })
  } catch (err) {
// don't throw up
    logger.error(
      { err, userId, projectId: project_id.toString(), repoFullName },
      'Failed to create state of imported repo'
    )
  }

  return project_id
}

async function exportProject(userId, projectId, repoOptions) {
  const isLinked = await SyncStateManager.getProjectState(projectId)
  if (isLinked) {
    throw new OError('Project is already linked to Git server', { projectId })
  }

  const token = await TokenManager.getUserToken(userId)

  const { full_name: repoFullName, default_branch: defaultBranchName } =
    await api.createRepo(token, repoOptions)

  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const currentPaths = await HistoryManager.getPathsAtVersion(projectId, currentVersion)

  const limit = pLimit(api.maxConcurrency)
  const blobData = await Promise.all(
    currentPaths.paths.map((path) =>
      limit(async () => {
        const buffer = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
        const sha = await api.uploadBlob(token, repoFullName, buffer)
        return { path, sha }
      })
    )
  )

  const tree = await api.createTree(token, repoFullName, blobData)
  const initialCommit = await api.createCommit(token, repoFullName, {
    tree,
    message: 'Initial Overleaf import',
  })

  const force = true
  await api.updateBranch(token, repoFullName, defaultBranchName, initialCommit, force)

  return SyncStateManager.createProjectState(projectId, {
    mergeStatus: 'clean',
    defaultBranchName,
    lastSyncCommit: initialCommit,
    lastSyncVersion: currentVersion,
    repoFullName,
  })
}

export default {
  exportProject,
  getProjectState,
  unlinkRepo,
  importRepo,
  getGitConnState,
  listUserRepos,
  getUserAndOrgs,
  getMergeOverview,
}
