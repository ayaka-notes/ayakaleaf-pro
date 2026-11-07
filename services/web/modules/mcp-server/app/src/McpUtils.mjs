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
