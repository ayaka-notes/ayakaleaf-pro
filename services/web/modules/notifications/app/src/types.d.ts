/**
 * Project-scope notification preferences.
 *
 * One document per (user, project) in the `notificationsPreferences`
 * collection (see migration 20251110151140). The values map 1:1 to the
 * radio levels in `project-notifications-setting.tsx`:
 * - "all"     -> all keys true
 * - "replies" -> replies/reopened/resolved/authored keys true, others false
 * - "off"     -> all keys false
 */
export type NotificationPreferencesSchema = {
  commentOnOwnProject: boolean
  commentOnInvitedProject: boolean
  repliesOnAuthoredThread: boolean
  repliesOnParticipatingThread: boolean
  commentResolvedOnAuthoredThread: boolean
  commentResolvedOnParticipatingThread: boolean
  commentReopenedOnAuthoredThread: boolean
  commentReopenedOnParticipatingThread: boolean
  trackedChangesOnOwnProject: boolean
  trackedChangesOnInvitedProject: boolean
  trackChangesAcceptedOnAuthoredChange: boolean
  trackChangesRejectedOnAuthoredChange: boolean
}

/**
 * Shape of the project GET response
 * (`GET /notifications/preferences/project/:projectId`).
 *
 * Note despite the name, this is the *combined* view consumed by
 * `use-project-notification-preferences.ts`: the 12 project preference keys
 * plus the global `muteAllNotifications` flag merged in by
 * `NotificationsPreferencesHandler.getProjectPreferences`.
 */
export type GlobalNotificationPreferencesSchema = {
  muteAllNotifications: boolean
  commentOnOwnProject: boolean
  commentOnInvitedProject: boolean
  repliesOnAuthoredThread: boolean
  repliesOnParticipatingThread: boolean
  commentResolvedOnAuthoredThread: boolean
  commentResolvedOnParticipatingThread: boolean
  commentReopenedOnAuthoredThread: boolean
  commentReopenedOnParticipatingThread: boolean
  trackedChangesOnOwnProject: boolean
  trackedChangesOnInvitedProject: boolean
  trackChangesAcceptedOnAuthoredChange: boolean
  trackChangesRejectedOnAuthoredChange: boolean
}
