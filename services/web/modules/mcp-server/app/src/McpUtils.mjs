import { zz } from '../../../../app/src/infrastructure/Validation.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'

export const filePath = zz
  .filepath()
  .describe('Path of the file in the project, e.g. "sections/intro.tex".')

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
// overleaf-lab (2026-11-05, MCP plan): truncate long tool outputs so an MCP
// client never chokes on a megabyte diff/history; signal the cut.
export const MAX_TEXT_CHARS = 20000
export function limited(value, label = 'output', limit = MAX_TEXT_CHARS) {
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (str.length <= limit) return str
  return (
    str.slice(0, limit) +
    `\n\n[${label} truncated at ${limit} characters; ${str.length - limit} more. ` +
    'Narrow the request — fewer files or versions, a smaller limit — to see the rest.]'
  )
}
// overleaf-lab (2026-11-05, MCP plan): author line for chat messages and
// change lists, as the review panel shows them: "Name <email>" or email.
export function person(user) {
  if (!user?.email) return null
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name ? `${name} <${user.email}>` : user.email
}

export async function checkAccess(canUser, userId, projectId, message) {
  if (!(await canUser(userId, projectId))) throw new Error(message)
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
  // overleaf-lab (2026-11-05, MCP plan): batch-1 tools (issue #126)
  listChat: new RateLimiter('mcp-list-chat', {
    points: 60,
    duration: 60,
  }),
  sendChatMessage: new RateLimiter('mcp-send-chat-message', {
    points: 30,
    duration: 60,
  }),
  editChatMessage: new RateLimiter('mcp-edit-chat-message', {
    points: 30,
    duration: 60,
  }),
  deleteChatMessage: new RateLimiter('mcp-delete-chat-message', {
    points: 30,
    duration: 60,
  }),
  addComment: new RateLimiter('mcp-add-comment', {
    points: 30,
    duration: 60,
  }),
  editComment: new RateLimiter('mcp-edit-comment', {
    points: 30,
    duration: 60,
  }),
  deleteComment: new RateLimiter('mcp-delete-comment', {
    points: 30,
    duration: 60,
  }),
  listHistory: new RateLimiter('mcp-list-history', {
    points: 60,
    duration: 60,
  }),
  getDiff: new RateLimiter('mcp-get-diff', {
    points: 30,
    duration: 60,
  }),
  createVersion: new RateLimiter('mcp-create-version', {
    points: 10,
    duration: 60,
  }),
  deleteVersionLabel: new RateLimiter('mcp-delete-version-label', {
    points: 10,
    duration: 60,
  }),
  restoreProject: new RateLimiter('mcp-restore-project', {
    points: 5,
    duration: 60,
  }),
  restoreFileVersion: new RateLimiter('mcp-restore-file-version', {
    points: 5,
    duration: 60,
  }),
  listChanges: new RateLimiter('mcp-list-changes', {
    points: 60,
    duration: 60,
  }),
  acceptChanges: new RateLimiter('mcp-accept-changes', {
    points: 30,
    duration: 60,
  }),
  setTrackedChanges: new RateLimiter('mcp-set-tracked-changes', {
    points: 10,
    duration: 60,
  }),
  renameFile: new RateLimiter('mcp-rename-file', {
    points: 30,
    duration: 60,
  }),
  moveFile: new RateLimiter('mcp-move-file', {
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
