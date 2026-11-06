// @ts-check
/**
 * Apprise dispatch adapter.
 *
 * Replaces the direct EmailHandler transport: every notification is sent
 * through the Apprise REST API (caronc/apprise, container `apprise` in the
 * compose stack), which supports 100+ channels — SMTP mail (default),
 * Telegram, Discord, Slack, ntfy, Pushover, … A single Apprise URL per
 * recipient selects the channel:
 *
 *   mailto://jane@example.com            (SMTP defaults come from the
 *                                          apprise container env; any part
 *                                          can be overridden in the URL)
 *   tg://bot-token/chat-id?base=https://...
 *   discord://webhook/id?token=...
 *   ntfy://host/topic
 *
 * Recipient URL resolution:
 *   1. the user's global preference `notificationUrl` (set on
 *      /user/notification-preferences or the admin page),
 *   2. fallback: mailto://<user email>.
 */

import logger from '@overleaf/logger'
import { db, ObjectId, connectionPromise } from '../../../../app/src/infrastructure/mongodb.mjs'

export const APPRISDE_API_URL = (
  process.env.NOTIFICATIONS_APPRISDE_API_URL || 'http://127.0.0.1:8001'
).replace(/\/+$/, '')

const REQUEST_TIMEOUT_MS =
  Number(process.env.NOTIFICATIONS_APPRISDE_TIMEOUT_MS) || 60000

/**
 * Resolve the Apprise URL for a recipient.
 * @param {string|null} userId
 * @param {string|null} email
 * @returns {Promise<string|null>}
 */
export async function resolveRecipientUrl(userId, email) {
  if (userId) {
    try {
      const doc = await db.notificationsPreferences.findOne(
        { user_id: new ObjectId(userId), project_id: null },
        { projection: { _id: 0, notificationUrl: 1 } }
      )
      if (doc && typeof doc.notificationUrl === 'string' && doc.notificationUrl.trim()) {
        return doc.notificationUrl.trim()
      }
    } catch (err) {
      logger.warn({ err, userId }, 'could not load notificationUrl preference')
    }
  }

  if (email) {
    // apprise (>= 2 / 1.13-2026 builds) wants the double-slash mailto form;
    // the apprise-api container accepts both and applies the SMTP defaults.
    return `mailto://${email}`
  }

  return null
}

/**
 * Send one notification through the Apprise API.
 * Throws on any dispatch failure (the queue processor then applies its
 * backoff / dead-letter logic).
 *
 * @param {{title:string, body:string, format?:string, userId?:string|null, email?:string|null, url?:string|null}} task
 */
export async function sendAppriseNotification({
  title,
  body,
  format = 'markdown',
  userId = null,
  email = null,
  url = null,
}) {
  await connectionPromise

  const target = url || (await resolveRecipientUrl(userId, email))
  if (!target) {
    throw new Error(
      'no notification channel for recipient (no email and no notificationUrl preference)'
    )
  }

  let response
  try {
    response = await fetch(`${APPRISDE_API_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target, title, body, format }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(`apprise API unreachable at ${APPRISDE_API_URL}: ${err?.message || err}`)
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`apprise API responded ${response.status}`)
  }
  if (data.status !== 1) {
    throw new Error(data.message || 'apprise reported a dispatch failure')
  }

  logger.info(
    { scheme: String(target).split(':')[0] },
    'notification dispatched via apprise'
  )
  return data
}
