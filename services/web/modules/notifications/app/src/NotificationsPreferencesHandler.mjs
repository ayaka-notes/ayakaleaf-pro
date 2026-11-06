// @ts-check

import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { callbackifyAll } from '@overleaf/promise-utils'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import {
  normalizeProjectPreferences,
  normalizeGlobalPreferences,
} from './PreferenceNormalizer.mjs'

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

const NotificationsPreferencesHandler = {
  getProjectPreferences,
  saveProjectPreferences,
  getGlobalPreferences,
  saveGlobalPreferences,
}

export default {
  ...callbackifyAll(NotificationsPreferencesHandler),
  promises: NotificationsPreferencesHandler,
}
