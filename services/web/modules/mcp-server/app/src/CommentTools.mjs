import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import { checkAccess, rateLimiters, text } from './McpUtils.mjs'

// Comments are threads in chat, anchored to text by the ranges of a doc, as
// the review panel reads and changes them (modules/track-changes)

const threadId = zz
  .objectId()
  .describe('threadId returned by list_comments.')

// The comments of every doc, with the edits not saved yet: the document
// updater only knows the docs open lately
async function getComments(projectId) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const docs = await DocstoreManager.promises.getAllRanges(projectId)
  return docs.flatMap(({ _id: docId, ranges }) =>
    (ranges?.comments ?? []).map(comment => ({ docId, comment }))
  )
}

async function findCommentDoc(projectId, id) {
  const found = (await getComments(projectId)).find(
    ({ comment }) => comment.op.t === id
  )
  if (!found) throw new Error(`Comment ${id} not found, list_comments again`)
  return found.docId
}

// Who wrote or resolved: name and email, as the review panel shows them
function person(user) {
  if (!user?.email) return null
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name ? `${name} <${user.email}>` : user.email
}

export function buildCommentTools({ userId, projectId }) {
  const checkCanResolve = id =>
    checkAccess(
      (userId, projectId) =>
        AuthorizationManager.promises.canUserDeleteOrResolveThread(
          userId,
          projectId,
          id
        ),
      userId,
      projectId,
      'You cannot resolve or reopen this comment'
    )

  return {
    list_comments: {
      rateLimiter: rateLimiters.listComments,
      description:
        'List the comments of the project: the file and the commented ' +
        'text, then each message with its author, who resolved it, if so.',
      inputSchema: {
        includeResolved: z
          .boolean()
          .default(false)
          .describe('Also list the resolved comments.'),
      },
      handler: async ({ includeResolved }) => {
        // as the review panel, closed to the viewers who joined by link
        if (
          await AuthorizationManager.promises.isRestrictedUserForProject(
            userId,
            projectId
          )
        ) {
          throw new Error('You cannot see the comments of this project')
        }
        const [comments, threads, { docs }] = await Promise.all([
          getComments(projectId),
          ChatApiHandler.promises.getThreads(projectId),
          ProjectEntityHandler.promises.getAllEntities(projectId),
        ])
        await ChatManager.promises.injectUserInfoIntoThreads(threads)
        // paths as in the git clone, without the leading /
        const paths = new Map(
          docs.map(({ doc, path }) => [doc._id.toString(), path.slice(1)])
        )
        return text(
          comments
            .filter(({ comment }) => threads[comment.op.t])
            .filter(({ comment }) => includeResolved || !threads[comment.op.t].resolved)
            .map(({ docId, comment }) => {
              const thread = threads[comment.op.t]
              return {
                threadId: comment.op.t,
                file: paths.get(docId) ?? null,
                text: comment.op.c,
                resolved: Boolean(thread.resolved),
                ...(thread.resolved && {
                  resolvedBy: person(thread.resolved_by_user),
                }),
                messages: thread.messages.map(message => ({
                  author: person(message.user),
                  content: message.content,
                  timestamp: new Date(message.timestamp).toISOString(),
                })),
              }
            })
        )
      },
    },

    reply_to_comment: {
      rateLimiter: rateLimiters.replyToComment,
      description:
        'Reply to a comment; the reply shows live in Overleaf, under the ' +
        "user's name.",
      inputSchema: {
        threadId,
        content: z.string().min(1).describe('The reply.'),
      },
      handler: async ({ threadId, content }) => {
        await checkAccess(
          AuthorizationManager.promises.canUserWriteOrReviewProjectContent,
          userId,
          projectId,
          'You cannot comment on this project'
        )
        await findCommentDoc(projectId, threadId)
        const message = await ChatApiHandler.promises.sendComment(
          projectId,
          threadId,
          userId,
          content
        )
        const user = await UserInfoManager.promises.getPersonalInfo(userId)
        message.user = UserInfoController.formatPersonalInfo(user)
        EditorRealTimeController.emitToRoom(
          projectId,
          'new-comment',
          threadId,
          message
        )
        return text('Replied.')
      },
    },

    resolve_comment: {
      rateLimiter: rateLimiters.resolveComment,
      description: 'Resolve a comment, once it is dealt with.',
      inputSchema: { threadId },
      handler: async ({ threadId }) => {
        await checkCanResolve(threadId)
        const docId = await findCommentDoc(projectId, threadId)
        const user = await UserInfoManager.promises.getPersonalInfo(userId)
        await ChatApiHandler.promises.resolveThread(projectId, threadId, userId)
        EditorRealTimeController.emitToRoom(
          projectId,
          'resolve-thread',
          threadId,
          UserInfoController.formatPersonalInfo(user)
        )
        await DocumentUpdaterHandler.promises.resolveThread(
          projectId,
          docId,
          threadId,
          userId
        )
        return text('Resolved.')
      },
    },

    reopen_comment: {
      rateLimiter: rateLimiters.reopenComment,
      description: 'Reopen a resolved comment.',
      inputSchema: { threadId },
      handler: async ({ threadId }) => {
        await checkCanResolve(threadId)
        const docId = await findCommentDoc(projectId, threadId)
        await ChatApiHandler.promises.reopenThread(projectId, threadId)
        EditorRealTimeController.emitToRoom(projectId, 'reopen-thread', threadId)
        await DocumentUpdaterHandler.promises.reopenThread(
          projectId,
          docId,
          threadId,
          userId
        )
        return text('Reopened.')
      },
    },
  }
}
