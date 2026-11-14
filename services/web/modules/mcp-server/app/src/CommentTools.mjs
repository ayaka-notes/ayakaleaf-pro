import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import {
  checkAccess,
  filePath,
  person,
  queueDocUpdate,
  rateLimiters,
  text,
} from './McpUtils.mjs'
import { readDoc } from './FileTools.mjs'

// Comments are threads in chat, anchored to text by the ranges of a doc, as
// the review panel reads and changes them (modules/track-changes)

const threadId = zz
  .objectId()
  .describe('threadId returned by list_comments.')

const messageId = zz
  .objectId()
  .describe('id of the message, returned by list_comments.')

// The comments of every doc, with the edits not saved yet: the document
// updater only knows the docs open lately
async function getComments(projectId) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const docs = await DocstoreManager.promises.getAllRanges(projectId)
  return docs.flatMap(({ _id: docId, ranges }) =>
    (ranges?.comments ?? []).map(comment => ({ docId, comment }))
  )
}

// A message of a comment, with the thread it starts or answers
async function findMessage(projectId, threadId, messageId) {
  const thread = (await ChatApiHandler.promises.getThreads(projectId))[threadId]
  const message = thread?.messages.find(message => message.id === messageId)
  if (!message) throw new Error('Message not found, list_comments again')
  return { message, isFirst: thread.messages[0] === message }
}

async function findCommentDoc(projectId, id) {
  const found = (await getComments(projectId)).find(
    ({ comment }) => comment.op.t === id
  )
  if (!found) throw new Error(`Comment ${id} not found, list_comments again`)
  return found.docId
}

// Where the comment goes: text, found once in the content, or in context
function findCommented(content, path, commented, context) {
  const count = (haystack, needle) => haystack.split(needle).length - 1
  if (context == null) {
    const matches = count(content, commented)
    if (matches === 0) throw new Error(`text not found in ${path}, read_file again`)
    if (matches > 1) {
      throw new Error(`text appears ${matches} times in ${path}, give context`)
    }
    return content.indexOf(commented)
  }
  const matches = count(content, context)
  if (matches === 0) throw new Error(`context not found in ${path}, read_file again`)
  if (matches > 1) {
    throw new Error(`context appears ${matches} times in ${path}, give more of it`)
  }
  if (count(context, commented) !== 1) {
    throw new Error('text must appear exactly once in context')
  }
  return content.indexOf(context) + context.indexOf(commented)
}

// A comment range is an op of the doc, which the editor sends through
// real-time, at the version the position is from. Done once the doc has the
// range.
async function addCommentRange(projectId, docId, userId, op, v) {
  await queueDocUpdate(
    projectId,
    {
      doc: docId,
      op: [op],
      v,
      meta: { source: `mcp-${op.t}`, user_id: userId },
    },
    ranges => ranges?.comments?.some(comment => comment.op.t === op.t),
    'The comment could not be added, read_file and try again'
  )
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

  const checkCanComment = () =>
    checkAccess(
      AuthorizationManager.promises.canUserWriteOrReviewProjectContent,
      userId,
      projectId,
      'You cannot comment on this project'
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
                  id: message.id,
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
        await checkCanComment()
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

    add_comment: {
      rateLimiter: rateLimiters.addComment,
      description:
        'Comment on a piece of text of a file, as the editor does; the ' +
        "comment shows live in Overleaf, under the user's name. text must " +
        'appear exactly once in the latest content: read_file again when it ' +
        'is not found, and give context when it appears more than once.',
      inputSchema: {
        path: filePath,
        text: z.string().min(1).describe('The exact text to comment on.'),
        context: z
          .string()
          .optional()
          .describe(
            'A longer piece of the file around text, found once in it, when ' +
              'text alone appears more than once. Only text is commented.'
          ),
        content: z.string().min(1).describe('The comment.'),
      },
      handler: async ({ path, text: commented, context, content }) => {
        await checkCanComment()
        const { doc, content: docText, version } = await readDoc(projectId, path)
        const position = findCommented(docText, path, commented, context)
        // as the review panel: the thread first, then its range
        const id = new ObjectId().toString()
        const message = await ChatApiHandler.promises.sendComment(
          projectId,
          id,
          userId,
          content
        )
        const user = await UserInfoManager.promises.getPersonalInfo(userId)
        message.user = UserInfoController.formatPersonalInfo(user)
        EditorRealTimeController.emitToRoom(projectId, 'new-comment', id, message)
        await addCommentRange(
          projectId,
          doc._id.toString(),
          userId,
          { c: commented, p: position, t: id },
          version
        )
        return text({ threadId: id })
      },
    },

    edit_comment_message: {
      rateLimiter: rateLimiters.editCommentMessage,
      description:
        'Change the text of a message of a comment; only your own messages.',
      inputSchema: {
        threadId,
        messageId,
        content: z.string().min(1).describe('The new text of the message.'),
      },
      handler: async ({ threadId, messageId, content }) => {
        await checkCanComment()
        await findCommentDoc(projectId, threadId)
        const { message } = await findMessage(projectId, threadId, messageId)
        if (message.user_id !== userId) {
          throw new Error('You can only edit your own messages')
        }
        await ChatApiHandler.promises.editMessage(
          projectId,
          threadId,
          messageId,
          userId,
          content
        )
        EditorRealTimeController.emitToRoom(
          projectId,
          'edit-message',
          threadId,
          messageId,
          content
        )
        return text('Edited.')
      },
    },

    delete_comment_message: {
      rateLimiter: rateLimiters.deleteCommentMessage,
      description:
        'Delete a message of a comment. As in the review panel, deleting ' +
        'the first message deletes the whole comment.',
      inputSchema: { threadId, messageId },
      handler: async ({ threadId, messageId }) => {
        await checkCanComment()
        const docId = await findCommentDoc(projectId, threadId)
        const { message, isFirst } = await findMessage(
          projectId,
          threadId,
          messageId
        )
        if (isFirst) {
          await checkAccess(
            (userId, projectId) =>
              AuthorizationManager.promises.canUserDeleteOrResolveThread(
                userId,
                projectId,
                threadId
              ),
            userId,
            projectId,
            'You cannot delete this comment'
          )
          await ChatApiHandler.promises.deleteThread(projectId, threadId)
          EditorRealTimeController.emitToRoom(projectId, 'delete-thread', threadId)
          await DocumentUpdaterHandler.promises.deleteThread(
            projectId,
            docId,
            threadId,
            userId
          )
          return text('Deleted the comment.')
        }
        // reviewers delete only their own messages, as the review panel
        if (
          !(await AuthorizationManager.promises.canUserWriteProjectContent(
            userId,
            projectId
          ))
        ) {
          if (message.user_id !== userId) {
            throw new Error('You can only delete your own messages')
          }
        }
        await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)
        EditorRealTimeController.emitToRoom(
          projectId,
          'delete-message',
          threadId,
          messageId
        )
        return text('Deleted the message.')
      },
    },
  }
}
