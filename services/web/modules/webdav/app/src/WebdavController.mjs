import { expressify } from '@overleaf/promise-utils'
import OError from '@overleaf/o-error'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'

import WebdavHandler from './WebdavHandler.mjs'
import WebdavClient from './WebdavClient.mjs'
import WebdavPaths from './WebdavPaths.mjs'
import ConflictResolver from './ConflictResolver.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import Settings from '@overleaf/settings'

const SyncStateManager = WebdavHandler.SyncStateManager || (await import('./SyncStateManager.mjs')).default

/**
 * Get user's WebDAV connection state (Express-wrapped)
 * Returns whether the current logged-in user has a valid WebDAV connection.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with connected status
 */
async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const isConnected = await WebdavHandler.getConnectionState(userId)
    return res.json({ connected: isConnected })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, userId }, 'failed to get connection status')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Get project's sync state with WebDAV (Express-wrapped)
 * Retrieves the current sync configuration and status for a project.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object  
 * @returns {Promise<void>} Sends JSON response with project state
 */
async function getProjectState(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    // B1.5 (H13): don't perform a live remote PROPFIND on every state read.
    // The handler supports `verifyConnection: false` and then reports the
    // stored state (set at link time) — live verification stays on the
    // link/sync flows (in WebdavHandler, out of this slice's file list).
    const state = await WebdavHandler.getProjectState(projectId, {
      userId,
      verifyConnection: false,
    })
    return res.json(state)
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to get project state')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Poll remote WebDAV for changes and pull them into Overleaf (Express-wrapped)
 * Compares file hashes/ETags between remote and local versions,
 * downloading new files and updating modified ones. Detects conflicts when
 * both sides have been modified since last sync.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with success/error status
 */
async function pullRemoteChanges(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    await WebdavHandler.pollRemoteSync(projectId, { userId })
    return res.json({ success: true, message: 'Pull completed' })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to poll remote WebDAV')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Push local Overleaf changes to WebDAV (Express-wrapped)
 * Uploads all files from the current Overleaf project version to the remote
 * WebDAV folder. Uses ETag-based concurrency control.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params and userId from session
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with success/error status
 */
async function pushLocalChanges(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    await WebdavHandler.pushLocalChanges(userId, projectId)
    return res.json({ success: true, message: 'Push completed' })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to push local changes')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * List remote files in a project's WebDAV folder (Express-wrapped)
 * Returns a list of files from the project's remote WebDAV folder.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with array of files
 */
async function listFiles(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    // Check if project is linked to WebDAV
    const state = await WebdavHandler.getProjectState(projectId)
    if (!state.connected) {
      return res.status(404).json({ message: 'Project not linked to WebDAV' })
    }

    // Build remote path and list files using the in-process WebDAV client
    // B1.2 (H2): use the real by-id helper; `getProjectName` is the Express
    // route handler and always threw when called with a bare projectId.
    const projectName = await getProjectNameFromId(projectId)
    const remoteRoot = WebdavPaths.remotePath(state.rootPath, projectName)

    const credentials = await WebdavCredentials.get(userId)
    const client = new WebdavClient(credentials || state)
    const files = (await client.list(remoteRoot) || []).filter(f => !f.isDirectory)

    return res.json({
      files: files.map(f => ({
        path: f.path,
        size: f.size,
        lastModified: f.lastModified,
      }))
    })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to list remote files')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'

/**
 * B1.2 (H2): Fetch the project name by id (non-Express helper).
 * The `getProjectName` handler below stays exactly as-is because the router
 * imports it as a route handler.
 *
 * @param {string} projectId - Overleaf project id
 * @returns {Promise<string>} Project name (falls back to `project_<id>`)
 */
async function getProjectNameFromId(projectId) {
  const projectDoc = await ProjectGetter.promises.getProject(projectId, { name: 1 })
  return projectDoc?.name || `project_${projectId}`
}

/**
 * Get project name helper (Express-wrapped)
 * Fetches the Overleaf project name from the database.
 * 
 * @param {Object} req - Express request object with req.params.project_id
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with project name
 */
async function getProjectName(req, res) {
  const projectId = req.params.project_id
  try {
    const projectDoc = await ProjectGetter.promises.getProject(projectId, { name: 1 })
    const projectName = projectDoc?.name || `project_${projectId}`
    return res.json({ projectName })
  } catch (err) {
    logger.warn({ message: err.message, projectId }, 'Failed to get project name, using fallback')
    return res.json({ projectName: `project_${projectId}` })
  }
}

/**
 * Link a project to WebDAV (Express-wrapped)
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function linkProject(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const credentials = await WebdavCredentials.get(userId)
    const { baseUrl, username, password } = credentials || {}

    // B1.4 (H12): fall back to the server-wide default root path (Settings)
    // instead of 400ing, so users who connected without an explicit rootPath
    // can still link.
    const rootPath = credentials?.rootPath || Settings.webdav?.rootPath || '/Overleaf'

    if (!baseUrl) {
      return res.status(400).json({
        message: 'WebDAV credentials are not configured'
      })
    }

    if (!username || !password) {
      return res.status(400).json({
        message: 'WebDAV credentials are incomplete'
      })
    }

    const client = new WebdavClient(credentials)
    await client.check()

    // Create project sync state with all credentials (ownerId scopes unlink/
    // user-expire cleanup to the linking user)
    await SyncStateManager.createProjectState(projectId, {
      connected: true,
      baseUrl,
      rootPath,
      username,
      ownerId: userId,
      lastSyncAt: null,
      mergeStatus: 'clean'
    })

    try {
      await WebdavHandler.pushLocalChanges(userId, projectId)
    } catch (pushErr) {
      // B1.3 (H5): failed initial push — remove the orphan "linked" state so
      // neither the UI nor the poller can see a project that is not really
      // linked. Then rethrow so the caller still sees the original error.
      try {
        await SyncStateManager.removeProjectState(projectId)
        const projectName = await getProjectNameFromId(projectId)
        await WebdavCredentials.forgetProject(userId, projectName)
      } catch (cleanupErr) {
        logger.warn(
          { message: cleanupErr?.message, projectId },
          'failed to clean up orphan WebDAV state after failed push'
        )
      }
      throw pushErr
    }

    return res.json({
      success: true,
      message: 'Project linked to WebDAV successfully',
      state: { connected: true, baseUrl, rootPath }
    })
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to link project to WebDAV')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

async function resolveProjectConflict(req, res) {
  const { project_id: projectId } = req.params
  const { path, choice } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    if (!path || !choice) {
      return res.status(400).json({
        message: 'Missing required parameters: path and choice are required'
      })
    }

    if (choice !== 'local' && choice !== 'remote') {
      return res.status(400).json({
        message: "Invalid choice. Must be 'local' or 'remote'"
      })
    }

    // B1.6: pass the requesting userId into the resolver (the real sync work
    // in a later slice needs it). ConflictResolver's signature must be
    // updated to (userId, projectId, path, choice) in that slice.
    await ConflictResolver.resolve(userId, projectId, path, choice)

    return res.json({
      success: true,
      message: `Conflict resolved - keeping ${choice} version`,
      path
    })
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('Conflict not found')) {
      return res.status(404).json({
        message: 'No active conflict for this file',
        errorCode: 'CONFLICT_NOT_FOUND'
      })
    }

    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to resolve conflict')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

/**
 * Unlink a project from WebDAV (Express-wrapped)
 * Removes the association between an Overleaf project and its WebDAV folder.
 * Does NOT delete the remote files - only clears local sync configuration.
 * 
 * @param {Object} req - Express request object, expects `project_id` in params
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with success status
 */
async function unlinkProject(req, res) {
  const { project_id: projectId } = req.params

  try {
    await WebdavHandler.unlinkProject(projectId)
    return res.json({
      success: true,
      message: 'Project unlinked from WebDAV'
    })
  } catch (err) {
    if (err.message?.includes('not linked') || err.message?.includes('not found')) {
      return res.status(404).json({
        message: 'Project is not linked to WebDAV',
        errorCode: 'PROJECT_NOT_LINKED'
      })
    }

    logger.error(OError.getFullStack(err))
    logger.error({ message: err.message, projectId }, 'failed to unlink project from WebDAV')
    return res.status(err?.status || err?.response?.status || 500).json({ message: err.message })
  }
}

export default {
  /**
   * Get user's WebDAV connection state (Express-wrapped)
   */
  getConnectionStatus: expressify(getConnectionStatus),

  /**
   * Get project's sync state with WebDAV (Express-wrapped)
   */
  getProjectState: expressify(getProjectState),

  /**
   * Poll remote WebDAV for changes and pull them into Overleaf (Express-wrapped)
   */
  pullRemoteChanges: expressify(pullRemoteChanges),

  /**
   * Push local Overleaf changes to WebDAV (Express-wrapped)
   */
  pushLocalChanges: expressify(pushLocalChanges),

  /**
   * List remote files in a project's WebDAV folder (Express-wrapped)
   */
  listFiles: expressify(listFiles),

  /**
   * Link a project to WebDAV (Express-wrapped)
   */
  linkProject: expressify(linkProject),

  /**
   * Resolve a conflict by keeping local or remote version (Express-wrapped)
   */
  resolveProjectConflict: expressify(resolveProjectConflict),

  /**
   * Get project name (Express-wrapped)
   */
  getProjectName: expressify(getProjectName),

  /**
   * Unlink a project from WebDAV (Express-wrapped)
   */
  unlinkProject: expressify(unlinkProject),
}
