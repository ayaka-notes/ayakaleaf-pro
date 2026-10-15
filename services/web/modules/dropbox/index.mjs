import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import express from 'express'
import Modules from '../../app/src/infrastructure/Modules.mjs'

let DropboxModule = {}
if (process.env.DROPBOX_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling Dropbox module')

  const siteUrl = Settings.siteUrl.replace(/\/+$/, '')

  // Same Dropbox app as the third-party-datastore service, which does the
  // file sync. `domain` is the dropbox SDK option, for testing against a mock.
  Settings.dropbox = {
    appKey: process.env.DROPBOX_APP_KEY,
    appSecret: process.env.DROPBOX_APP_SECRET,
    callbackURL: `${siteUrl}/user/dropbox/oauth/callback`,
    domain: process.env.DROPBOX_API_DOMAIN,
  }

  // Import lazily so these modules are only evaluated when Dropbox is enabled.
  // DropboxHandler builds an AccessTokenEncryptor at import time (requiring
  // DROPBOX_TOKEN_CIPHER_PASSWORD)
  const [{ default: DropboxRouter }, { default: DropboxHandler }] =
    await Promise.all([
      import('./app/src/DropboxRouter.mjs'),
      import('./app/src/DropboxHandler.mjs'),
    ])

  // web fires 'removeDropbox' when the user may not use Dropbox any more
  // (features lost, account suspended, duplicate project names)
  Modules.hooks.attach('removeDropbox', async (userId, reason) => {
    try {
      await DropboxHandler.unlinkUser(userId)
      logger.debug({ userId, reason }, 'unlinked Dropbox account')
    } catch (err) {
      logger.warn({ userId, reason, err }, 'failed to unlink Dropbox account')
    }
  })

  // Only once the project is purged: a deleted project can still be restored,
  // and keeps its folder
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await DropboxHandler.removeProjectState(projectId)
    } catch (err) {
      logger.warn({ projectId, err }, 'on project expire: failed removing Dropbox state')
    }
  })

  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await DropboxHandler.removeUserState(userId)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing Dropbox state')
    }
  })

  DropboxModule = {
    router: DropboxRouter,
    // Dropbox signs the webhook body: keep it raw, before the app's JSON parser
    appMiddleware(app) {
      app.use('/dropbox/webhook', express.raw({ type: () => true, limit: '1mb' }))
    },
  }
}

export default DropboxModule
