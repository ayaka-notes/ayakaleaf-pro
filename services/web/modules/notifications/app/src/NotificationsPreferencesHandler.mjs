// @ts-check

import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { callbackifyAll } from '@overleaf/promise-utils'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import {
  normalizeProjectPreferences,
  normalizeGlobalPreferences,
} from './PreferenceNormalizer.mjs'
import {
  listChannelTypes,
  getChannel,
  maskChannelValues,
} from './ChannelCatalog.mjs'

/**
 * Notification preference storage.
 *
 * Collection `notificationsPreferences` (migration 20251110151140):
 * - per project: { user_id, project_id, <12 preference keys> }
 * - global:      { user_id, project_id: null, muteAllNotifications, ... }
 *
 * Both variants share the unique index `user_id_1_project_id_1`
 * (project_id: null for the global doc).
 */

function _hasProjectAccess(project, userId) {
  if (!project) return false
  const userIdString = new ObjectId(userId).toString()

  if (project.owner_ref?.toString() === userIdString) {
    return true
  }

  const ids = [
    ...(project.collaberator_refs || []),
    ...(project.readOnly_refs || []),
    ...(project.tokenAccessReadAndWrite_refs || []),
    ...(project.tokenAccessReadOnly_refs || []),
  ]

  return ids.some(id => id?.toString() === userIdString)
}

async function _ensureProjectMembership(userId, projectId) {
  const project = await ProjectGetter.promises.getProject(projectId, {
    owner_ref: 1,
    collaberator_refs: 1,
    readOnly_refs: 1,
    tokenAccessReadAndWrite_refs: 1,
    tokenAccessReadOnly_refs: 1,
  })

  if (!project) {
    throw new Errors.NotFoundError(`project ${projectId} not found`)
  }

  if (!_hasProjectAccess(project, userId)) {
    throw new Errors.ForbiddenError(
      `user ${userId} is not allowed to access project ${projectId}`
    )
  }
}

async function getProjectPreferences(userId, projectId) {
  await _ensureProjectMembership(userId, projectId)

  const [preference, globalPreference] = await Promise.all([
    db.notificationsPreferences.findOne({
      user_id: new ObjectId(userId),
      project_id: new ObjectId(projectId),
    }),
    db.notificationsPreferences.findOne({
      user_id: new ObjectId(userId),
      project_id: null,
    }),
  ])

  const preferences = preference
    ? normalizeProjectPreferences(preference)
    : normalizeProjectPreferences({})

  // Contract: the frontend hook (use-project-notification-preferences.ts)
  // reads `muteAllNotifications` from this response to render the
  // "globally muted" state, so the global flag is merged in here.
  preferences.muteAllNotifications =
    normalizeGlobalPreferences(globalPreference).muteAllNotifications

  return preferences
}

async function saveProjectPreferences(userId, projectId, preferences) {
  await _ensureProjectMembership(userId, projectId)

  const normalizedPreferences = normalizeProjectPreferences(preferences)

  await db.notificationsPreferences.updateOne(
    {
      user_id: new ObjectId(userId),
      project_id: new ObjectId(projectId),
    },
    { $set: normalizedPreferences },
    { upsert: true }
  )

  return normalizedPreferences
}

async function getGlobalPreferences(userId) {
  const preference = await db.notificationsPreferences.findOne({
    user_id: new ObjectId(userId),
    project_id: null,
  })

  return preference
    ? normalizeGlobalPreferences(preference)
    : normalizeGlobalPreferences({})
}

async function saveGlobalPreferences(userId, preferences) {
  const normalizedPreferences = normalizeGlobalPreferences(preferences)

  await db.notificationsPreferences.updateOne(
    {
      user_id: new ObjectId(userId),
      project_id: null,
    },
    { $set: normalizedPreferences },
    { upsert: true }
  )

  return normalizedPreferences
}

/**
 * Channel configuration storage (same global doc as the other settings).
 *
 * `channels`  — { telegram: { botToken, chatId }, gotify: { token }, … }
 * `activeChannel` — which one is currently used for dispatch
 *
 * Saving a field with an EMPTY value (or the '••••…' mask) clears/keeps it:
 * masked secrets are never written back. Browser-push stores the raw
 * subscription object (it is not a display secret — the browser owns it).
 */
async function saveChannelConfiguration(userId, { channels = {}, activeChannel = null }) {
  const set = {}
  for (const [type, values] of Object.entries(channels)) {
    const channel = getChannel(type)
    if (!channel) continue
    if (!values || typeof values !== 'object') continue
    if (channel.customUrl) {
      const url = String(values.url || '').trim()
      if (url) set[`channels.${type}.url`] = url
      continue
    }
    if (channel.browserPush) {
      if (values.subscription) {
        set[`channels.${type}.subscription`] = values.subscription
      }
      continue
    }
    // Per-field $set so unsubmitted fields keep their stored values.
    for (const field of channel.fields) {
      const raw = values[field.key]
      if (raw === undefined || raw === null) continue
      const str = String(raw).trim()
      if (!str) continue
      // The '••••tail' mask means "unchanged" — keep the stored value.
      if (field.secret && str.startsWith('\u2022\u2022\u2022\u2022')) {
        continue
      }
      set[`channels.${type}.${field.key}`] = str
    }
  }

  if (activeChannel) {
    set.activeChannel = activeChannel
  }

  await db.notificationsPreferences.updateOne(
    { user_id: new ObjectId(userId), project_id: null },
    { $set: set },
    { upsert: true }
  )

  return { saved: true }
}

/**
 * Read the user's channel configuration for the settings page: masked
 * secrets, per-type value presence, active channel, and the admin's
 * enabled/pinned channel types.
 */
async function getChannelConfiguration(userId) {
  const [doc, adminCfg] = await Promise.all([
    db.notificationsPreferences.findOne({
      user_id: new ObjectId(userId),
      project_id: null,
    }),
    db.notificationSettings.findOne({ _id: 'global' }).catch(() => null),
  ])

  const enabledTypes = new Set(
    adminCfg?.enabledChannelTypes || listChannelTypes()
  )
  const pinned = adminCfg?.pinned || {}

  const channels = {}
  for (const type of listChannelTypes()) {
    if (!enabledTypes.has(type)) continue
    const channel = getChannel(type)
    const values = doc?.channels?.[type] || {}
    channels[type] = {
      label: channel.label,
      browserPush: Boolean(channel.browserPush),
      customUrl: Boolean(channel.customUrl),
      configured: Object.values(values).some(v => v !== undefined && v !== null),
      values: maskChannelValues(type, values),
      pinned: pinned[type] || {},
    }
  }

  const activeChannel = doc?.activeChannel || null
  return {
    channels,
    activeChannel: activeChannel && enabledTypes.has(activeChannel) ? activeChannel : null,
  }
}

/** Clear the user's stored browser-push subscription. Browser push is
 * additive (delivered alongside the main channel), so the main channel's
 * activeChannel is left untouched. */
async function deletePushSubscription(userId) {
  await db.notificationsPreferences.updateOne(
    { user_id: new ObjectId(userId), project_id: null },
    { $unset: { 'channels.browserPush.subscription': '' } }
  )
  return { removed: true }
}

const NotificationsPreferencesHandler = {
  getProjectPreferences,
  saveProjectPreferences,
  getGlobalPreferences,
  saveGlobalPreferences,
  saveChannelConfiguration,
  getChannelConfiguration,
  deletePushSubscription,
}

export default {
  ...callbackifyAll(NotificationsPreferencesHandler),
  promises: NotificationsPreferencesHandler,
}
