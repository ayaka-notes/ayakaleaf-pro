import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import pLimit from 'p-limit'
import { fetchNothing } from '@overleaf/fetch-utils'
import QueueManager from './QueueManager.mjs'
import JobProcessor from './JobProcessor.mjs'
import DropboxClient from './DropboxClient.mjs'
import StateManager from './StateManager.mjs'
import { db, ObjectId } from './mongodb.mjs'
import { classify, Action } from './Errors.mjs'

const { concurrency, pollIntervalMs, maxAttempts } = Settings.queue
const RETRY_BASE_MS = 5 * 1000
const RETRY_MAX_MS = 10 * 60 * 1000

// A notification in the project list says why, until the user links Dropbox
// again: the web module removes it by its key then
const UNLINKED_NOTIFICATION_KEY = 'dropbox-unlinked'
const UNLINKED_TEMPLATE_KEYS = {
  access_denied: 'dropbox_unlinked_because_access_denied',
  insufficient_space: 'dropbox_unlinked_because_full',
  user_suspended: 'dropbox_unlinked_because_suspended',
}

// The account cannot be used any more: unlink it like the web module does,
// and drop the pending jobs. The user relinks from the settings.
async function unlinkUser(userId, accountId, reason, err) {
  logger.warn({ err, userId, reason }, 'tpds: unlinking dropbox account')
  await db.users.updateOne(
    { _id: new ObjectId(userId), 'dropbox.access_token.uid': accountId },
    { $unset: { dropbox: 1 } }
  )
  await StateManager.removeUserState(userId)
  await QueueManager.clearUser(userId)
  DropboxClient.forget(userId)
  // as web's NotificationsHandler.createNotification
  await fetchNothing(`${Settings.apis.notifications.url}/user/${userId}`, {
    method: 'POST',
    json: {
      key: UNLINKED_NOTIFICATION_KEY,
      templateKey: UNLINKED_TEMPLATE_KEYS[reason],
      messageOpts: {},
      forceCreate: true,
    },
  }).catch(err =>
    logger.warn({ err, userId }, 'tpds: failed to notify the unlinked user')
  )
}

// Returns false to stop draining the user until a retry is due
async function runNextJob(userId) {
  const entry = await QueueManager.next(userId)
  if (!entry) {
    return false
  }
  if (entry.retryAt > Date.now()) {
    return false
  }
  try {
    await JobProcessor.processJob(entry.job)
    await QueueManager.done(userId)
    return true
  } catch (err) {
    const { action, reason, retryAfterMs } = classify(err)
    const attempts = (entry.attempts || 0) + 1
    const log = { err, userId, uri: entry.job?.uri, attempts }
    if (action === Action.RETRY && attempts < maxAttempts) {
      // stays first in the queue: later jobs wait, so that order is kept
      entry.attempts = attempts
      entry.retryAt =
        Date.now() +
        (retryAfterMs ?? Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS))
      await QueueManager.retryLater(userId, entry)
      logger.warn(log, 'tpds: job failed, will retry')
      return false
    }
    if (action === Action.UNLINK) {
      const { uid } =
        (await db.users.findOne(
          { _id: new ObjectId(userId) },
          { projection: { 'dropbox.access_token.uid': 1 } }
        ))?.dropbox?.access_token || {}
      await unlinkUser(userId, uid, reason, err)
      return false
    }
    if (action === Action.SKIP) {
      logger.warn({ ...log, reason }, 'tpds: job skipped')
      await QueueManager.done(userId)
      return true
    }
    await QueueManager.deadLetter(userId, entry, err)
    logger.error({ ...log, reason }, 'tpds: job dead-lettered')
    metrics.inc('tpds.dead-letter')
    return true
  }
}

async function drainUser(userId) {
  await QueueManager.withUserLock(userId, async () => {
    while (await runNextJob(userId)) {}
  })
}

let running = false

// A tick starts the users that are not being drained yet and does not wait
// for them, so a slow Dropbox request only holds up its own user
const limit = pLimit(concurrency)
const draining = new Set()

async function tick() {
  for (const userId of await QueueManager.usersWithWork()) {
    if (draining.has(userId)) {
      continue
    }
    draining.add(userId)
    limit(() => drainUser(userId))
      .catch(err =>
        logger.error({ err, userId }, 'tpds: failed to drain user queue')
      )
      .finally(() => draining.delete(userId))
  }
}

function start() {
  running = true
  const loop = async () => {
    try {
      await tick()
    } catch (err) {
      logger.error({ err }, 'tpds: queue worker tick failed')
    }
    if (running) {
      setTimeout(loop, pollIntervalMs)
    }
  }
  loop()
}

function stop() {
  running = false
}

export default { start, stop }
