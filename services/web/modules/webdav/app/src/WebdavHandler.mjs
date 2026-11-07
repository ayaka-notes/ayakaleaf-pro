import WebdavClient from './WebdavClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import WebdavTokenManager from './WebdavTokenManager.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import logger from '@overleaf/logger'
import WebdavSync from './WebdavSync.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import { Readable } from 'node:stream'

async function getConnectionState(userId) {
  try {
    const credentials = await WebdavTokenManager.getUserCredentials(userId)
    if (!credentials) return false
    
    const client = new WebdavClient(credentials)
    await client.check()
    return true
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to verify WebDAV connection')
    return false
  }
}

async function getProjectState(projectId, { userId, verifyConnection = true } = {}) {
  let state = await SyncStateManager.getProjectState(projectId)
  if (!state) {
    return { connected: false }
  }
  
  // Verify the connection is still valid (unless disabled).
  // H13: when disabled (plain state read) do NOT do a live remote check on
  // every render — the state document's existence IS the link; connectivity
  // is verified only on the link/push/pull flows (which keep verifyConnection
  // at its default of true).
  if (verifyConnection) {
    try {
      const credentials = userId ? await WebdavCredentials.get(userId) : null
      const client = new WebdavClient(credentials || state)
      await client.check()
      state.connected = true
    } catch (err) {
      logger.warn({ err, projectId }, 'Failed to verify WebDAV connection status')
      state.connected = false
    }
  } else {
    state.connected = true
  }

  return state
}

async function unlinkProject(projectId) {
  const state = await SyncStateManager.getProjectState(projectId)
  if (!state) {
    throw new Error('Project is not linked to WebDAV')
  }

  await SyncStateManager.removeProjectState(projectId)

  // C3: unlinking must actually remove the link — drop the user's
  // syncedProjects entry + per-project remoteState, otherwise the manual
  // poll keeps applying remote changes to the "unlinked" project. The state
  // doc records who linked it (ownerId) — use that user for the cleanup
  // (legacy docs without ownerId are best-effort skipped).
  if (state.ownerId) {
    try {
      const project = await ProjectGetter.promises.getProject(projectId, { name: 1 })
      if (project) {
        await WebdavCredentials.forgetProject(state.ownerId, project.name)
      }
    } catch (err) {
      // Best-effort: the state doc (the authoritative link) is already gone.
      logger.warn({ err, projectId }, 'C3: failed to forget project after WebDAV unlink (best-effort)')
    }
  }
}

async function importRemoteProject(userId, projectName, rootPath) {
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) throw new Error('WebDAV is not connected')

  const remoteRoot = WebdavPaths.remotePath(
    rootPath || credentials.rootPath,
    projectName
  )
  const client = new WebdavClient(credentials)
  const files = []

  async function collectFiles(resourcePath) {
    for (const entry of await client.list(resourcePath)) {
      if (entry.path === resourcePath || entry.path.endsWith(`${resourcePath}/`)) continue
      if (entry.isDirectory) await collectFiles(entry.path)
      else files.push(entry)
    }
  }

  await collectFiles(remoteRoot)
  if (files.length === 0) {
    logger.info({ projectId, remoteRoot }, 'No files found in WebDAV project folder')
    return { importedFiles: 0 }
  }

  let importedFiles = 0
  for (const file of files) {
    let relativePath = file.path.slice(remoteRoot.length) || '/'
    // remoteRoot carries a trailing slash (remotePath() appends filePath),
    // so re-add the leading one: TPDS paths are project-absolute ('/main.tex'),
    // and dirname('main.tex') === '.' fails the element-name check.
    if (!relativePath.startsWith('/')) relativePath = `/${relativePath}`
    const body = await client.get(file.path)
    await TpdsUpdateHandler.promises.newUpdate(
      userId,
      null,
      projectName,
      relativePath,
      Readable.from([Buffer.from(body)]),
      'webdav'
    )
    importedFiles += 1
  }

  // Resolve the created/imported project so the caller can open it (the
  // import is name-addressed by design; the project with this name exists
  // now that its files have been merged).
  let projectId = null
  if (importedFiles > 0) {
    const projects =
      await ProjectGetter.promises.findUsersProjectsByName(userId, projectName)
    projectId = projects?.[0]?._id || null
  }

  return { importedFiles, projectId }
}

async function pushLocalChanges(userId, projectId) {
  await WebdavSync.syncProject(userId, projectId)
  return { success: true, message: 'Push completed' }
}

async function pollRemoteSync(projectId, { userId } = {}) {
  if (!userId) throw new Error('User is required for WebDAV pull')
  // Per-project pull: only this project is processed (not all user projects)
  await WebdavSync.pollProject(userId, projectId)
  return { success: true, message: 'Pull completed' }
}

export default {
  getConnectionState,
  getProjectState,
  unlinkProject,
  importRemoteProject,
  pushLocalChanges,
  pollRemoteSync,
}

export { SyncStateManager, WebdavTokenManager }
