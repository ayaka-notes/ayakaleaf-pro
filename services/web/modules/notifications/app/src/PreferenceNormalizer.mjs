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
  }
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
