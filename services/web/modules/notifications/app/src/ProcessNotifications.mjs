/**
 * Scheduled email-notification queue processor.
 *
 * Claims due documents from the `emailNotifications` collection and sends
 * them via the web `EmailHandler`. Run by `services/web/scripts/process_notifications.mjs`
 * (cron).
 *
 * Claim protocol (atomic, single-consumer safe):
 * - claim: `findOneAndUpdate` sets `processing: true` + `processingStartedAt`
 * - success: doc is deleted
 * - failure: doc gets `attempts += 1`, `nextRetryAt = now + backoff(attempts)`,
 *   `processing: false`; after `MAX_ATTEMPTS` it is dead-lettered (`dead: true`)
 * - a claim older than `STALE_PROCESSING_MS` (consumer crashed) is reclaimed
 *
 * Dry run (`OVERLEAF_NOTIFICATIONS_DRY_RUN=true`): resolves recipients and
 * counts, but sends nothing. Docs stay claimed during the run (so the loop
 * cannot re-claim them) and are released in one batch afterwards — the queue
 * is left un-consumed for inspection.
 */

import logger from '@overleaf/logger'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { db, connectionPromise } from '../../../../app/src/infrastructure/mongodb.mjs'
import { sendAppriseNotification } from './AppriseDispatcher.mjs'

// Dispatch goes through the Apprise API (100+ channels; SMTP mail by
// default). See AppriseDispatcher.mjs.
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '')

