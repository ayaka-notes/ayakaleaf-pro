// @ts-check

import logger from '@overleaf/logger'
import {
  db,
  ObjectId,
  connectionPromise,
} from '../../../../app/src/infrastructure/mongodb.mjs'
import {
  normalizeProjectPreferences,
  normalizeGlobalPreferences,
  defaultProjectPreferences,
} from '@overleaf/notification-preferences'

// Debounce: only schedule emails for changes at least MIN_DELAY_MS old so we
// do not notify while a user is actively editing.
const MIN_DELAY_MS = Number(
  process.env.PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS
) || 2 * 60 * 1000

const EMAIL_TYPE = 'trackedChangesNotification'

function _collectMemberIds(project) {
  const memberIds = new Set()

  if (project.owner_ref) {
    memberIds.add(project.owner_ref.toString())
  }

  for (
    const field of [
      project.collaberator_refs,
      project.readOnly_refs,
      project.tokenAccessReadAndWrite_refs,
      project.tokenAccessReadOnly_refs,
    ]
  ) {
    if (Array.isArray(field)) {
      for (const id of field) {
        if (id) {
          memberIds.add(id.toString())
        }
      }
    }
  }

  return [...memberIds]
}

async function _loadProjectPreferences(projectId, userIds) {
  if (!userIds.length) return new Map()

  const preferences = await db.notificationsPreferences
    .find(
      {
        user_id: { $in: userIds.map(id => new ObjectId(id)) },
        project_id: new ObjectId(projectId),
      },
      { projection: { _id: 0 } }
    )
    .toArray()

  const map = new Map()
  for (const preference of preferences) {
    map.set(
      preference.user_id.toString(),
      normalizeProjectPreferences(preference)
    )
  }
  return map
}

async function _loadGlobalPreferences(userIds) {
  if (!userIds.length) return new Map()

  const preferences = await db.notificationsPreferences
    .find(
      {
        user_id: { $in: userIds.map(id => new ObjectId(id)) },
        project_id: null,
      },
      { projection: { _id: 0 } }
    )
    .toArray()

  const map = new Map()
  for (const preference of preferences) {
    map.set(preference.user_id.toString(), normalizeGlobalPreferences(preference))
  }
  return map
}

/**
 * Schedule project-change emails for every member who opted in.
 *
 * Called from the `projectModified` queue hook (Bull queue `project-notification`,
 * enqueued by `document-updater/scripts/project_notifications.mts`).
 *
 * Idempotent: one doc per (recipient_id, project_id, emailType) via upsert,
 * so repeated runs refresh the schedule instead of duplicating.
 */
export async function scheduleProjectChangeNotifications({
  projectId,
  timestamp,
  userId,
}) {
  await connectionPromise

  const now = Date.now()
  const ageMs = now - timestamp

  if (ageMs < MIN_DELAY_MS) {
    return {
      skipped: 'debounce',
      scheduled: 0,
    }
  }

  const project = await db.projects.findOne(
    { _id: new ObjectId(projectId) },
    {
      projection: {
        owner_ref: 1,
        collaberator_refs: 1,
        readOnly_refs: 1,
        tokenAccessReadAndWrite_refs: 1,
        tokenAccessReadOnly_refs: 1,
        name: 1,
      },
    }
  )

  if (!project) {
    logger.warn({ projectId }, 'project not found for project-change notification')
    return { skipped: 'project-not-found', scheduled: 0 }
  }

  const memberIds = _collectMemberIds(project)
  const ownerId = project.owner_ref ? project.owner_ref.toString() : null

  const preferencesMap = await _loadProjectPreferences(projectId, memberIds)
  const globalPrefsMap = await _loadGlobalPreferences(memberIds)

  const projectName = project.name || 'project'

  let scheduled = 0

  for (const memberId of memberIds) {
    const globalPrefs =
      globalPrefsMap.get(memberId) || normalizeGlobalPreferences({})

    if (globalPrefs.muteAllNotifications === true) {
      continue
    }

    // Never notify the editor who made this change.
    if (userId && String(memberId) === String(userId)) {
      continue
    }

    const prefs = preferencesMap.get(memberId) || defaultProjectPreferences()
    const isOwner = memberId === ownerId
    const wantsNotif = isOwner
      ? prefs.trackedChangesOnOwnProject
      : prefs.trackedChangesOnInvitedProject

    if (!wantsNotif) {
      continue
    }

    // Per-user grace delay (minutes, user setting) on top of the global
    // minimum; unset users fall back to the server default, whose deadline
    // has already passed by the time this hook runs (scheduledAt = now).
    const userDelayMs = globalPrefs.notificationDelayMinutes
      ? globalPrefs.notificationDelayMinutes * 60 * 1000
      : 0
    const effectiveDelayMs = Math.max(userDelayMs, MIN_DELAY_MS)
    const scheduledAt = new Date(Math.max(now, timestamp + effectiveDelayMs))

    const result = await db.emailNotifications.updateOne(
      {
        recipient_id: new ObjectId(memberId),
        project_id: new ObjectId(projectId),
        emailType: EMAIL_TYPE,
      },
      {
        // A fresh change restarts the delivery state: a previous failed
        // attempt (attempts/nextRetryAt) or a dead-lettered doc must not
        // keep suppressing this recipient — the claim logic otherwise never
        // picks up a doc that is dead:true or still inside its retry backoff.
        $set: {
          recipient_id: new ObjectId(memberId),
          project_id: new ObjectId(projectId),
          emailType: EMAIL_TYPE,
          opts: { projectId, projectName },
          scheduledAt,
          updatedAt: new Date(),
          attempts: 0,
          processing: false,
        },
        $unset: {
          nextRetryAt: '',
          processingError: '',
          processingStartedAt: '',
          dead: '',
        },
      },
      { upsert: true }
    )

    scheduled += result.upsertedCount ? 1 : 0
  }

  logger.debug(
    { projectId, scheduled, memberCount: memberIds.length },
    'scheduled project-change email notifications'
  )

  return { scheduled }
}
