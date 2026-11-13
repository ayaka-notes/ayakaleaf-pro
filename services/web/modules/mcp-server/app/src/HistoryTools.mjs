import Settings from '@overleaf/settings'
import { fetchJson, fetchNothing, RequestFailedError } from '@overleaf/fetch-utils'
import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import AdminAuthorizationHelper from '../../../../app/src/Features/Helpers/AdminAuthorizationHelper.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import RestoreManager from '../../../../app/src/Features/History/RestoreManager.mjs'
import ProjectAuditLogHandler from '../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import {
  checkAccess,
  checkNotRestricted,
  filePath,
  person,
  pullHint,
  rateLimiters,
  text,
  version,
} from './McpUtils.mjs'

// The history panel's reads and writes: project-history for the changes,
// diffs and versions (labels), RestoreManager for restores. The diffs process
// the queued edits first, like the changes list, so they include the latest.

const HISTORY_URL = Settings.apis.project_history.url
const DAY = 24 * 60 * 60 * 1000

const iso = timestamp => new Date(timestamp).toISOString()

// One batch of the history panel: at least 10 changes, older than before
async function getUpdates(projectId, userId, before) {
  const url = new URL(`${HISTORY_URL}/project/${projectId}/updates`)
  url.searchParams.set('min_count', '10')
  if (before != null) url.searchParams.set('before', before.toString())
  return await fetchJson(url, { headers: { 'X-User-Id': userId } })
}

// Without the owner's full project history (versioning), the history panel
// shows the changes of the last 24 hours, at least one, unless the user is an
// admin (history-context.tsx). Returns the oldest version it lets them see,
// or null when they see all.
async function oldestVisibleVersion(projectId, userId) {
  const { owner_ref: ownerId } = await ProjectGetter.promises.getProject(
    projectId,
    { owner_ref: 1 }
  )
  const [owner, user] = await Promise.all([
    UserGetter.promises.getUser(ownerId, { features: 1 }),
    UserGetter.promises.getUser(userId, { isAdmin: 1 }),
  ])
  if (
    owner?.features?.versioning ||
    AdminAuthorizationHelper.hasAdminAccess(user)
  ) {
    return null
  }
  const dayAgo = Date.now() - DAY
  let before
  let newer = null
  do {
    const { updates, nextBeforeTimestamp } = await getUpdates(
      projectId,
      userId,
      before
    )
    for (const update of updates) {
      // the panel fades the first older change and shows the one before it,
      // or this one when all are older
      if (update.meta.end_ts < dayAgo) return (newer ?? update).fromV
      newer = update
    }
    before = nextBeforeTimestamp
  } while (before != null)
  return null
}

// The latest version, once the queued edits are processed
async function latestVersion(projectId) {
  const { version } = await fetchJson(`${HISTORY_URL}/project/${projectId}/version`)
  return version
}

// Versions the history panel lets the user pick: project-history fails on
// the ones that do not exist yet
async function checkVersionsVisible(projectId, userId, ...versions) {
  const latest = await latestVersion(projectId)
  const missing = versions.find(v => v > latest)
  if (missing != null) {
    throw new Error(`Version ${missing} not found, the latest is ${latest}`)
  }
  const oldest = await oldestVisibleVersion(projectId, userId)
  if (oldest != null && versions.some(v => v < oldest)) {
    throw new Error(
      `Versions before ${oldest} are not available: the project owner does ` +
        'not have full project history'
    )
  }
}

async function getDocDiff(projectId, path, from, to) {
  const url = new URL(`${HISTORY_URL}/project/${projectId}/diff`)
  url.searchParams.set('pathname', path)
  url.searchParams.set('from', from.toString())
  url.searchParams.set('to', to.toString())
  try {
    return (await fetchJson(url)).diff
  } catch (err) {
    if (err instanceof RequestFailedError && err.response.status === 404) {
      throw new Error(`${path} not found at version ${from}`)
    }
    throw err
  }
}

