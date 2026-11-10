import { allEventKeys } from './NotificationEvents.mjs'

function _defaultProjectPreferences() {
  return {
    commentOnOwnProject: true,
    commentOnInvitedProject: true,
    repliesOnAuthoredThread: true,
    repliesOnParticipatingThread: true,
    commentResolvedOnAuthoredThread: true,
    commentResolvedOnParticipatingThread: true,
    commentReopenedOnAuthoredThread: true,
    commentReopenedOnParticipatingThread: true,
    trackedChangesOnOwnProject: true,
    trackedChangesOnInvitedProject: true,
    trackChangesAcceptedOnAuthoredChange: true,
    trackChangesRejectedOnAuthoredChange: true,
  }
}

function normalizeProjectPreferences(preferences) {
  const defaults = _defaultProjectPreferences()
  const normalized = {}
  for (const [key, defaultValue] of Object.entries(defaults)) {
    normalized[key] = preferences[key] === undefined
      ? defaultValue
      : Boolean(preferences[key])
  }
  return normalized
}

function normalizeGlobalPreferences(preferences) {
  return {
    muteAllNotifications: Boolean(preferences?.muteAllNotifications),
    notificationDelayMinutes: normalizeGlobalDelayMinutes(
      preferences?.notificationDelayMinutes
    ),
    notificationUrl: normalizeNotificationUrl(preferences?.notificationUrl),
    events: normalizeGlobalEvents(preferences?.events),
  }
}

/**
 * Global event switches: which kinds of events may generate a
 * notification at all. Per-project granularity (own/invited, comment vs
 * tracked changes, …) lives in the project preferences; these are the
 * master switches. All default to ON so existing behaviour is preserved.
 * Keys come from the event registry (NotificationEvents.mjs).
 */
export const GLOBAL_EVENT_KEYS = allEventKeys()

export function normalizeGlobalEvents(events) {
  const normalized = {}
  for (const key of GLOBAL_EVENT_KEYS) {
    normalized[key] =
      events?.[key] === undefined ? true : Boolean(events[key])
  }
  return normalized
}

/**
 * The recipient's Apprise channel URL (mailto://, tg://, discord://, ntfy://,
 * …). `null` = not set; dispatch then falls back to the account email.
 */
export const NOTIFICATION_URL_MAX_LENGTH = 2000

function normalizeNotificationUrl(value) {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  if (!str) return null
  if (str.length > NOTIFICATION_URL_MAX_LENGTH) return null
  return str
}

/**
 * User-defined grace delay for project-change emails, in whole minutes.
 * `null` = not set (server default applies).
 */
export const GLOBAL_DELAY_MINUTES_MIN = 1
export const GLOBAL_DELAY_MINUTES_MAX = 10080 // 7 days

function normalizeGlobalDelayMinutes(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const n = Number(value)
  if (
    !Number.isInteger(n) ||
    n < GLOBAL_DELAY_MINUTES_MIN ||
    n > GLOBAL_DELAY_MINUTES_MAX
  ) {
    return null
  }
  return n
}

export {
  _defaultProjectPreferences,
  normalizeProjectPreferences,
  normalizeGlobalPreferences,
  normalizeGlobalDelayMinutes,
  normalizeNotificationUrl,
}
