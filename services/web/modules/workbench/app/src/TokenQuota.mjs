import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'

/**
 * Tracks per-user AI token usage in Redis and enforces the configured quota.
 * Keys include the UTC calendar month or week, allowing quotas to reset
 * without a scheduled job; old counters expire through their TTL.
 *
 * Requests are checked before streaming and charged using the model's reported
 * usage afterward. A request can exceed the quota; later requests are blocked.
 */

// Period keys handle quota resets; this TTL only removes old counters.
const WINDOW_TTL_SECONDS = 40 * 24 * 3600

let _limiter = null

function getQuota() {
  return Settings.workbenchAi?.tokenQuota || 0
}

export function isQuotaEnabled() {
  return getQuota() > 0
}

function getLimiter() {
  if (!_limiter) {
    _limiter = new RateLimiter('ai-workbench-tokens', {
      // Keep usage visible when no token limit is configured.
      points: getQuota() > 0 ? getQuota() : Number.MAX_SAFE_INTEGER,
      duration: WINDOW_TTL_SECONDS,
    })
  }
  return _limiter
}

function getPeriod() {
  return Settings.workbenchAi?.tokenQuotaPeriod === 'week' ? 'week' : 'month'
}

/** Midnight UTC of the current week's Monday. */
function currentWeekStart(now) {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday
  )
}

function periodKey(userId) {
  const now = new Date()
  if (getPeriod() === 'week') {
    const monday = new Date(currentWeekStart(now))
    return `${userId}:w${monday.toISOString().slice(0, 10)}`
  }
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${userId}:${now.getUTCFullYear()}-${month}`
}

/**
 * Seconds until the period rolls over (UTC): the 1st of next month, or next
 * Monday 00:00 — the Token-RateLimit-Reset value.
 */
export function secondsUntilReset() {
  const now = new Date()
  const next =
    getPeriod() === 'week'
      ? currentWeekStart(now) + 7 * 24 * 3600 * 1000
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

/** Remaining tokens for the current quota period, never below zero. */
export async function getRemainingTokens(userId) {
  const res = await getLimiter()._rateLimiter.get(periodKey(userId))
  const consumed = res?.consumedPoints || 0
  return Math.max(0, getQuota() - consumed)
}

export async function resetTokenUsage(userId) {
  await getLimiter().delete(periodKey(userId))
}

export async function getTokenUsage(userId) {
  const usage = await getLimiter()._rateLimiter.get(periodKey(userId))
  return { used: usage?.consumedPoints || 0, limit: isQuotaEnabled() ? getQuota() : null }
}

/** Record the model-reported tokens for the user's current quota period. */
export async function recordTokenUsage(userId, tokens) {
  if (!tokens || tokens <= 0) return
  try {
    await getLimiter().consume(periodKey(userId), Math.ceil(tokens), {
      method: 'userId',
    })
  } catch (err) {
    if (err instanceof Error) {
      logger.warn({ err, userId }, 'ai token quota: failed to record usage')
    }
    // A quota-exceeded result still records usage; later requests check the balance.
  }
}

export default {
  isQuotaEnabled,
  secondsUntilReset,
  getRemainingTokens,
  recordTokenUsage,
  resetTokenUsage,
  getTokenUsage,
}