// read_file of a version: a diff of the version with itself, unchanged text
export async function readFileAtVersion(projectId, userId, path, v) {
  await checkNotRestricted(
    userId,
    projectId,
    'You cannot see the history of this project'
  )
  await checkVersionsVisible(projectId, userId, v)
  const diff = await getDocDiff(projectId, path, v, v)
  if (diff.binary) throw new Error(`${path} is a binary file`)
  return diff.map(part => part.u ?? part.i ?? '').join('')
}

// A unified diff, like git diff, from the parts of project-history's diff:
// unchanged (u), inserted (i) and deleted (d) text
export function unifiedDiff(path, parts, context = 3) {
  const lines = [] // { type: ' ' | '-' | '+', text }
  // the old and new line being read, and whether a change touched them
  let oldLine = ''
  let newLine = ''
  let oldTouched = false
  let newTouched = false
  // changed lines, shown as removed then added before the next unchanged one
  let removed = []
  let added = []
  const flush = () => {
    // the same lines at both ends did not change, e.g. a line break inserted
    // at the end of a line
    let start = 0
    while (
      start < Math.min(removed.length, added.length) &&
      removed[start] === added[start]
    ) {
      start++
    }
    let end = 0
    while (
      end < Math.min(removed.length, added.length) - start &&
      removed.at(-1 - end) === added.at(-1 - end)
    ) {
      end++
    }
    const same = text => ({ type: ' ', text })
    lines.push(
      ...removed.slice(0, start).map(same),
      ...removed.slice(start, removed.length - end).map(text => ({ type: '-', text })),
      ...added.slice(start, added.length - end).map(text => ({ type: '+', text })),
      ...removed.slice(removed.length - end).map(same)
    )
    removed = []
    added = []
  }
  const endBoth = () => {
    if (oldTouched || newTouched || oldLine !== newLine) {
      removed.push(oldLine)
      added.push(newLine)
    } else {
      flush()
      lines.push({ type: ' ', text: oldLine })
    }
    oldLine = newLine = ''
    oldTouched = newTouched = false
  }
  for (const part of parts) {
    const segments = (part.u ?? part.i ?? part.d).split('\n')
    segments.forEach((segment, index) => {
      const ends = index < segments.length - 1
      if (part.u != null) {
        oldLine += segment
        newLine += segment
        if (ends) endBoth()
      } else if (part.d != null) {
        oldLine += segment
        if (segment) oldTouched = true
        if (ends) {
          // a deleted line break: the new line goes on with what came before
          removed.push(oldLine)
          if (newLine) newTouched = true
          oldLine = ''
          oldTouched = false
        }
      } else {
        newLine += segment
        if (segment) newTouched = true
        if (ends) {
          added.push(newLine)
          if (oldLine) oldTouched = true
          newLine = ''
          newTouched = false
        }
      }
    })
  }
  // the last line, without a line break
  if (oldLine || newLine || oldTouched || newTouched) endBoth()
  flush()

  // hunks: the changed lines with up to `context` lines around them
  const keep = lines.map(() => false)
  lines.forEach(({ type }, index) => {
    if (type === ' ') return
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    ) {
      keep[k] = true
    }
  })
  const out = []
  let oldNumber = 1
  let newNumber = 1
  let index = 0
  while (index < lines.length) {
    if (!keep[index]) {
      if (lines[index].type !== '+') oldNumber++
      if (lines[index].type !== '-') newNumber++
      index++
      continue
    }
    const start = index
    const [oldStart, newStart] = [oldNumber, newNumber]
    const hunk = []
    while (index < lines.length && keep[index]) {
      const { type, text } = lines[index]
      hunk.push(type + text)
      if (type !== '+') oldNumber++
      if (type !== '-') newNumber++
      index++
    }
    const oldCount = lines.slice(start, index).filter(l => l.type !== '+').length
    const newCount = lines.slice(start, index).filter(l => l.type !== '-').length
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...hunk)
  }
  return out.length ? [`--- a/${path}`, `+++ b/${path}`, ...out].join('\n') : ''
}

