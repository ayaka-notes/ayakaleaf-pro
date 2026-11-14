import { setTimeout } from 'timers/promises'
import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import RedisWrapper from '../../../../app/src/infrastructure/RedisWrapper.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'

export const filePath = zz
  .filepath()
  .describe('Path of the file in the project, e.g. "sections/intro.tex".')

export const version = z
  .number()
  .int()
  .min(0)
  .describe(
    'A version of the project history: fromVersion or toVersion of ' +
      'list_changes.'
  )

// Edits show live in Overleaf; the clone catches up with one pull per series
export const pullHint = projectId =>
  `If you cloned the project, git pull in ./${projectId}/ once this series ` +
  'of edits is done.'

// Who wrote, changed or resolved: name and email, as the editor shows them
export function person(user) {
  if (!user?.email) return null
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name ? `${name} <${user.email}>` : user.email
}

export function text(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

export async function checkAccess(canUser, userId, projectId, message) {
  if (!(await canUser(userId, projectId))) throw new Error(message)
}

// History, comments, tracked changes and chat are closed to the viewers who
// joined by link, as the editor routes block them
export async function checkNotRestricted(userId, projectId, message) {
  if (
    await AuthorizationManager.promises.isRestrictedUserForProject(
      userId,
      projectId
    )
  ) {
    throw new Error(message)
  }
}

// The queues of the document updater, as real-time's DocumentUpdaterManager
// fills them with the edits of the editor
const rclient = RedisWrapper.client('documentupdater')

// An op the editor sends through real-time: queue it for the document
// updater the way real-time does (DocumentUpdaterManager.queueChange), at the
// version it is from, so it moves with the edits made since. Done once
// done(ranges) holds for the doc.
export async function queueDocUpdate(projectId, update, done, failure) {
  await rclient.rpush(
    `PendingProjectUpdates:{${projectId}}`,
    JSON.stringify(update)
  )
  await rclient.rpush('pending-updates-list', projectId)
  for (let attempt = 0; attempt < 50; attempt++) {
    const { ranges } = await DocumentUpdaterHandler.promises.getDocument(
      projectId,
      update.doc,
      -1
    )
    if (done(ranges)) return
    await setTimeout(100)
  }
  throw new Error(failure)
}

// One per tool, as the editor routes have one per operation, by project and
// user. compile and get_compile_log take the limiters of POST
// /project/:id/compile and of the output files, by name and key: the editor
// and MCP count together
export const rateLimiters = {
  compileProjectHttp: new RateLimiter('compile-project-http', {
    points: 200,
    duration: 10 * 60,
  }),
  miscOutputDownload: new RateLimiter('misc-output-download', {
    points: 1000,
    duration: 60 * 60,
  }),
  getOutputFileLink: new RateLimiter('mcp-get-output-file-link', {
    points: 60,
    duration: 60,
  }),
  wordCount: new RateLimiter('mcp-word-count', {
    points: 30,
    duration: 60,
  }),
  getCloneInfo: new RateLimiter('mcp-get-clone-info', {
    points: 60,
    duration: 60,
  }),
  getSettings: new RateLimiter('mcp-get-settings', {
    points: 60,
    duration: 60,
  }),
  listVersions: new RateLimiter('mcp-list-versions', {
    points: 60,
    duration: 60,
  }),
  updateSettings: new RateLimiter('mcp-update-settings', {
    points: 30,
    duration: 60,
  }),
  listFiles: new RateLimiter('mcp-list-files', {
    points: 60,
    duration: 60,
  }),
  readFile: new RateLimiter('mcp-read-file', {
    points: 60,
    duration: 60,
  }),
  editFile: new RateLimiter('mcp-edit-file', {
    points: 30,
    duration: 60,
  }),
  writeFile: new RateLimiter('mcp-write-file', {
    points: 30,
    duration: 60,
  }),
  deleteFile: new RateLimiter('mcp-delete-file', {
    points: 30,
    duration: 60,
  }),
  listComments: new RateLimiter('mcp-list-comments', {
    points: 60,
    duration: 60,
  }),
  replyToComment: new RateLimiter('mcp-reply-to-comment', {
    points: 30,
    duration: 60,
  }),
  resolveComment: new RateLimiter('mcp-resolve-comment', {
    points: 30,
    duration: 60,
  }),
  reopenComment: new RateLimiter('mcp-reopen-comment', {
    points: 30,
    duration: 60,
  }),
  addComment: new RateLimiter('mcp-add-comment', {
    points: 30,
    duration: 60,
  }),
  editCommentMessage: new RateLimiter('mcp-edit-comment-message', {
    points: 30,
    duration: 60,
  }),
  deleteCommentMessage: new RateLimiter('mcp-delete-comment-message', {
    points: 30,
    duration: 60,
  }),
  listTrackedChanges: new RateLimiter('mcp-list-tracked-changes', {
    points: 60,
    duration: 60,
  }),
  acceptTrackedChanges: new RateLimiter('mcp-accept-tracked-changes', {
    points: 30,
    duration: 60,
  }),
  rejectTrackedChanges: new RateLimiter('mcp-reject-tracked-changes', {
    points: 30,
    duration: 60,
  }),
  listChanges: new RateLimiter('mcp-list-changes', {
    points: 60,
    duration: 60,
  }),
  diff: new RateLimiter('mcp-diff', {
    points: 60,
    duration: 60,
  }),
  createVersion: new RateLimiter('mcp-create-version', {
    points: 30,
    duration: 60,
  }),
  deleteVersion: new RateLimiter('mcp-delete-version', {
    points: 30,
    duration: 60,
  }),
  restoreFile: new RateLimiter('mcp-restore-file', {
    points: 30,
    duration: 60,
  }),
  restoreProject: new RateLimiter('mcp-restore-project', {
    points: 10,
    duration: 60,
  }),
  listChatMessages: new RateLimiter('mcp-list-chat-messages', {
    points: 60,
    duration: 60,
  }),
  // as the editor's send-chat-message
  sendChatMessage: new RateLimiter('mcp-send-chat-message', {
    points: 100,
    duration: 60,
  }),
  moveFile: new RateLimiter('mcp-move-file', {
    points: 30,
    duration: 60,
  }),
  createFolder: new RateLimiter('mcp-create-folder', {
    points: 30,
    duration: 60,
  }),
}

// RateLimiterMiddleware.rateLimit for a tool handler
export function rateLimit(rateLimiter, key, handler) {
  return async (...args) => {
    try {
      await rateLimiter.consume(key, 1, { method: 'userId' })
    } catch (err) {
      if (err instanceof Error) throw err
      throw new Error('Rate limit reached, please try again later')
    }
    return await handler(...args)
  }
}
