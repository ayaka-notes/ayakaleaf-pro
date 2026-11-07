import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let WebdavModule = {}
if (process.env.WEBDAV_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling WebDAV module')

  const [
    { default: WebdavRouter },
    { WebdavSyncProjectStates },
    { WebdavUserCredentials }
  ] = await Promise.all([
    import('./app/src/WebdavRouter.mjs'),
    import('./app/models/webdavSyncProjectStates.mjs'),
    import('./app/models/webdavUserCredentials.mjs')
  ])

  // Set Settings.webdav for frontend exposure + sync flows (WD-12/ARC-08:
  // rootPath must actually be set here — it is the fallback remote root).
  Settings.webdav = {
    enabled: true,
    rootPath: process.env.WEBDAV_ROOT_PATH || '/Overleaf',
  }
  logger.debug({}, 'WebDAV module enabled (Settings.webdav configured)')

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await WebdavSyncProjectStates.deleteMany({ projectId })
      logger.debug({ projectId }, 'on project expire: removed WebDAV sync state')
    } catch (err) {
      logger.warn(
        { projectId, err },
        'on project expire: failed to remove WebDAV sync state'
      )
    }
  })

  // Delete user credentials from mongo (hook 'expireDeletedUser')
  // States are matched by ownerId ONLY. H6-class scope (RF.3): the old legacy
  // fallback (baseUrl match from the user's stored credentials) cross-deleted
  // OTHER users' state docs when several users link the same shared server —
  // a shared baseUrl is not ownership. Legacy docs without ownerId are
  // deliberately left in place.
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      const cleanupSelector = { ownerId: userId }

      const syncStates = await WebdavSyncProjectStates.find(cleanupSelector).lean()
      for (const state of syncStates) {
        await WebdavSyncProjectStates.deleteOne({ projectId: state.projectId })
        logger.debug(
          { userId, projectId: state.projectId?.toString?.() },
          'on user expire: unlinked project from WebDAV'
        )
      }

      // Then delete credentials
      await WebdavUserCredentials.deleteMany({ userId })
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user credentials')
    }
  })

  WebdavModule = {
    router: WebdavRouter,
  }
  logger.debug({}, 'WebDAV module ready')
} else {
  logger.debug({}, 'WebDAV module disabled (WEBDAV_ENABLED is not true)')
}
export default WebdavModule
