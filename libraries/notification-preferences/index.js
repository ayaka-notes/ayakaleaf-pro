/**
 * Shared contract for Overleaf notification preferences.
 *
 * Used by BOTH the web `modules/notifications` module and the chat service,
 * so that the schema + normalization stay in one place.
 *
 * Storage (single collection `notificationsPreferences`):
 * - per project: { user_id, project_id, <NotificationPreferencesSchema> }
 * - global:      { user_id, project_id: null, muteAllNotifications }
 */

// The 12 per-project preference keys (order does not matter; membership does).
export const PROJECT_PREFERENCE_KEYS = [
  'commentOnOwnProject',
  'commentOnInvitedProject',
  'repliesOnAuthoredThread',
  'repliesOnParticipatingThread',
  'commentResolvedOnAuthoredThread',
  'commentResolvedOnParticipatingThread',
  'commentReopenedOnAuthoredThread',
  'commentReopenedOnParticipatingThread',
  'trackedChangesOnOwnProject',
  'trackedChangesOnInvitedProject',
  'trackChangesAcceptedOnAuthoredChange',
  'trackChangesRejectedOnAuthoredChange',
]

export function defaultProjectPreferences() {
  return PROJECT_PREFERENCE_KEYS.reduce((acc, key) => {
    acc[key] = true
    return acc
  }, {})
}

export function normalizeProjectPreferences(preferences = {}) {
  const normalized = {}
  for (const key of PROJECT_PREFERENCE_KEYS) {
    normalized[key] =
      preferences[key] === undefined
        ? true
        : Boolean(preferences[key])
  }
  return normalized
}

export function normalizeGlobalPreferences(preferences = {}) {
  return {
    muteAllNotifications: Boolean(preferences.muteAllNotifications),
    notificationDelayMinutes: normalizeGlobalDelayMinutes(
      preferences.notificationDelayMinutes
    ),
  }
}

/**
 * User-defined grace delay for project-change emails, in whole minutes.
 *
 * Returns `null` (meaning: not set -> the server default
 * `PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS` applies) for missing/empty/invalid
 * input, or the number of minutes (clamped to 1..7 days) when valid.
 */
export const GLOBAL_DELAY_MINUTES_MIN = 1
export const GLOBAL_DELAY_MINUTES_MAX = 10080 // 7 days

export function normalizeGlobalDelayMinutes(value) {
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
