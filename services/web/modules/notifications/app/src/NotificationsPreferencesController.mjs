// @ts-check

import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import * as Path from 'node:path'
import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import NotificationsPreferencesHandler from './NotificationsPreferencesHandler.mjs'
import { normalizeGlobalDelayMinutes } from './PreferenceNormalizer.mjs'
import { sendAppriseNotification } from './AppriseDispatcher.mjs'

// Server default grace delay (same env var as the enqueue script), used to
// show users what "leave empty" means on the preferences page.
const DEFAULT_DELAY_MS =
  Number(process.env.PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS) || 120000

function _formatDelayLabel(ms) {
  if (ms % 60000 === 0) return `${ms / 60000} minutes`
  if (ms % 1000 === 0) return `${ms / 1000} seconds`
  return `${ms} ms`
}

const globalPreferencesSchema = z.object({
  muteAllNotifications: z.boolean(),
  notificationDelayMinutes: z
    .number()
    .int()
    .min(1)
    .max(10080)
    .nullable()
    .optional(),
  // Apprise channel URL for this user (mailto://, tg://, discord://, ntfy://, …).
  // null = use the account email (default).
  notificationUrl: z.string().max(2000).nullable().optional(),
})

const projectPreferencesSchema = z.looseObject({})

// Form submission from /user/notification-preferences (form-encoded, not
// JSON): checkbox value present when checked, absent when unchecked.
const updateGlobalPreferencesFormSchema = z.object({
  body: z.looseObject({
    muteAllNotifications: z.string().optional(),
    notificationDelayMinutes: z.string().optional().nullable(),
    notificationUrl: z.string().optional().nullable(),
  }),
})

async function globalPreferencesPage(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await UserGetter.promises.getUser(userId, { email: 1 })
    const preferences = await NotificationsPreferencesHandler.promises.getGlobalPreferences(
      userId
    )
    res.render(
      Path.resolve(import.meta.dirname, '../views/user/notification-preferences'),
      {
        title: 'email_preferences',
        // The checkbox is an opt-IN ("Notifications on project activity")
        // while the stored flag is an opt-OUT (muteAllNotifications), so the
        // page renders the negated value.
        muteAllNotifications: preferences.muteAllNotifications,
        notificationsEnabled: !preferences.muteAllNotifications,
        notificationDelayMinutes: preferences.notificationDelayMinutes ?? null,
        notificationUrl: preferences.notificationUrl ?? null,
        userEmail: user?.email || '',
        defaultDelayLabel: _formatDelayLabel(DEFAULT_DELAY_MS),
      }
    )
  } catch (err) {
    next(err)
  }
}

async function getGlobalPreferences(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.getGlobalPreferences(
      userId
    )
    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function updateGlobalPreferences(req, res, next) {
  try {
    const { body } = parseReq(req, globalPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    await NotificationsPreferencesHandler.promises.saveGlobalPreferences(
      userId,
      body
    )

    res.json(body)
  } catch (err) {
    next(err)
  }
}

async function updateGlobalPreferencesFromForm(req, res, next) {
  try {
    const { body } = parseReq(req, updateGlobalPreferencesFormSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    // Empty field = "use server default" (null); otherwise a whole number
    // of minutes in 1..10080, else reject the whole save.
    let notificationDelayMinutes = null
    if (
      body.notificationDelayMinutes !== undefined &&
      body.notificationDelayMinutes !== ''
    ) {
      notificationDelayMinutes = normalizeGlobalDelayMinutes(
        body.notificationDelayMinutes
      )
      if (notificationDelayMinutes === null) {
        throw new Errors.InvalidError(
          'Notification delay must be a whole number of minutes between 1 and 10080'
        )
      }
    }

    const preferences = {
      // Opt-IN checkbox vs opt-OUT flag: checked => notifications on.
      muteAllNotifications: !body.muteAllNotifications,
      notificationDelayMinutes,
      notificationUrl:
        body.notificationUrl && String(body.notificationUrl).trim()
          ? String(body.notificationUrl).trim()
          : null,
    }

    await NotificationsPreferencesHandler.promises.saveGlobalPreferences(
      userId,
      preferences
    )

    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function getProjectPreferences(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.getProjectPreferences(
      userId,
      req.params.projectId
    )
    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function saveProjectPreferences(req, res, next) {
  try {
    const { body } = parseReq(req, projectPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    await NotificationsPreferencesHandler.promises.saveProjectPreferences(
      userId,
      req.params.projectId,
      body
    )

    res.json(null)
  } catch (err) {
    next(err)
  }
}

async function sendTestEmail(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await UserGetter.promises.getUser(userId, { email: 1 })

    if (!user || !user.email) {
      throw new Error('User email not found')
    }

    // Test the full Apprise dispatch path (stored URL or mailto fallback).
    await sendAppriseNotification({
      title: 'Overleaf test notification',
      body:
        'This is a test notification from Overleaf. If you received it, your notification channel is working.',
      userId,
      email: user.email,
    })

    res.json({ message: res.locals.translate('email_sent') })
  } catch (err) {
    logger.warn({ err, userId: req.session?.userId }, 'failed to send test notification')
    next(err)
  }
}

export default {
  globalPreferencesPage,
  getGlobalPreferences,
  updateGlobalPreferences,
  updateGlobalPreferencesFromForm,
  getProjectPreferences,
  saveProjectPreferences,
  sendTestEmail,
}
