// @ts-check
/**
 * Generic event-notification scheduler.
 *
 * One entry point for every event in the registry (NotificationEvents.mjs)
 * except the two that have bespoke coalescing already
 * (projectChanges / comments), which keep their dedicated schedulers in
 * ScheduleProjectChangeNotifications.mjs.
 *
 * For each event the hook handler calls:
 *
 *   scheduleEventNotification('memberAdded', {
 *     projectId, actorId, targetUserId: <added user>,
 *     context: { addedByName: 'Alice' },
 *   })
 *
 * The scheduler:
 *   1. resolves the recipient(s) from the event def + context,
 *   2. drops recipients who muted all notifications or switched this event
 *      off (global `events.<key>`),
 *   3. coalesces: one queue doc per (recipient, project?, eventKey) via
 *      upsert, refreshing the schedule + context,
 *   4. leaves delivery to ProcessNotifications (Apprise / direct SMTP).
 *
 * Coalescing key:
 *   - project events: (recipient_id, project_id, emailType=eventKey)
 *   - account events: (recipient_id, emailType=eventKey)  [no project]
 *
 * So a burst of the same event type for the same recipient collapses to the
 * latest one within the grace window.
 */

import logger from '@overleaf/logger'
import {
  db,
  ObjectId,
  connectionPromise,
} from '../../../../app/src/infrastructure/mongodb.mjs'
import {
  normalizeGlobalPreferences,
} from '@overleaf/notification-preferences'
import { getEvent } from './NotificationEvents.mjs'

// Floor for the per-event grace delay so we don't email within a few
// seconds of the event. Account/security events are near-instant (no
// meaningful burst), so they use a short delay.
const GRACE_DELAY_MS =
  Number(process.env.NOTIFICATION_EVENT_GRACE_DELAY_MS) || 2 * 60 * 1000
const SECURITY_GRACE_DELAY_MS = 5 * 1000

function _memberIds(project) {
  const ids = new Set()
  if (project?.owner_ref) ids.add(String(project.owner_ref))
  for (const field of [
    project?.collaberator_refs,
    project?.readOnly_refs,
    project?.reviewer_refs,
    project?.tokenAccessReadAndWrite_refs,
    project?.tokenAccessReadOnly_refs,
  ]) {
    if (Array.isArray(field)) {
      for (const id of field) if (id) ids.add(String(id))
    }
  }
  return [...ids]
}

async function _globalPrefs(userId) {
  try {
    const doc = await db.notificationsPreferences.findOne(
      { user_id: new ObjectId(userId), project_id: null },
      { projection: { _id: 0 } }
    )
    return normalizeGlobalPreferences(doc || {})
  } catch {
    return normalizeGlobalPreferences({})
  }
}

async function _loadProject(projectId) {
  return db.projects.findOne(
    { _id: new ObjectId(projectId) },
    {
      projection: {
        owner_ref: 1,
        collaberator_refs: 1,
        readOnly_refs: 1,
        reviewer_refs: 1,
        tokenAccessReadAndWrite_refs: 1,
        tokenAccessReadOnly_refs: 1,
        name: 1,
      },
    }
  )
}

/**
 * Resolve the list of recipient user ids for an event.
 * @param {import('./NotificationEvents.mjs').EventDef} event
 * @param {{projectId?: string, actorId?: string|null, targetUserId?: string|null}} args
 * @param {object|null} project
 * @returns {Promise<string[]>}
 */
async function _resolveRecipients(event, args, project) {
  const { actorId, targetUserId } = args

  switch (event.recipientType) {
    case 'specific-user': {
      const id = targetUserId || actorId
      return id ? [String(id)] : []
    }
    case 'project-members': {
      if (!project) return []
      return _memberIds(project)
    }
    case 'project-members-minus-actor': {
      if (!project) return []
      const actor = actorId ? String(actorId) : null
      return _memberIds(project).filter(id => id !== actor)
    }
    default:
      return []
  }
}

/**
 * Schedule a notification for an event.
 *
 * @param {string} eventKey one of the keys in NotificationEvents.EVENTS
 * @param {object} args
 * @param {string} [args.projectId]
 * @param {string|null} [args.actorId] the acting user (if any)
 * @param {string|null} [args.targetUserId] the specific recipient
 *   (required for specific-user events)
 * @param {object} [args.context] extra data for the email body
 *   (e.g. { addedByName, newEmail, ip }). Kept small and serializable.
 * @returns {Promise<{scheduled: number}>}
 */
export async function scheduleEventNotification(
  eventKey,
  { projectId = null, actorId = null, targetUserId = null, context = {} } = {}
) {
  const event = getEvent(eventKey)
  if (!event) {
    logger.warn({ eventKey }, 'scheduleEventNotification: unknown event')
    return { scheduled: 0 }
  }

  await connectionPromise

  const project = projectId ? await _loadProject(projectId) : null
  const projectGone = Boolean(projectId) && !project

  // For a destroyed project (projectDeleted) the project doc is already
  // gone; fall back to the member list captured before destruction.
  const fallbackMemberIds = projectGone
    ? (context.memberIds || []).map(String)
    : []

  if (projectGone && !fallbackMemberIds.length) {
    logger.debug({ eventKey, projectId }, 'event scheduler: no members to notify')
    return { scheduled: 0 }
  }

  let recipientIds = await _resolveRecipients(event, { projectId, actorId, targetUserId }, project)
  // If the project is gone we can't read its members — use the fallback list.
  if (projectGone) {
    recipientIds = fallbackMemberIds.filter(
      id => !actorId || id !== String(actorId)
    )
  }
  if (!recipientIds.length) {
    return { scheduled: 0 }
  }

  // Security/account events are near-instant; project/collab events use the
  // grace delay so bursts coalesce.
  const delayMs =
    event.category === 'security' ? SECURITY_GRACE_DELAY_MS : GRACE_DELAY_MS
  const scheduledAt = new Date(Date.now() + delayMs)

  const projectName = project?.name || 'a project'

  let scheduled = 0
  for (const recipientId of recipientIds) {
    const prefs = await _globalPrefs(recipientId)
    if (prefs.muteAllNotifications) continue
    if (prefs.events?.[eventKey] === false) continue

    const filter =
      project && event.recipientType !== 'specific-user'
        ? {
            recipient_id: new ObjectId(recipientId),
            project_id: new ObjectId(projectId),
            emailType: eventKey,
          }
        : project && event.recipientType === 'specific-user'
          ? {
              recipient_id: new ObjectId(recipientId),
              project_id: new ObjectId(projectId),
              emailType: eventKey,
            }
          : {
              recipient_id: new ObjectId(recipientId),
              project_id: null,
              emailType: eventKey,
            }

    const result = await db.emailNotifications.updateOne(
      filter,
      {
        $set: {
          ...filter,
          emailType: eventKey,
          opts: {
            projectId: project ? String(projectId) : null,
            projectName,
            actorId: actorId ? String(actorId) : null,
            context,
          },
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
    // Count both fresh inserts and in-window updates (coalescing refreshes
    // an existing doc, which reports upsertedCount: 0 / matchedCount: 1).
    scheduled += result.upsertedCount || result.matchedCount ? 1 : 0
  }

  logger.debug(
    { eventKey, scheduled, recipientCount: recipientIds.length },
    'scheduled event notification'
  )
  return { scheduled }
}

export default {
  promises: {
    scheduleEventNotification,
  },
}
