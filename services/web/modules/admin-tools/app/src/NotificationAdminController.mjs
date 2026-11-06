// @ts-check
/**
 * Admin: notification dispatch management (/admin/notifications).
 *
 * - global dispatch config (dry-run toggle; Apprise API URL + debounce are
 *   environment driven and shown read-only)
 * - per-user notification channel (Apprise URL) management
 * - queue status (pending / processing / dead) + retry / clear
 * - test sends through the Apprise API
 *
 * All routes are site-admin only; mutations are POST + CSRF (house
 * convention) and return JSON for the React page.
 */

import * as Path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))
import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import { db, ObjectId, connectionPromise } from '../../../../app/src/infrastructure/mongodb.mjs'
import {
  sendAppriseNotification,
  APPRISDE_API_URL,
} from '../../../notifications/app/src/AppriseDispatcher.mjs'
import {
  normalizeNotificationUrl,
  NOTIFICATION_URL_MAX_LENGTH,
} from '../../../notifications/app/src/PreferenceNormalizer.mjs'

const SETTINGS_ID = 'global'

const baseDelayMs =
  Number(process.env.PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS) || 120000

async function _getSettings() {
  await connectionPromise
  const doc = await db.notificationSettings.findOne({ _id: SETTINGS_ID })
  return {
    dryRun: Boolean(doc?.dryRun),
  }
}

async function _saveSettings(patch) {
  await connectionPromise
  await db.notificationSettings.updateOne(
    { _id: SETTINGS_ID },
    { $set: { ...patch, updatedAt: new Date() } },
    { upsert: true }
  )
}

/** Snapshot of dispatch config + recipients + queue for the page. */
export async function buildState() {
  await connectionPromise

  const users = await db.users
    .find({}, { projection: { _id: 1, email: 1 } })
    .sort({ email: 1 })
    .limit(2000)
    .toArray()

  const prefDocs = await db.notificationsPreferences
    .find({ project_id: null }, { projection: { _id: 0, user_id: 1, notificationUrl: 1 } })
    .toArray()
  const urlByUser = new Map()
  for (const doc of prefDocs) {
    urlByUser.set(doc.user_id.toString(), doc.notificationUrl || null)
  }

  const recipients = users.map(user => ({
    id: user._id.toString(),
    email: user.email || '',
    notificationUrl: urlByUser.get(user._id.toString()) || null,
  }))

  const now = new Date()
  const staleBefore = new Date(now.getTime() - 60 * 60 * 1000)
  const [pending, processing, dead] = await Promise.all([
    db.emailNotifications.countDocuments({
      dead: { $ne: true },
      $or: [
        { processing: { $exists: false } },
        { processing: false },
      ],
    }),
    db.emailNotifications.countDocuments({ processing: true }),
    db.emailNotifications.countDocuments({ dead: true }),
  ])

  const recent = await db.emailNotifications
    .find({}, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(10)
    .toArray()

  return {
    dispatch: {
      apiUrl: APPRISDE_API_URL,
      dryRun: (await _getSettings()).dryRun,
      baseDelayMs,
      staleProcessingBefore: staleBefore.toISOString(),
    },
    recipients,
    queue: { pending, processing, dead, recent },
  }
}

const setDryRunSchema = z.object({
  body: z.object({ dryRun: z.boolean() }),
})

const setUserUrlSchema = z.object({
  body: z.object({
    userId: z.string(),
    notificationUrl: z.string().max(NOTIFICATION_URL_MAX_LENGTH).nullable(),
  }),
})

const testSendSchema = z.object({
  body: z.looseObject({
    email: z.string().optional(),
    url: z.string().optional(),
    userId: z.string().optional(),
  }),
})

// All handlers are async and RETURN: expressify attaches .catch(next) to the
// handler's promise, so a rejection surfaces as an Express error response
// instead of an unhandled rejection (which would crash the web process —
// observed live 2026-11-06 when res.json() threw after the headers were
// already sent).

async function setDryRun(req, res, next) {
  const { body } = parseReq(req, setDryRunSchema)
  await _saveSettings({ dryRun: body.dryRun })
  if (!res.headersSent) res.json({ dryRun: body.dryRun })
}

async function setUserUrl(req, res, next) {
  const { body } = parseReq(req, setUserUrlSchema)
  const normalized = normalizeNotificationUrl(body.notificationUrl)
  await db.notificationsPreferences.updateOne(
    { user_id: new ObjectId(body.userId), project_id: null },
    {
      $set: { notificationUrl: normalized, updatedAt: new Date() },
    },
    { upsert: true }
  )
  if (!res.headersSent) res.json({ notificationUrl: normalized })
}

async function testSend(req, res, next) {
  const { body } = parseReq(req, testSendSchema)
  if (!body.url && !body.email && !body.userId) {
    return res
      .status(400)
      .json({ message: 'Provide an email, a user id, or a channel URL.' })
  }
  try {
    await sendAppriseNotification({
      title: 'Overleaf admin test notification',
      body:
        'This is a test notification sent from the Overleaf admin panel. ' +
        'If you received it, this channel is working.',
      userId: body.userId || null,
      email: body.email || null,
      url: body.url || null,
    })
    if (!res.headersSent) res.json({ message: 'Test notification sent.' })
  } catch (err) {
    logger.warn({ err }, 'admin test notification failed')
    if (!res.headersSent) {
      res.status(502).json({ message: `Test notification failed: ${err.message}` })
    }
  }
}

async function queueRetry(req, res, next) {
  // Reset delivery state on every non-pending doc so the next dispatch
  // run picks them up again.
  const result = await db.emailNotifications.updateMany(
    {
      $or: [
        { dead: true },
        { processing: false, nextRetryAt: { $exists: true } },
      ],
    },
    {
      $set: { processing: false, attempts: 0, updatedAt: new Date() },
      $unset: { dead: '', nextRetryAt: '', processingError: '', processingStartedAt: '' },
    }
  )
  if (!res.headersSent) res.json({ reset: result.modifiedCount })
}

async function queueClear(req, res, next) {
  const result = await db.emailNotifications.deleteMany({})
  if (!res.headersSent) res.json({ deleted: result.deletedCount })
}

async function state(req, res, next) {
  const stateJson = await buildState()
  if (!res.headersSent) res.json(stateJson)
}

async function notificationsAdminPage(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = await User.findById(userId, 'ace')
  const userSettings = await UserSettingsHelper.buildUserSettings(req, res, user)
  const stateJson = await buildState()
  if (!res.headersSent) {
    res.render(Path.resolve(__dirname, '../views/notifications-admin-react'), {
      title: 'Notifications',
      userSettings,
      initialState: stateJson,
    })
  }
}

export default {
  notificationsAdminPage: expressify(notificationsAdminPage),
  state: expressify(state),
  setDryRun: expressify(setDryRun),
  setUserUrl: expressify(setUserUrl),
  testSend: expressify(testSend),
  queueRetry: expressify(queueRetry),
  queueClear: expressify(queueClear),
}
