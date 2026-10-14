import Settings from '@overleaf/settings'
import Redis from 'ioredis'
import Redlock from 'redlock'

const redis = new Redis(Settings.redis.tpds)

// One queue per user: the jobs web enqueues (Overleaf → Dropbox) and the
// polls (Dropbox → Overleaf) run in order, one at a time. A job moves to the
// user's processing list while it runs, so that it survives a restart, and
// stays there until it succeeds or is dead-lettered. Jobs are pushed on the
// left and taken from the right.
const keys = {
  queue: userId => `web_to_tpds_http_requests:{${userId}}`,
  processing: userId => `web_to_tpds_http_requests:processing:{${userId}}`,
  deadLetter: userId => `web_to_tpds_http_requests:dead:{${userId}}`,
  // set while a poll is queued, so that webhook bursts queue a single poll
  pollPending: userId => `tpds_to_web_http_requests:{${userId}}`,
  lock: userId => `tpds:lock:{${userId}}`,
}

// Only guards against a second connector process: held while a user's jobs
// are drained
const LOCK_TTL = 60 * 1000
const redlock = new Redlock([redis], { retryCount: 0 })

async function push(userId, entry) {
  await redis.lpush(keys.queue(userId), JSON.stringify(entry))
}

// Returns false when a poll is already queued for the user
async function markPollPending(userId) {
  return (await redis.set(keys.pollPending(userId), '1', 'NX')) === 'OK'
}

async function clearPollPending(userId) {
  await redis.del(keys.pollPending(userId))
}

// The job running or waiting for a retry, else the next one
async function next(userId) {
  const raw =
    (await redis.lindex(keys.processing(userId), -1)) ??
    (await redis.rpoplpush(keys.queue(userId), keys.processing(userId)))
  return raw ? JSON.parse(raw) : null
}

async function done(userId) {
  await redis.del(keys.processing(userId))
}

async function retryLater(userId, entry) {
  await redis.lset(keys.processing(userId), -1, JSON.stringify(entry))
}

// Kept for inspection, capped to the most recent 100
async function deadLetter(userId, entry, err) {
  const key = keys.deadLetter(userId)
  await redis
    .multi()
    .lpush(
      key,
      JSON.stringify({ entry, error: String(err?.message || err), at: new Date() })
    )
    .ltrim(key, 0, 99)
    .del(keys.processing(userId))
    .exec()
}

async function clearUser(userId) {
  await redis.del(
    keys.queue(userId),
    keys.processing(userId),
    keys.pollPending(userId)
  )
}

async function getQueues(userId) {
  const [webToTpds, processing, pollPending] = await Promise.all([
    redis.llen(keys.queue(userId)),
    redis.llen(keys.processing(userId)),
    redis.exists(keys.pollPending(userId)),
  ])
  return { tpdsToWeb: pollPending, webToTpds: webToTpds + processing }
}

async function usersWithWork() {
  const userIds = new Set()
  for (const pattern of [keys.queue('*'), keys.processing('*')]) {
    let cursor = '0'
    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      for (const key of batch) {
        userIds.add(key.slice(key.lastIndexOf('{') + 1, -1))
      }
    } while (cursor !== '0')
  }
  return [...userIds]
}

// Runs fn under the user's lock, renewed while fn runs, or returns false when
// another process holds it
async function withUserLock(userId, fn) {
  let lock
  try {
    lock = await redlock.lock(keys.lock(userId), LOCK_TTL)
  } catch (err) {
    if (err instanceof Redlock.LockError) {
      return false
    }
    throw err
  }
  const renew = setInterval(() => {
    lock.extend(LOCK_TTL).then(
      extended => {
        lock = extended
      },
      () => {}
    )
  }, LOCK_TTL / 3)
  try {
    await fn()
  } finally {
    clearInterval(renew)
    await lock.unlock().catch(() => {})
  }
  return true
}

export default {
  redis,
  keys,
  LOCK_TTL,
  push,
  markPollPending,
  clearPollPending,
  next,
  done,
  retryLater,
  deadLetter,
  clearUser,
  getQueues,
  usersWithWork,
  withUserLock,
}
