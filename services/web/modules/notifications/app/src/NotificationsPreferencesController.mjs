// @ts-check

import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import * as Path from 'node:path'
import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import NotificationsPreferencesHandler from './NotificationsPreferencesHandler.mjs'
import { normalizeGlobalDelayMinutes } from './PreferenceNormalizer.mjs'
import { sendAppriseNotification, appriseConfigured } from './AppriseDispatcher.mjs'
import { buildChannelUrl, getChannel, CATALOG_ORDER } from './ChannelCatalog.mjs'

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
  // Global event switches (which kinds of events may notify at all).
  events: z
    .looseObject({
      projectChanges: z.boolean().optional(),
      comments: z.boolean().optional(),
    })
    .optional(),
})

const projectPreferencesSchema = z.looseObject({})

// Form submission from /user/notification-preferences (form-encoded, not
// JSON): checkbox value present when checked, absent when unchecked.
const updateGlobalPreferencesFormSchema = z.object({
  body: z.looseObject({
    muteAllNotifications: z.string().optional(),
    notificationDelayMinutes: z.string().optional().nullable(),
    notificationUrl: z.string().optional().nullable(),
    // event checkboxes (present = on, absent = off)
    eventProjectChanges: z.string().optional(),
    eventComments: z.string().optional(),
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
        // Events + channels for the settings page
        events: preferences.events || { projectChanges: true, comments: true },
        channelConfiguration: await NotificationsPreferencesHandler.promises
          .getChannelConfiguration(userId),
        channelOrder: CATALOG_ORDER,
        channelFields: Object.fromEntries(
          CATALOG_ORDER.map(type => [type, getChannel(type).fields])
        ),
        vapidPublicKey: await _getVapidPublicKey(),
        appriseConfigured: appriseConfigured(),
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
    preferences.appriseConfigured = appriseConfigured()
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
      // Event switches: checkbox present => enabled, absent => disabled.
      events: {
        projectChanges: body.eventProjectChanges !== undefined,
        comments: body.eventComments !== undefined,
      },
    }

    await NotificationsPreferencesHandler.promises.saveGlobalPreferences(
      userId,
      preferences
    )

    // Channel card values from the same form: chval_<type>_<key> inputs +
    // the activeChannel radio. Only non-empty values are sent.
    const channelValues = {}
    for (const [key, value] of Object.entries(body)) {
      if (!key.startsWith('chval_')) continue
      const [type, ...fieldParts] = key.slice('chval_'.length).split('_')
      if (!type || fieldParts.length === 0) continue
      const str = value === null ? '' : String(value).trim()
      if (!str) continue
      channelValues[type] = channelValues[type] || {}
      channelValues[type][fieldParts.join('_')] = str
    }
    const activeChannel = body.activeChannel || null
    if (Object.keys(channelValues).length > 0 || activeChannel) {
      await NotificationsPreferencesHandler.promises.saveChannelConfiguration(
        userId,
        { channels: channelValues, activeChannel }
      )
    }

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

// VAPID public key for the browser-push settings card. Overleaf owns the
// keys (generated once, persisted in `notificationSettings`) so browser
// push works without the Apprise container.
async function _getVapidPublicKey() {
  try {
    const { getVapidKeys } = await import('./AppriseDispatcher.mjs')
    const { publicKey } = await getVapidKeys()
    return publicKey
  } catch {
    return null
  }
}

async function saveChannelConfiguration(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { channels, activeChannel } = req.body || {}

    if (activeChannel && !getChannel(activeChannel)) {
      throw new Errors.InvalidError('unknown channel type')
    }

    await NotificationsPreferencesHandler.promises.saveChannelConfiguration(
      userId,
      { channels: channels || {}, activeChannel: activeChannel || null }
    )

    res.json({ saved: true })
  } catch (err) {
    next(err)
  }
}

/**
 * Test ONE channel: builds the Apprise URL from the user's saved values for
 * that type and sends a test message through Apprise. Rate-limited per user
 * per type (Redis: notif:test:{userId}:{type}, 60s TTL).
 */
async function sendTestChannel(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { channel, values: bodyValues } = req.body || {}
    const ch = getChannel(channel)
    if (!ch) throw new Errors.InvalidError('unknown channel type')

    const { default: RedisWrapper } = await import(
      '../../../../app/src/infrastructure/RedisWrapper.mjs'
    )
    const redis = RedisWrapper.client('notifications_test_rate')
    const key = `notif:test:${userId}:${channel}`
    if (await redis.exists(key)) {
      res.status(429).json({ message: 'Please wait a minute before the next test.' })
      return
    }
    await redis.set(key, '1', 'EX', 60)

    const { db, ObjectId } = await import('../../../../app/src/infrastructure/mongodb.mjs')
    const doc = await db.notificationsPreferences.findOne({
      user_id: new ObjectId(userId),
      project_id: null,
    })
    const adminCfg = await db.notificationSettings
      .findOne({ _id: 'global' })
      .catch(() => null)
    // In-progress values from the form take precedence over the stored ones
    // (so "test" works before "save"); stored secrets fill in the gaps.
    // Masked values ('••••…') are echoes of the stored secret — keep the
    // stored value instead.
    const storedValues = (doc?.channels?.[channel] || {})
    const mergedValues = { ...storedValues }
    for (const [field, value] of Object.entries(bodyValues || {})) {
      const str = String(value).trim()
      if (!str) continue
      if (str.startsWith('\u2022\u2022\u2022\u2022')) continue // unchanged secret — use stored
      mergedValues[field] = str
    }
    const values = mergedValues
    const pinned = adminCfg?.pinned?.[channel] || {}

    if (ch.browserPush) {
      if (!values.subscription) {
        throw new Errors.InvalidError('Browser push is not set up yet — press "Enable browser notifications" first.')
      }
    } else if (ch.customUrl) {
      if (!values.url) {
        throw new Errors.InvalidError('No custom URL saved yet.')
      }
    } else if (!Object.values(values).some(v => v)) {
      throw new Errors.InvalidError('This channel is not filled in yet.')
    }

    const url = buildChannelUrl(channel, values, pinned)

    // Route through the shared dispatcher: browser push is sent by this
    // process (no Apprise needed), email falls back to direct SMTP,
    // everything else goes to Apprise.
    await sendAppriseNotification({
      title: 'Overleaf test notification',
      body: `Test message for **${ch.label}**. If you can see it, this channel works.`,
      url,
    }).catch(err => {
      throw new Errors.InvalidError(`Dispatch failed: ${err.message}`)
    })

    res.json({ message: `Test notification sent via ${ch.label}.` })
  } catch (err) {
    if (err.message?.startsWith('Dispatch failed')) {
      res.status(502).json({ message: err.message })
    } else {
      next(err)
    }
  }
}

/**
 * Store the browser PushSubscription (from the settings page JS):
 *   POST /user/notification-preferences/subscribe { subscription }
 */
async function savePushSubscription(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { subscription } = req.body || {}
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Errors.InvalidError('invalid push subscription')
    }

    await NotificationsPreferencesHandler.promises.saveChannelConfiguration(userId, {
      channels: { browserPush: { subscription } },
      activeChannel: req.body?.makeActive ? 'browserPush' : null,
    })

    res.json({ saved: true, message: 'Browser notifications enabled.' })
  } catch (err) {
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
  saveChannelConfiguration,
  sendTestChannel,
  savePushSubscription,
}