function _notificationPayload(notification) {
  const opts = notification.opts || notification.options || notification.data || {}
  const projectName = opts.projectName || 'a project'
  const projectId = notification.project_id?.toString() || opts.projectId || ''
  const link = projectId ? `${BASE_URL}/project/${projectId}` : null
  const type = notification.emailType || ''
  const ctx = opts.context || {}
  const actorName = ctx.actorName || null

  // Per-event content. The two legacy types keep their original wording;
  // everything else is data-driven from the event key.
  if (type === 'commentNotification' || type === 'comments') {
    const title = 'Overleaf \u2014 new comment'
    const body = link
      ? `**${projectName}** has a new comment.\n\n[Read the comments](${link})`
      : `**${projectName}** has a new comment.`
    return { title, body, projectName, projectId }
  }

  if (type === 'trackedChangesNotification' || type === 'projectChanges') {
    const title = 'Overleaf \u2014 project activity'
    const body = link
      ? `**${projectName}** has been updated.\n\n[Open the project](${link})`
      : `**${projectName}** has been updated.`
    return { title, body, projectName, projectId }
  }

  // Event-keyed content (see NotificationEvents.mjs).
  const byName = actorName ? ` by **${actorName}**` : ''
  const EVENT_CONTENT = {
    projectExpiring: {
      title: 'Overleaf \u2014 project will be deleted',
      body: link
        ? `**${projectName}** is about to be deleted. Download it now.\n\n[Open the project](${link})`
        : `**${projectName}** is about to be deleted.`,
    },
    projectArchived: {
      title: 'Overleaf \u2014 project archived',
      body: link
        ? `**${projectName}** has been archived${byName}.\n\n[Open the project](${link})`
        : `**${projectName}** has been archived${byName}.`,
    },
    projectDuplicated: {
      title: 'Overleaf \u2014 project duplicated',
      body: link
        ? `**${projectName}** was duplicated${byName}.\n\n[Open the project](${link})`
        : `**${projectName}** was duplicated${byName}.`,
    },
    projectRestored: {
      title: 'Overleaf \u2014 project restored',
      body: link
        ? `**${projectName}** has been restored from the archive.\n\n[Open the project](${link})`
        : `**${projectName}** has been restored from the archive.`,
    },
    projectRenamed: {
      title: 'Overleaf \u2014 project renamed',
      body: link
        ? `**${projectName}** was renamed${byName}.\n\n[Open the project](${link})`
        : `**${projectName}** was renamed${byName}.`,
    },
    projectDeleted: {
      title: 'Overleaf \u2014 a project you were in was deleted',
      body:
        projectName !== 'a project'
          ? `**${projectName}** has been permanently deleted.`
          : `A project you were a member of has been permanently deleted.`,
    },
    memberAdded: {
      title: 'Overleaf \u2014 you were added to a project',
      body: link
        ? `You were added to **${projectName}**${byName}.\n\n[Open the project](${link})`
        : `You were added to **${projectName}**${byName}.`,
    },
    memberRemoved: {
      title: 'Overleaf \u2014 you were removed from a project',
      body: `You were removed from **${projectName}**${byName}.`,
    },
    permissionsChanged: {
      title: 'Overleaf \u2014 your permissions changed',
      body: link
        ? `Your role in **${projectName}** was changed${byName}.\n\n[Open the project](${link})`
        : `Your role in **${projectName}** was changed${byName}.`,
    },
    trackChangesToggled: {
      title: 'Overleaf \u2014 track changes updated',
      body: link
        ? `Track changes on **${projectName}** was updated${byName}.\n\n[Open the project](${link})`
        : `Track changes on **${projectName}** was updated${byName}.`,
    },
    emailChanged: {
      title: 'Overleaf \u2014 your email address changed',
      body: `Your account email is now **${ctx.newEmail || 'a new address'}**. If this wasn\u2019t you, reset your password immediately.`,
    },
    passwordChanged: {
      title: 'Overleaf \u2014 your password changed',
      body: `Your account password was changed. If this wasn\u2019t you, reset it immediately and review your active sessions.`,
    },
    newLogin: {
      title: 'Overleaf \u2014 new sign-in to your account',
      body: [
        `A sign-in to **${notification.opts?.to || 'your account'}** was recorded.`,
        ctx.ip ? `IP address: ${ctx.ip}` : null,
        ctx.userAgent ? `Browser: ${ctx.userAgent}` : null,
        `If this wasn\u2019t you, reset your password immediately.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  }

  const content = EVENT_CONTENT[type]
  if (content) {
    return { title: content.title, body: content.body, projectName, projectId }
  }

  // Fallback for unknown types.
  const title = 'Overleaf \u2014 notification'
  const body = link
    ? `**${projectName}** has an update.\n\n[Open the project](${link})`
    : `**${projectName}** has an update.`
  return { title, body, projectName, projectId }
}

const BATCH_SIZE = Number(process.env.PROCESS_NOTIFICATIONS_BATCH_SIZE) || 100
const STALE_PROCESSING_MS = 1000 * 60 * 60 // 1 hour
const MAX_ATTEMPTS = Number(process.env.OVERLEAF_NOTIFICATIONS_MAX_ATTEMPTS) || 3
const RETRY_BACKOFF_BASE_MS =
  Number(process.env.OVERLEAF_NOTIFICATION_SILENCE_PERIOD_MS) ||
  2 * 60 * 60 * 1000 // 2 hours, doubling per attempt

const ENV_DRY_RUN = process.env.OVERLEAF_NOTIFICATIONS_DRY_RUN === 'true'

/** Dry run = env flag OR the admin-page toggle (notificationSettings). */
async function _isDryRun() {
  if (ENV_DRY_RUN) return true
  try {
    const doc = await db.notificationSettings.findOne(
      { _id: 'global' },
      { projection: { _id: 0, dryRun: 1 } }
    )
    return Boolean(doc?.dryRun)
  } catch {
    return false
  }
}

function _claimNextDueNotification() {
  const now = Date.now()
  const nowDate = new Date(now)
  const staleDate = new Date(now - STALE_PROCESSING_MS)

  return db.emailNotifications.findOneAndUpdate(
    {
      scheduledAt: { $lte: nowDate },
      $or: [
        // never-processed
        { processing: { $exists: false } },
        // failed with retry scheduled
        { processing: false, nextRetryAt: { $lt: nowDate } },
        // failed by the legacy writer (no backoff field)
        { processing: false, nextRetryAt: { $exists: false } },
        // stale in-progress claim (consumer died)
        { processing: true, processingStartedAt: { $lt: staleDate } },
      ],
      $nor: [{ dead: true }],
    },
    {
      $set: { processing: true, processingStartedAt: nowDate },
    },
    { sort: { scheduledAt: 1 }, returnDocument: 'after' }
  ).then(
    // This build resolves findOneAndUpdate (raw mongodb-legacy collection)
    // to the DOCUMENT itself; some driver builds/tests return { value: doc }.
    // Normalize to `doc | null` so a claimed doc is not dropped by reading
    // `result.value` (undefined here) after `processing: true` was already set.
    result => (result && result.value !== undefined ? result.value : result) ||
      null
  )
}

async function _markFailed(notification, err) {
  const attempts = (notification.attempts || 0) + 1
  logger.warn(
    { err: err?.message || String(err), attempts, notificationId: notification._id },
    'failed to process scheduled email notification'
  )

  if (attempts >= MAX_ATTEMPTS) {
    await db.emailNotifications.updateOne(
      { _id: notification._id },
      {
        $set: {
          dead: true,
          processing: false,
          attempts,
          processingError: err?.message || String(err),
        },
      }
    )
    return
  }

  const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempts - 1)
  await db.emailNotifications.updateOne(
    { _id: notification._id },
    {
      $set: {
        processing: false,
        attempts,
        nextRetryAt: new Date(Date.now() + backoff),
        processingError: err?.message || String(err),
      },
    }
  )
}

function _releaseForDryRun(ids) {
  // End of run: release the dry-claimed docs in one batch so they are
  // claimable again without a backoff (queue left un-consumed for inspection).
  return db.emailNotifications.updateMany(
    { _id: { $in: ids } },
    {
      $set: { processing: false },
      $unset: { nextRetryAt: '', processingStartedAt: '' },
    }
  )
}

export async function processNotifications() {
  await connectionPromise

  let notificationsFound = 0
  let notificationsReady = 0
  let emailsSent = 0
  let dryRunProcessed = 0
  let dryRunWouldHaveSent = 0
  const dryClaimedIds = []

  const DRY_RUN = await _isDryRun()

  while (notificationsFound < BATCH_SIZE) {
    const notification = await _claimNextDueNotification()
    if (!notification) {
      break
    }
    notificationsFound += 1

    try {
      const toUserId =
        notification.recipient_id?.toString() ||
        notification.opts?.toUserId ||
        null

      // Resolve the recipient email for the mailto:// fallback channel
      // (a stored notificationUrl preference takes precedence and needs
      // no email at all). Legacy docs carry the address in opts.to.
      let email = notification.opts?.to || null
      if (!email && toUserId) {
        const user = await UserGetter.promises.getUser(toUserId, {
          email: 1,
        })
        email = user?.email || null
      }
      if (!email && !toUserId) {
        throw new Error(
          'scheduled notification has no recipient and no email address'
        )
      }

      notificationsReady += 1

      if (DRY_RUN) {
        // Keep the claim in place so the loop cannot re-claim this doc
        // (it would sort first again); all dry claims are released after
        // the loop in one batch.
        dryClaimedIds.push(notification._id)
        dryRunProcessed += 1
        dryRunWouldHaveSent += 1
        continue
      }

      const { title, body } = _notificationPayload(notification)
      await sendAppriseNotification({
        title,
        body,
        userId: toUserId,
        email,
      })
      emailsSent += 1
      await db.emailNotifications.deleteOne({ _id: notification._id })
    } catch (err) {
      await _markFailed(notification, err)
    }
  }

  if (DRY_RUN && dryClaimedIds.length > 0) {
    await _releaseForDryRun(dryClaimedIds)
  }

  return {
    notificationsFound,
    notificationsReady,
    emailsSent,
    dryRunProcessed,
    dryRunWouldHaveSent,
  }
}