export function buildHistoryTools({ userId, projectId, ip }) {
  const checkCanSee = () =>
    checkNotRestricted(
      userId,
      projectId,
      'You cannot see the history of this project'
    )
  // as the history panel's routes
  const checkCanLabel = () =>
    checkAccess(
      AuthorizationManager.promises.canUserWriteOrReviewProjectContent,
      userId,
      projectId,
      'You cannot save versions of this project'
    )
  const checkCanRestore = () =>
    checkAccess(
      AuthorizationManager.promises.canUserWriteProjectContent,
      userId,
      projectId,
      'You cannot edit this project'
    )

  return {
    list_changes: {
      rateLimiter: rateLimiters.listChanges,
      description:
        'List the changes of the project, newest first, as the history ' +
        'panel: who changed which files and when, with the versions before ' +
        'and after (fromVersion, toVersion) for diff, read_file and the ' +
        'restore tools. Returns a batch; pass its before to get older ones.',
      inputSchema: {
        before: z
          .number()
          .int()
          .optional()
          .describe('before returned by the previous call, for older changes.'),
      },
      handler: async ({ before }) => {
        await checkCanSee()
        const oldest = await oldestVisibleVersion(projectId, userId)
        const { updates, nextBeforeTimestamp } =
          await HistoryManager.promises.injectUserDetails(
            await getUpdates(projectId, userId, before)
          )
        const visible = updates.filter(
          update => oldest == null || update.fromV >= oldest
        )
        const hidden = visible.length < updates.length
        return text({
          changes: visible.map(update => ({
            fromVersion: update.fromV,
            toVersion: update.toV,
            start: iso(update.meta.start_ts),
            end: iso(update.meta.end_ts),
            authors: update.meta.users.map(person),
            files: update.pathnames,
            fileOperations: update.project_ops.map(({ add, remove, rename }) =>
              add
                ? { added: add.pathname }
                : remove
                  ? { removed: remove.pathname }
                  : { renamed: rename.pathname, to: rename.newPathname }
            ),
          })),
          before: hidden ? null : (nextBeforeTimestamp ?? null),
          ...(hidden && {
            note:
              'Older changes are hidden: the project owner does not have ' +
              'full project history.',
          }),
        })
      },
    },

    diff: {
      rateLimiter: rateLimiters.diff,
      description:
        'Compare two versions of the project (fromVersion and toVersion of ' +
        'list_changes): with a path, the changes of that file as a unified ' +
        'diff; without, the files that were added, removed, edited or renamed.',
      inputSchema: {
        fromVersion: version,
        toVersion: version,
        path: filePath.optional(),
      },
      handler: async ({ fromVersion, toVersion, path }) => {
        await checkCanSee()
        if (fromVersion > toVersion) {
          throw new Error('fromVersion must not be after toVersion')
        }
        await checkVersionsVisible(projectId, userId, fromVersion, toVersion)
        if (path == null) {
          const url = new URL(`${HISTORY_URL}/project/${projectId}/filetree/diff`)
          url.searchParams.set('from', fromVersion.toString())
          url.searchParams.set('to', toVersion.toString())
          const { diff } = await fetchJson(url)
          return text(
            diff
              .filter(({ operation }) => operation)
              .map(({ pathname, newPathname, operation }) => ({
                path: pathname,
                change: operation,
                ...(newPathname && { newPath: newPathname }),
              }))
          )
        }
        const diff = await getDocDiff(projectId, path, fromVersion, toVersion)
        if (diff.binary) throw new Error(`${path} is a binary file`)
        return text(
          unifiedDiff(path, diff) ||
            `${path} did not change from version ${fromVersion} to ${toVersion}.`
        )
      },
    },

    create_version: {
      rateLimiter: rateLimiters.createVersion,
      description:
        'Save a version in the project history with a comment, as "Label ' +
        'this version" in the history panel: the latest version, or the ' +
        'given one.',
      inputSchema: {
        comment: z
          .string()
          .min(1)
          .describe('What the version is, e.g. "Submitted draft".'),
        version: version.optional(),
      },
      handler: async ({ comment, version: v }) => {
        await checkCanLabel()
        v ??= await latestVersion(projectId)
        await checkVersionsVisible(projectId, userId, v)
        const label = await fetchJson(
          `${HISTORY_URL}/project/${projectId}/labels`,
          {
            method: 'POST',
            json: { comment, version: v, user_id: userId },
          }
        )
        return text({ id: label.id, version: label.version, comment: label.comment })
      },
    },

    delete_version: {
      rateLimiter: rateLimiters.deleteVersion,
      description:
        'Delete a version saved in the project history (id of ' +
        'list_versions); its changes stay. Only the owner deletes the ' +
        'versions others saved.',
      inputSchema: {
        id: z.string().describe('id returned by list_versions.'),
      },
      handler: async ({ id }) => {
        await checkCanLabel()
        const [labels, project] = await Promise.all([
          fetchJson(`${HISTORY_URL}/project/${projectId}/labels`),
          ProjectGetter.promises.getProject(projectId, { owner_ref: 1 }),
        ])
        const label = labels.find(label => label.id === id)
        if (!label) throw new Error(`Version ${id} not found, list_versions again`)
        // as the history panel: the owner deletes any, others their own
        const isOwner = project.owner_ref.equals(userId)
        if (!isOwner && label.user_id !== userId) {
          throw new Error('You can only delete the versions you saved')
        }
        await fetchNothing(
          isOwner
            ? `${HISTORY_URL}/project/${projectId}/labels/${id}`
            : `${HISTORY_URL}/project/${projectId}/user/${userId}/labels/${id}`,
          { method: 'DELETE' }
        )
        return text('Deleted the version.')
      },
    },

    restore_file: {
      rateLimiter: rateLimiters.restoreFile,
      description:
        'Restore a file as it was at a version, as "Restore this version" ' +
        'in the history panel; the restore is a new change, so it can be ' +
        'undone the same way. Use it when the user asks.',
      inputSchema: { path: filePath, version },
      handler: async ({ path, version: v }) => {
        await checkCanRestore()
        await checkVersionsVisible(projectId, userId, v)
        const entity = await RestoreManager.promises.revertFile(
          userId,
          projectId,
          v,
          path,
          {}
        )
        ProjectAuditLogHandler.addEntryIfManagedInBackground(
          projectId,
          'project-history-version-restored',
          userId,
          ip,
          { version: v, scope: 'file', pathname: path, restoredEntityId: entity._id }
        )
        return text(
          `Restored ${path} as it was at version ${v}. ${pullHint(projectId)}`
        )
      },
    },

    restore_project: {
      rateLimiter: rateLimiters.restoreProject,
      description:
        'Restore the whole project as it was at a version, as "Restore ' +
        'project to this version" in the history panel: every file changes ' +
        'back. The restore is a new change, so it can be undone the same ' +
        'way. Use it only when the user asks for the whole project.',
      inputSchema: { version },
      handler: async ({ version: v }) => {
        await checkCanRestore()
        await checkVersionsVisible(projectId, userId, v)
        const reverted = await RestoreManager.promises.revertProject(
          userId,
          projectId,
          v
        )
        ProjectAuditLogHandler.addEntryIfManagedInBackground(
          projectId,
          'project-history-version-restored',
          userId,
          ip,
          { version: v, scope: 'project', restoredEntities: reverted }
        )
        return text(
          `Restored the project as it was at version ${v}. ` + pullHint(projectId)
        )
      },
    },
  }
}
