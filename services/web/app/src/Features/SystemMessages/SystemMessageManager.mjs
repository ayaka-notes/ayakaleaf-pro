import { SystemMessage } from '../../models/SystemMessage.mjs'
import { addRequiredCleanupHandlerBeforeDrainingConnections } from '../../infrastructure/GracefulShutdown.mjs'
import { callbackifyAll } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import RedisWrapper from '../../infrastructure/RedisWrapper.mjs'
import Settings from '@overleaf/settings'
import redis from '@overleaf/redis-wrapper'
import OError from '@overleaf/o-error'

const PUB_SUB_CHANNEL_TRIGGER_REFRESH = 'refresh-system-messages'

const SystemMessageManager = {
  _cachedMessages: [],

  getMessages() {
    return this._cachedMessages
  },

  async getMessagesFromDB() {
    return await SystemMessage.find({}).exec()
  },

  // #17b: server-side surface filtering for classic (non-React) pages such
  // as /login and /register. Mirrors the frontend pure helper
  // (frontend/js/shared/components/system-message-surface.ts,
  // messageVisibleForSurface): a legacy message (no placements) is visible
  // everywhere; a scoped message is only visible on its listed surfaces.
  // `surface === 'auth'` also surfaces the site-closed "protected" notice,
  // so admins see it where they would log in (the /system/messages endpoint
  // adds it only for logged-in users).
  async getMessagesForSurface(surface) {
    const cached = this.getMessages()
    let messages =
      cached && cached.length > 0
        ? cached
        : ((await SystemMessage.find({}).exec()) || [])

    if (surface === 'auth' && !Settings.siteIsOpen) {
      messages = [
        {
          _id: 'protected',
          content:
            'SITE IS CLOSED TO PUBLIC. OPEN ONLY FOR SITE ADMINS. DO NOT EDIT PROJECTS.',
        },
        ...messages,
      ]
    }

    return messages.filter(message => {
      const placements = message.placements
      if (!placements || placements.length === 0) return true
      if (surface === 'app') return false
      return placements.includes(surface)
    })
  },

  async clearMessages() {
    await SystemMessage.deleteMany({}).exec()
    await SystemMessageManager.notifyOtherPods()
    await this.refreshCache()
  },

  // #17b (port from go experimental branch): messages may carry
  // per-surface placements; an empty list means "visible everywhere".
  // #17d: `unremovable` hides the banner's dismiss (X) button.
  async createMessage(content, placements, unremovable = false) {
    const message = new SystemMessage({
      content,
      placements: placements ?? [],
      unremovable: !!unremovable,
    })
    await message.save()
    await SystemMessageManager.notifyOtherPods()
    await this.refreshCache()
  },

  // #17b: update where an existing message is shown.
  async updateMessagePlacements(messageId, placements) {
    const message = await SystemMessage.findByIdAndUpdate(
      messageId,
      { placements: placements ?? [] },
      { new: true }
    ).exec()
    if (!message) {
      throw new OError('System message not found', { statusCode: 404 })
    }
    await SystemMessageManager.notifyOtherPods()
    await this.refreshCache()
    return message
  },

  // #17d: toggle whether users may dismiss the banner (hide the X).
  async setMessageUnremovable(messageId, unremovable) {
    const message = await SystemMessage.findByIdAndUpdate(
      messageId,
      { unremovable: !!unremovable },
      { new: true }
    ).exec()
    if (!message) {
      throw new OError('System message not found', { statusCode: 404 })
    }
    await SystemMessageManager.notifyOtherPods()
    await this.refreshCache()
    return message
  },

  // #17c: delete a single message (beyond "clear all").
  async deleteMessage(messageId) {
    const message = await SystemMessage.findByIdAndDelete(messageId).exec()
    if (!message) {
      throw new OError('System message not found', { statusCode: 404 })
    }
    await SystemMessageManager.notifyOtherPods()
    await this.refreshCache()
  },

  async notifyOtherPods() {
    if (!Settings.notifyOnSystemMessageChanges) return
    const redisFeatureSettings = Settings.redis.pubsub || Settings.redis.web
    const rclient = redis.createClient(redisFeatureSettings)
    try {
      await rclient.publish(PUB_SUB_CHANNEL_TRIGGER_REFRESH, '')
    } finally {
      try {
        await rclient.disconnect()
      } catch (err) {
        logger.err({ err }, 'failed to disconnect pub/sub redis client')
      }
    }
  },

  async refreshCache() {
    this._cachedMessages = await this.getMessagesFromDB()
  },

  refreshCacheInBackground() {
    this.refreshCache().catch(err => {
      logger.warn({ err }, 'failed to refresh system messages cache')
    })
  },
}

const CACHE_TIMEOUT = 10 * 1000 * (Math.random() + 2) // 20-30 seconds
SystemMessageManager.refreshCacheInBackground()
const intervalHandle = setInterval(
  () => SystemMessageManager.refreshCacheInBackground(),
  CACHE_TIMEOUT
)

addRequiredCleanupHandlerBeforeDrainingConnections(
  'update system messages',
  () => {
    clearInterval(intervalHandle)
  }
)

if (Settings.notifyOnSystemMessageChanges) {
  const pubSubClient = RedisWrapper.client('pubsub')
  pubSubClient.subscribe(PUB_SUB_CHANNEL_TRIGGER_REFRESH).catch(err => {
    logger.error(
      { err },
      'falling back to background refresh for system messages'
    )
  })
  pubSubClient.on('message', () =>
    SystemMessageManager.refreshCacheInBackground()
  )
  addRequiredCleanupHandlerBeforeDrainingConnections(
    `pub-sub ${PUB_SUB_CHANNEL_TRIGGER_REFRESH}`,
    () => pubSubClient.unsubscribe(PUB_SUB_CHANNEL_TRIGGER_REFRESH)
  )
}

export default {
  getMessages: SystemMessageManager.getMessages.bind(SystemMessageManager),
  ...callbackifyAll(SystemMessageManager, { without: ['getMessages'] }),
  promises: SystemMessageManager,
}
