import NotificationsPreferencesRouter from './app/src/NotificationsPreferencesRouter.mjs'
import { scheduleProjectChangeNotifications } from './app/src/ScheduleProjectChangeNotifications.mjs'
import { scheduleCommentNotifications } from './app/src/ScheduleProjectChangeNotifications.mjs'
import { scheduleEventNotification } from './app/src/ScheduleEventNotifications.mjs'

/**
 * Notifications module.
 *
 * Owns:
 * - the scheduled email-notification queue consumer (`ProcessNotifications.mjs`,
 *   also imported directly by `services/web/scripts/process_notifications.mjs`)
 * - per-project / global notification preference endpoints + the
 *   `/user/notification-preferences` page (`NotificationsPreferencesRouter.mjs`)
 * - the event schedulers (registry in `NotificationEvents.mjs`)
 *
 * Registered via `Settings.moduleImportSequence` ("notifications").
 */

/** @import { WebModule } from "../../types/web-module" */

// Thin adapters that normalise the raw hook arguments into the generic
// scheduler call. Kept here so index.mjs stays a flat hook map.
const ev = (key, map) => (...args) =>
  scheduleEventNotification(key, map(...args))

const NotificationsModule = {
  router: NotificationsPreferencesRouter,
  // IMPORTANT: native async handlers must go into `hooks.promises`.
  // The plain `hooks` map runs every handler through util.promisify(),
  // which treats them as callback-style functions — an async handler in
  // that map executes fine but its promise is ignored and the promisified
  // wrapper never settles, so `fire()` hangs forever. `promises` attaches
  // the handler as-is.
  hooks: {
    promises: {
      // ── bespoke (dedicated coalescing) ────────────────────────────
      projectModified: scheduleProjectChangeNotifications,
      chatMessageSent: scheduleCommentNotifications,

      // ── A: hooks that already fire ────────────────────────────────
      projectExpired: ev('projectExpiring', a => ({
        projectId:
          a && typeof a === 'object' ? a.projectId : a ? String(a) : null,
      })),
      deactivateProject: ev('projectArchived', a => ({
        projectId: a && typeof a === 'object' ? a.projectId : String(a),
      })),
      preDuplicateProject: ev('projectDuplicated', ({ originalProjectId, owner }) => ({
        projectId: originalProjectId ? String(originalProjectId) : null,
        actorId: owner ? String(owner) : null,
      })),
      userEmailChanged: ev('emailChanged', (user, email) => ({
        targetUserId: user?._id ? String(user._id) : null,
        context: { newEmail: email },
      })),

      // ── B: new hooks added in core ────────────────────────────────
      projectRestored: ev('projectRestored', a => ({
        projectId: String(a),
      })),
      projectRenamed: ev('projectRenamed', ({ projectId, actorId }) => ({
        projectId: projectId ? String(projectId) : null,
        actorId: actorId ? String(actorId) : null,
      })),
      projectDeleted: ev('projectDeleted', ({ projectId, memberIds = [] }) => ({
        // members are passed through; the scheduler resolves the project
        // for its own recipient list, and memberIds is a fallback.
        projectId: projectId ? String(projectId) : null,
        context: { memberIds },
      })),
      memberAdded: ev('memberAdded', ({ projectId, actorId, targetUserId }) => ({
        projectId: projectId ? String(projectId) : null,
        actorId: actorId ? String(actorId) : null,
        targetUserId: targetUserId ? String(targetUserId) : null,
      })),
      memberRemoved: ev('memberRemoved', ({ projectId, targetUserId }) => ({
        projectId: projectId ? String(projectId) : null,
        targetUserId: targetUserId ? String(targetUserId) : null,
      })),
      permissionsChanged: ev('permissionsChanged', ({ projectId, actorId, targetUserId }) => ({
        projectId: projectId ? String(projectId) : null,
        actorId: actorId ? String(actorId) : null,
        targetUserId: targetUserId ? String(targetUserId) : null,
      })),
      trackChangesToggled: ev('trackChangesToggled', ({ projectId, actorId }) => ({
        projectId: projectId ? String(projectId) : null,
        actorId: actorId ? String(actorId) : null,
      })),

      // ── C: security / account ─────────────────────────────────────
      passwordChanged: ev('passwordChanged', ({ targetUserId }) => ({
        targetUserId: targetUserId ? String(targetUserId) : null,
      })),
      userLoggedIn: ev('newLogin', ({ targetUserId, context }) => ({
        targetUserId: targetUserId ? String(targetUserId) : null,
        context: context || {},
      })),
    },
  },
}

export default NotificationsModule
