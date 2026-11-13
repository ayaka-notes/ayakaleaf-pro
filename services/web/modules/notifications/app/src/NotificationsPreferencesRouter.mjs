// @ts-check

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import NotificationsPreferencesController from './NotificationsPreferencesController.mjs'
import { startProjectNotificationConsumer } from './ProjectNotificationQueueConsumer.mjs'
import * as Path from 'node:path'

function apply(webRouter, privateApiRouter, publicApiRouter) {
  const auth = AuthenticationController.requireLogin()

  // Service worker for browser push (scope: site root). Must be reachable
  // without a session (browsers fetch service workers anonymously).
  AuthenticationController.addEndpointToLoginWhitelist('/sw.js')
  webRouter.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript')
    res.setHeader('Service-Worker-Allowed', '/')
    res.sendFile(Path.resolve(import.meta.dirname, '../../app/sw.js'))
  })

  // Global ("mute all") preferences — used by /user/notification-preferences
  webRouter.get(
    '/notifications/preferences',
    auth,
    NotificationsPreferencesController.getGlobalPreferences
  )

  webRouter.post(
    '/notifications/preferences',
    auth,
    NotificationsPreferencesController.updateGlobalPreferences
  )

  // Project-level preferences (frontend hook contract:
  // use-project-notification-preferences.ts)
  webRouter.get(
    '/notifications/preferences/project/:projectId',
    auth,
    NotificationsPreferencesController.getProjectPreferences
  )

  webRouter.post(
    '/notifications/preferences/project/:projectId',
    auth,
    NotificationsPreferencesController.saveProjectPreferences
  )

  // Settings page (linked from live upstream: /user/settings "Email
  // preferences" and the project settings modal "Manage notifications
  // across all your projects")
  webRouter.get(
    '/user/notification-preferences',
    auth,
    NotificationsPreferencesController.globalPreferencesPage
  )

  webRouter.post(
    '/user/notification-preferences',
    auth,
    NotificationsPreferencesController.updateGlobalPreferencesFromForm
  )

  webRouter.post(
    '/user/send-test-email',
    auth,
    NotificationsPreferencesController.sendTestEmail
  )

  // Channel configuration (structured per-channel settings)
  webRouter.post(
    '/user/notification-preferences/channels',
    auth,
    NotificationsPreferencesController.saveChannelConfiguration
  )

  webRouter.post(
    '/user/notification-preferences/test-channel',
    auth,
    NotificationsPreferencesController.sendTestChannel
  )

  // Browser push (Web Push / VAPID)
  webRouter.post(
    '/user/notification-preferences/subscribe',
    auth,
    NotificationsPreferencesController.savePushSubscription
  )
  webRouter.delete(
    '/user/notification-preferences/subscribe',
    auth,
    NotificationsPreferencesController.deletePushSubscription
  )

  // CE: the QueueWorkers consumer is saas-gated and never runs in CE
  // (Settings.overleaf undefined), so own the `project-notification`
  // worker here. No-op when the saas feature is enabled (or in tests).
  startProjectNotificationConsumer()
}

export default {
  apply,
}
