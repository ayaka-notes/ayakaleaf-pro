// @ts-check
/**
 * Consumer for the `project-notification` Bull queue (CE).
 *
 * Upstream, jobs on this queue are consumed by the web
 * `app/src/infrastructure/QueueWorkers.mjs`, but that `start()`
 * early-returns unless the saas feature (`Settings.overleaf`) is on — which
 * it never is in CE — so in CE the queue has NO consumer and the
 * `projectModified` hook (→ `scheduleProjectChangeNotifications`) never
 * fires. The enqueue cron would push jobs that nothing ever drains.
 *
 * This module starts a worker for the same queue when the module router is
 * applied (web startup), but only when the saas feature is off, so it
 * complements — and never duplicates — QueueWorkers.
 *
 * It connects to the same redis the enqueue cron script uses:
 * `QUEUES_REDIS_*` with `REDIS_*` as fallback (both are `overleafredis`
 * in the compose stack).
 */

import Queue from 'bull'
import logger from '@overleaf/logger'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import Modules from '../../../../app/src/infrastructure/Modules.mjs'
import {
  addConnectionDrainer,
} from '../../../../app/src/infrastructure/GracefulShutdown.mjs'

export const QUEUE_NAME = 'project-notification'

/**
 * @returns {{host:string, port:number, password?:string}} redis options
 * in the same order the enqueue script's bull config resolves them.
 */
export function getQueueRedisConfig() {
  return {
    host: process.env.QUEUES_REDIS_HOST || process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(
      process.env.QUEUES_REDIS_PORT || process.env.REDIS_PORT || '6379',
      10
    ),
    password:
      process.env.QUEUES_REDIS_PASSWORD ||
      process.env.REDIS_PASSWORD ||
      undefined,
  }
}

let queueInstance = null

// Hard cap for a hook run inside the queue worker: a handler that never
// settles must not wedge the Bull job in "active" forever (observed: a
// never-resolving fire() left the job active indefinitely and — combined
// with jobId de-duplication — swallowed every later batch for the project).
// On timeout the job fails and Bull retries it (attempts/backoff), keeping
// the queue visible and re-drainable.
export const HOOK_TIMEOUT_MS = Number(
  process.env.PROJECT_NOTIFICATION_HOOK_TIMEOUT_MS
) || 30_000

export function fireHookWithTimeout(
  hookName,
  payload,
  timeoutMs = HOOK_TIMEOUT_MS,
  // injectable for tests (defaults to the web Modules hook runner)
  fire = Modules.promises.hooks.fire
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${hookName} hook timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const done = (settle) => {
      clearTimeout(timer)
      settle()
    }

    fire(hookName, payload).then(
      result => done(() => resolve(result)),
      err => done(() => reject(err))
    )
  })
}

/**
 * Start the consumer exactly once per process (idempotent).
 * Returns the bull queue, or null when it is not started
 * (saas build, tests, or already started).
 *
 * @returns {any|null}
 */
export function startProjectNotificationConsumer() {
  if (queueInstance) {
    return queueInstance
  }
  if (Features.hasFeature('saas')) {
    // saas/pro build: QueueWorkers owns the queue.
    return null
  }
  if (process.env.NODE_ENV === 'test') {
    return null
  }

  const redis = getQueueRedisConfig()
  const queue = new Queue(QUEUE_NAME, { redis })
  queueInstance = queue

  queue.process(async job => {
    const { projectId, timestamp, userId } = job.data
    await fireHookWithTimeout('projectModified', {
      projectId,
      timestamp,
      userId,
    })
  })

  queue.on('error', err => {
    logger.error(
      { err, queue: QUEUE_NAME },
      `project-notification consumer queue error`
    )
  })

  addConnectionDrainer(`queue consumer ${QUEUE_NAME}`, async () => {
    await queue.close()
  })

  logger.info(
    { queue: QUEUE_NAME, redis: `${redis.host}:${redis.port}` },
    'started CE consumer for the project-notification queue'
  )
  return queue
}
