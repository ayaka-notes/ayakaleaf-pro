import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import {
  checkAccess,
  checkNotRestricted,
  person,
  rateLimiters,
  text,
} from './McpUtils.mjs'

// Tracked changes are ranges of the docs, as the review panel reads and
// accepts them (modules/track-changes)

// The tracked changes of every doc, with the edits not saved yet: the
// document updater only knows the docs open lately
async function getChanges(projectId) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const docs = await DocstoreManager.promises.getAllRanges(projectId)
  return docs.flatMap(({ _id: docId, ranges }) =>
    (ranges?.changes ?? []).map(change => ({ docId: docId.toString(), change }))
  )
}

export function buildTrackedChangeTools({ userId, projectId }) {
  return {
    list_tracked_changes: {
      rateLimiter: rateLimiters.listTrackedChanges,
      description:
        'List the tracked changes of the project, as the review panel: ' +
        'the file, the inserted or deleted text, its author and when.',
      handler: async () => {
        await checkNotRestricted(
          userId,
          projectId,
          'You cannot see the tracked changes of this project'
        )
        const [changes, { docs }] = await Promise.all([
          getChanges(projectId),
          ProjectEntityHandler.promises.getAllEntities(projectId),
        ])
        const users = await UserGetter.promises.getUsers(
          [...new Set(changes.map(({ change }) => change.metadata.user_id))].filter(
            Boolean
          ),
          { email: 1, first_name: 1, last_name: 1 }
        )
        const author = id =>
          person(users.find(user => user._id.toString() === id))
        // paths as in the git clone, without the leading /
        const paths = new Map(
          docs.map(({ doc, path }) => [doc._id.toString(), path.slice(1)])
        )
        return text(
          changes.map(({ docId, change }) => ({
            id: change.id,
            file: paths.get(docId) ?? null,
            type: change.op.i != null ? 'insert' : 'delete',
            text: change.op.i ?? change.op.d,
            author: author(change.metadata.user_id),
            timestamp: new Date(change.metadata.ts).toISOString(),
          }))
        )
      },
    },

    accept_tracked_changes: {
      rateLimiter: rateLimiters.acceptTrackedChanges,
      description:
        'Accept tracked changes (id of list_tracked_changes): the text stays ' +
        'as it is and the change is no longer tracked. Accept only the ' +
        'changes the user asks for.',
      inputSchema: {
        ids: z
          .array(zz.objectId())
          .min(1)
          .describe('ids of the changes, returned by list_tracked_changes.'),
      },
      handler: async ({ ids }) => {
        await checkAccess(
          AuthorizationManager.promises.canUserWriteProjectContent,
          userId,
          projectId,
          'You cannot accept tracked changes in this project'
        )
        const changes = await getChanges(projectId)
        const byDoc = new Map()
        for (const id of new Set(ids)) {
          const found = changes.find(({ change }) => change.id === id)
          if (!found) {
            throw new Error(
              `Tracked change ${id} not found, list_tracked_changes again`
            )
          }
          byDoc.set(found.docId, [...(byDoc.get(found.docId) ?? []), id])
        }
        // as the track-changes module accepts them
        for (const [docId, changeIds] of byDoc) {
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
        }
        return text('Accepted.')
      },
    },
  }
}
