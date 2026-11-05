import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { checkAccess, person, rateLimiters, text } from './McpUtils.mjs'
import { findEntity, filePath } from './FileTools.mjs'
// The review panel's tracked changes: the ranges of every doc (pending
// insertions/deletions, per user) as the panel reads them through
// DocstoreManager.getAllRanges (the panel's /project/:id/ranges route uses
// the same call), accept through the panel's accept route, and the
// tracked-changes on/off state the panel's switch writes (project
// track_changes, as TrackChangesController.trackChanges does).
//
// Rejecting a change is NOT available here on purpose: the Overleaf editor
// rejects by computing the inverse edit CLIENT-side (CodeMirror state) and
// sending that edit — a server-side port of that would risk corrupting
// content, so reject stays a human action in the review panel. The tool
// below says exactly that.
const blockLinkViewers = (userId, projectId) =>
  checkAccess(
    (userId, projectId) =>
      !AuthorizationManager.promises.isRestrictedUserForProject(userId, projectId),
    userId,
    projectId,
    'You can\'t see the tracked changes of this project (you joined by link)'
  )
const canRead = (userId, projectId) =>
  checkAccess(
    (userId, projectId) =>
      AuthorizationManager.promises.canUserReadProject(userId, projectId),
    userId,
    projectId,
    'You can\'t read this project'
  )
const canWrite = (userId, projectId) =>
  checkAccess(
    (userId, projectId) =>
      AuthorizationManager.promises.canUserWriteProjectContent(userId, projectId),
    userId,
    projectId,
    'You can\'t edit this project'
  )
export function buildTrackChangesTools({ userId, projectId }) {
  return {
    list_changes: {
      rateLimiter: rateLimiters.listChanges,
      description:
        'List the tracked changes (suggestions) of the project, per file: '
        +
        'who made each one, insertion or deletion, and the affected text, '
        +
        'plus the tracked-changes state (on/off per member).',
      handler: async () => {
        await blockLinkViewers(userId, projectId)
        await canRead(userId, projectId)
        await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
        const [docs, { docs: entities }, project] = await Promise.all([
          DocstoreManager.promises.getAllRanges(projectId),
          ProjectEntityHandler.promises.getAllEntities(projectId),
          Project.findById(projectId, { track_changes: 1 }).lean(),
        ])
        const paths = new Map(
          entities.map(({ doc, path }) => [doc._id.toString(), path.slice(1)])
        )
        const tc = project?.track_changes
        const users = {}
        const out = []
        for (const { _id: docId, ranges } of docs) {
          const changes = ranges?.changes
          if (!Array.isArray(changes) || changes.length === 0) continue
          const entry = {
            file: paths.get(String(docId)) || String(docId),
            changes: [],
          }
          for (const change of changes.slice(0, 100)) {
            const uid = String(change?.op?.u ?? change?.user_id ?? '').toLowerCase()
            if (uid && !users[uid]) {
              await UserInfoManager.promises
                .getPersonalInfo(uid)
                .then(u => {
                  users[uid] = UserInfoController.formatPersonalInfo(u)
                })
                .catch(() => {})
            }
            entry.changes.push({
              changeId: change._id ?? change.id ?? null,
              user: (uid && users[uid]) ? person(users[uid]) : uid || 'unknown',
              kind: change?.op?.i != null ? 'insert' : 'delete',
              text:
                change?.op?.i != null
                  ? String(change.op.i).slice(0, 200)
                  : `(removed ${change?.op?.n ?? ''} characters)`,
            })
          }
          out.push(entry)
        }
        return text({
          trackedChanges:
            tc == null
              ? 'off (members edit directly)'
              : Object.entries(tc)
                  .map(([k, v]) => `${k === '__guests__' ? 'guests' : k}: ${v ? 'on' : 'off'}`)
                  .join(', ') || 'off',
          files: out,
        })
      },
    },
    accept_changes: {
      rateLimiter: rateLimiters.acceptChanges,
      description:
        'Accept tracked changes of one file (the panel accept button); ' +
        'accepted changes become normal content. list_changes gives the ' +
        'file and the change ids.',
      inputSchema: {
        file: filePath.describe('The file with the changes.'),
        changeIds: z
          .array(
            z.union([
              z.objectId(),
              z.string().min(1),
            ])
          )
          .min(1)
          .describe('The change ids to accept (all of them: every id).'),
      },
      handler: async ({ file, changeIds }) => {
        await canWrite(userId, projectId)
        const { element } = await findEntity(projectId, file).catch(err => {
          if (/not found/i.test(String(err?.message || err))) {
            throw new Error(`${file} not found`)
          }
          throw err
        })
        const docId = element._id
        EditorRealTimeController.emitToRoom(
          projectId,
          'accept-changes',
          docId,
          changeIds
        )
        await DocumentUpdaterHandler.promises.acceptChanges(
          projectId,
          docId,
          changeIds
        )
        return text(
          `Accepted ${changeIds.length} ${
            changeIds.length === 1 ? 'change' : 'changes'
          } in ${file}.`
        )
      },
    },
    reject_changes: {
      rateLimiter: rateLimiters.acceptChanges,
      description:
        "Explain that rejecting tracked changes is done in Overleaf's " +
        'review panel (a human action): it undoes the change with the ' +
        'editor\u2019s own logic, which the MCP server does not run, to ' +
        'protect the content. Offer to accept the changes instead, or to ' +
        'list them again.',
      inputSchema: {
        file: filePath.describe('The file (only for the message).'),
      },
      handler: async ({ file }) => {
        await blockLinkViewers(userId, projectId)
        await canRead(userId, projectId)
        return text(
          `Rejecting changes in ${file} (or anywhere) is not an MCP action: ` +
            'Overleaf rejects a change by reverting it with the editor\u2019s ' +
            'own code, and this server does not run that code — a wrong ' +
            'server-side port could corrupt the document. Please reject it ' +
            'in the Overleaf review panel (review the panel, select the ' +
            'change, reject). I can instead: list the changes, accept them, ' +
            'or show the affected text so you can decide.'
        )
      },
    },
    set_tracked_changes: {
      rateLimiter: rateLimiters.setTrackedChanges,
      description:
        'Turn tracked changes ON or OFF for the members of the project ' +
        '(the review panel switch). On = members\u2019 edits become ' +
        'suggestions that can be accepted or rejected in the panel; ' +
        'off = edits are normal. Useful to review collaborators\u2019 ' +
        'edits; the MCP tools themselves always edit directly, because ' +
        'their changes are explicit and versioned.',
      inputSchema: {
        enabled: z.boolean().describe('true = on, false = off.'),
      },
      handler: async ({ enabled }) => {
        // as the panel switch: member state per user id (TrackChanges
        // controller merges on_for per member)
        await canWrite(userId, projectId)
        const project = await Project.findById(projectId, {
          track_changes: 1,
        }).lean()
        const state = { ...(project?.track_changes || {}) }
        state[userId] = Boolean(enabled)
        if (state.__guests__ == null) delete state.__guests__
        await Project.updateOne({ _id: projectId }, { track_changes: state })
        EditorRealTimeController.emitToRoom(
          projectId,
          'toggle-track-changes',
          state
        )
        return text(
          `Tracked changes ${enabled ? 'ON' : 'OFF'} for you. ` +
            (enabled
              ? `Now your edits (and others\u2019) appear as suggestions in ` +
                'the review panel and can be accepted or rejected.'
              : 'Edits are applied directly again.')
        )
      },
    },
  }
}
