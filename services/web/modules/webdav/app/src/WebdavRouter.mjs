import WebdavCredentials from './WebdavCredentials.mjs'
import { WebdavSyncProjectStates } from '../models/webdavSyncProjectStates.mjs'
import WebdavController from './WebdavController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import logger from '@overleaf/logger'
import WebdavHandler from './WebdavHandler.mjs'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware

/**
 * Express router for WebDAV-related API endpoints.
 * Provides routes for:
 * - User connection management (connect, disconnect, status)
 * - Project synchronization (pull, push, state, conflict resolution)
 * - Importing projects from WebDAV
 */
export default {
  /**
   * Registers WebDAV routes on the provided webRouter.
   * 
   * @param {Object} webRouter - Express router instance to register routes on
   */
  apply(webRouter) {
    // Get user's WebDAV connection status
    webRouter.get(
      '/user/webdav/status',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const credentials = await WebdavCredentials.get(userId)
          if (!credentials) {
            return res.json({ connected: false })
          }

          // Get project sync state for last sync info (owned by this user, or
          // legacy docs matched by connection username)
          const projects = await WebdavSyncProjectStates.find(
            {
              $or: [
                { ownerId: userId },
                { username: credentials.username },
              ],
            },
            { projectId: 1, lastSyncAt: 1, lastSyncError: 1, lastConflict: 1 }
          ).lean()

          // H.3 (M10): report the MOST RECENTLY synced project, not an
          // arbitrary Mongo-order document (null lastSyncAt sorts last).
          projects.sort((a, b) => ((b.lastSyncAt && b.lastSyncAt.getTime()) || 0) - ((a.lastSyncAt && a.lastSyncAt.getTime()) || 0))

          res.json({
            connected: true,
            baseUrl: credentials.baseUrl,
            rootPath: credentials.rootPath,
            lastSyncAt: projects[0]?.lastSyncAt || null,
            lastSyncError: projects[0]?.lastSyncError || null,
            lastConflict: projects[0]?.lastConflict || null,
          })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Connect to WebDAV
    webRouter.post(
      '/user/webdav/connect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const { baseUrl, username, password, rootPath } = req.body
          await WebdavCredentials.save(userId, { baseUrl, username, password, rootPath })
          res.json({ success: true })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Disconnect from WebDAV
    webRouter.post(
      '/user/webdav/disconnect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          await WebdavCredentials.remove(userId)
          res.json({ success: true })
        } catch (err) {
          res.status(500).json({ error: err.message })
        }
      }
    )

    // B1.6 / D1: the automatic-poll stub route was removed (no frontend calls
    // it; manual per-project pull/push are the supported sync paths).

    // Get project state
    webRouter.get(
      '/project/:project_id/webdav/state',
      ensureUserCanWriteProjectContent,
      WebdavController.getProjectState
    )

    // Pull from WebDAV into Overleaf (manual trigger)
    webRouter.post(
      '/project/:project_id/webdav/pull',
      ensureUserCanWriteProjectContent,
      WebdavController.pullRemoteChanges
    )

    // Push local Overleaf changes to WebDAV (manual trigger)
    webRouter.post(
      '/project/:project_id/webdav/push',
      ensureUserCanWriteProjectContent,
      WebdavController.pushLocalChanges
    )

    // List remote files in project's WebDAV folder
    webRouter.get(
      '/project/:project_id/webdav/files',
      ensureUserCanWriteProjectContent,
      WebdavController.listFiles
    )

    // Resolve conflict by keeping local or remote version
    webRouter.post(
      '/project/:project_id/webdav/conflict/resolve',
      ensureUserCanWriteProjectContent,
      WebdavController.resolveProjectConflict
    )

    // Link a project to WebDAV (create project sync state)
    webRouter.post(
      '/project/:project_id/webdav/link',
      ensureUserCanWriteProjectContent,
      WebdavController.linkProject
    )

    // Get project name
    webRouter.get(
      '/project/:project_id/webdav/project-name',
      ensureUserCanWriteProjectContent,
      WebdavController.getProjectName
    )

    // Unlink a project from WebDAV (DELETE)
    webRouter.delete(
      '/project/:project_id/webdav/state',
      ensureUserCanWriteProjectContent,
      WebdavController.unlinkProject
    )

    // Create a new project by importing content from WebDAV
    webRouter.post(
      '/project/new/webdav',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const { projectName, rootPath } = req.body
          if (!projectName) {
            return res.status(400).json({ error: 'projectName is required' })
          }

          // Import from WebDAV
          const result = await WebdavHandler.importRemoteProject(
            userId,
            projectName,
            rootPath
          )
          res.json({
            success: true,
            message: 'Import completed',
            projectId: result?.projectId || null,
            importedFiles: result?.importedFiles || 0,
          })
        } catch (err) {
          // Log-safe: req.body carries the user's WebDAV password — never log it
          logger.error(
            {
              err,
              userId,
              baseUrl: req.body?.baseUrl || undefined,
              username: req.body?.username || undefined,
              projectName: req.body?.projectName || undefined,
            },
            'WebDAV import failed'
          )
          res.status(500).json({ error: err.message || 'Import failed' })
        }
      }
    )
  },
}
