import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import { randomBytes } from 'crypto'
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
    add_comment: {
      rateLimiter: rateLimiters.addComment,
      description:
        'Start a NEW comment thread in Overleaf with the given text; it '
        +
        'shows in the review panel under the Other comments section (not '
        +
        'anchored to text — the MCP server cannot insert the text-anchor '
        +
        'operation: for an anchored comment use list_comments on the file '
        +
        'and reply_to_comment, or anchor it in Overleaf). Use it for '
        +
        'project-wide questions or notes about a file.',
      inputSchema: {
        content: z.string().min(1).describe('The comment text.'),
      },
      handler: async ({ content }) => {
        await checkAccess(
          (userId, projectId) =>
            AuthorizationManager.promises.canUserWriteOrReviewProjectContent(
              userId,
              projectId
            ),
          userId,
          projectId,
          'You cannot comment on this project'
        )
        // same creation path as the panel: a fresh thread id, then the
        // first message (the chat service creates the thread on the first
        // message, exactly as the browser\'s post-thread-message does)
        const threadId = randomBytes(12).toString('hex')
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
        return text(
          `Comment started (thread ${threadId}, message ${String(
            message.id ?? message._id
          )}); it is live now — in the review panel's "Other comments" ` +
            'section and the chat pane. reply_to_comment continues it, '
          +
            'delete_comment removes it.'
        )
      },
    },
    edit_comment_message: {
      rateLimiter: rateLimiters.editComment,
      description:
        'Edit one message of a comment thread (list_comments gives the '
        +
        'thread id; the message id is the one the panel\'s editing shows, '
        +
        'the first message of a thread is the comment text).',
      inputSchema: {
        threadId,
        messageId: zz.objectId().describe('The message to edit.'),
        content: z.string().min(1).describe('The new text.'),
      },
      handler: async ({ threadId, messageId, content }) => {
        await checkAccess(
          (userId, projectId) =>
            AuthorizationManager.promises.canUserWriteOrReviewProjectContent(
              userId,
              projectId
            ),
          userId,
          projectId,
          'You cannot comment on this project'
        )
        await ChatApiHandler.promises.editMessage(
          projectId,
          String(threadId),
          String(messageId),
          userId,
          content
        )
        // same event as the web edit route (TrackChangesController.editMessage)
        EditorRealTimeController.emitToRoom(
          projectId,
          'edit-message',
          String(threadId),
          String(messageId),
          content
        )
        return text('Message edited; the review panel updated it live.')
      },
    },
    delete_comment_message: {
      rateLimiter: rateLimiters.deleteComment,
      description:
        'Delete one message of a comment thread. Editors delete any '
        +
        'message; reviewers only their own, like the review panel.',
      inputSchema: {
        threadId,
        messageId: zz.objectId().describe('The message to delete.'),
      },
      handler: async ({ threadId, messageId }) => {
        // same rule as the panel route: writers delete any message
        // (TrackChangesController.deleteMessage), non-writers only their
        // own
        if (
          !(await AuthorizationManager.promises.canUserWriteProjectContent(
            userId,
            projectId
          ))
        ) {
          const message = await ChatApiHandler.promises.getThreadMessage(
            projectId,
            String(threadId),
            String(messageId)
          )
          if (String(message?.user_id) !== String(userId)) {
            throw new Error('Only the author can delete this message')
          }
        }
        await ChatApiHandler.promises.deleteMessage(
          projectId,
          String(threadId),
          String(messageId)
        )
        EditorRealTimeController.emitToRoom(
          projectId,
          'delete-message',
          String(threadId),
          String(messageId)
        )
        return text('Message deleted.')
      },
    },
    delete_comment: {
      rateLimiter: rateLimiters.deleteComment,
      description:
        'Delete a whole comment thread and its anchor from the file '
        +
        '(the panel\'s delete comment).',
      inputSchema: { threadId },
      handler: async ({ threadId }) => {
        await checkAccess(
          (userId, projectId) =>
            AuthorizationManager.promises.canUserDeleteOrResolveThread(
              userId,
              projectId,
              String(threadId)
            ),
          userId,
          projectId,
          'You cannot delete this comment'
        )
        let docId = null
        try {
          docId = await findCommentDoc(projectId, String(threadId))
        } catch {
          // not anchored to a range — an "Other comments" thread: delete
          // the chat thread only (nothing in the docstore to clean)
        }
        await ChatApiHandler.promises.deleteThread(projectId, String(threadId))
        const user = await UserInfoManager.promises.getPersonalInfo(userId)
        if (docId) {
          EditorRealTimeController.emitToRoom(
            projectId,
            'delete-comment',
            docId,
            String(threadId),
            UserInfoController.formatPersonalInfo(user)
          )
          await DocumentUpdaterHandler.promises.deleteThread(
            projectId,
            docId,
            String(threadId),
            userId
          )
        }
        return text('Comment deleted.')
      },
    },
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
        const anchored = comments
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
                messages: (thread.messages || []).map(message => ({
                  author: person(message.user),
                  content: message.content,
                  timestamp: new Date(message.timestamp).toISOString(),
                })),
              }
            })
        // threads not anchored to a range show in the panel's "Other
        // comments" (the MCP add_comment creates those)
        const anchoredIds = new Set(anchored.map(c => c.threadId))
        const standalone = Object.entries(threads)
          .filter(([threadId]) => !anchoredIds.has(threadId))
          .filter(([, thread]) => includeResolved || !thread.resolved)
          .map(([threadId, thread]) => ({
            threadId,
            file: null,
            text: (thread.messages?.[0]?.content || '').slice(0, 200),
            resolved: Boolean(thread.resolved),
            ...(thread.resolved && {
              resolvedBy: person(thread.resolved_by_user),
            }),
            messages: (thread.messages || []).map(message => ({
              author: person(message.user),
              content: message.content,
              timestamp: new Date(message.timestamp).toISOString(),
            })),
          }))
        return text([...anchored, ...standalone])
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
