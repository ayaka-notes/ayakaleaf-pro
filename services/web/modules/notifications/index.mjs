import NotificationsPreferencesRouter from './app/src/NotificationsPreferencesRouter.mjs'
import { scheduleProjectChangeNotifications } from './app/src/ScheduleProjectChangeNotifications.mjs'

/**
 * Notifications module.
 *
 * Owns:
 * - the scheduled email-notification queue consumer (`ProcessNotifications.mjs`,
 *   also imported directly by `services/web/scripts/process_notifications.mjs`)
 * - per-project / global notification preference endpoints + the
 *   `/user/notification-preferences` page (`NotificationsPreferencesRouter.mjs`)
 * - the `projectModified` queue hook that schedules project-change emails
 *
 * Registered via `Settings.moduleImportSequence` ("notifications").
 */

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const NotificationsModule = {
  router: NotificationsPreferencesRouter,
  // IMPORTANT: native async handlers must go into `hooks.promises`.
  // The plain `hooks` map runs every handler through util.promisify(),
  // which treats them as callback-style functions — an async handler in
  // that map executes fine but its promise is ignored and the promisified
  // wrapper never settles, so `fire()` hangs forever (observed: Bull job
  // stuck active, next batch for the same project swallowed by jobId
  // dedup). `promises` attaches the handler as-is.
  hooks: {
    promises: {
      projectModified: scheduleProjectChangeNotifications,
    },
  },
}

export default NotificationsModule
