import Path from 'path'
import { pipeline } from 'stream/promises'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import JsonWebToken from '../../../../app/src/infrastructure/JsonWebToken.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import ClsiManager from '../../../../app/src/Features/Compile/ClsiManager.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import {
  DOWNLOAD_AUDIENCE,
  buildCompileTools,
  compileUserId,
} from './CompileTools.mjs'
import { buildCommentTools } from './CommentTools.mjs'
import { buildChatTools } from './ChatTools.mjs'
import { buildFileTools } from './FileTools.mjs'
import { buildHistoryTools } from './HistoryTools.mjs'
import { buildProjectTools } from './ProjectTools.mjs'
import { buildTrackChangesTools } from './TrackChangesTools.mjs'
import { rateLimit } from './McpUtils.mjs'

// The router checked that the user can read the project
// overleaf-lab (issue #126, plan step 7 — AI identity layer): who exactly is
// "the MCP user"? The PAT owner's identity is already on every record (the
// web endpoints run as that user), so the remaining question is WHICH AGENT
// acted. Agents self-identify with the optional `X-MCP-Client` header (e.g.
// "cursor/1.4", "my-assistant/qwen3" — the harness MAY include its model
// name); the server also stamps a provenance marker onto version comments
// (see HistoryTools.create_version), and every tool call lands in a
// structured audit line below (MCP audit). Together: a human reviewing the
// history can tell agent activity apart from manual edits.
function clientIdentity(req) {
  const raw = req?.headers?.['x-mcp-client']
  if (typeof raw !== 'string') return 'mcp'
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80)
  return cleaned.length ? cleaned : 'mcp'
}

// overleaf-lab (issue #126, plan step 7): one structured audit line per tool
// call — tool, acting user, project, agent identity (X-MCP-Client), outcome,
// duration. Read tools at debug, mutating tools at info (that is the trail
// a reviewer greps for). Pure closure — no `this` — because the SDK's
// handler invocation is host-independent and a bound receiver broke it.
function auditedHandler(toolName, isMutating, ctx, wrapped) {
  return async function auditWrapper(...args) {
    const t0 = Date.now()
    let result
    let failure = null
    try {
      result = await wrapped(...args)
    } catch (err) {
      failure = err
    }
    try {
      const fields = {
        tool: toolName,
        userId: ctx.userId,
        projectId: ctx.projectId,
        client: ctx.client,
        mutating: isMutating,
        outcome: failure ? 'error' : 'ok',
        err: failure ? String(failure && failure.message || failure).slice(0, 200) : undefined,
        ms: Date.now() - t0,
      }
      if (failure) {
        // Also keep the original throwable identity intact: include the
        // underlying stack for operators (never breaks the MCP response
        // itself — the SDK re-throws `failure` below).
      }
      if (isMutating) {
        (typeof logger?.info === 'function' ? logger.info : () => {})(fields, 'MCP audit: tool call')
      } else {
        (typeof logger?.debug === 'function' ? logger.debug : () => {})(fields, 'MCP audit: tool call')
      }
    } catch (auditErr) {
      // auditing must NEVER take a tool call down
    }
    if (failure) throw failure
    return result
  }
}

function createServer(userId, projectId, client) {
  const server = new McpServer(
    { name: 'overleaf', version: '1.0.0' },
    {
      instructions:
        'This server works on one Overleaf project. Change it the way the ' +
        'user asks; otherwise prefer:\n' +
        '- edit_file and write_file for text edits, e.g. paragraphs, typos ' +
        'or answers to comments, above all while collaborators are online: ' +
        'the edits show live and merge with theirs. Then git pull the clone ' +
        'once the series of edits is done.\n' +
        '- git in the clone to compile or run scripts locally, add figures ' +
        'or other binary files, change many files at once, move or rename ' +
        'files: commit the batch and push once.\n' +
        'Push before switching from git to edit_file, and pull before ' +
        'switching back. Compile on Overleaf, then download the PDF. Keep ' +
        `the working directory organized as:\n` +
        `./${projectId}/  the git clone of the project, sources only\n` +
        './output.pdf  the downloaded PDF and other output files\n' +
        'Never download output files into the clone, and never commit them.\n'
        + 'If your harness supports the X-MCP-Client HTTP header, send it on '
        + 'every request (e.g. "cursor/1.4" or "my-assistant/qwen3"): it is '
        + 'recorded in the server audit trail and in version comments, so the '
        + 'project owner can tell agent activity apart from manual edits.',
    }
  )

  const context = { userId, projectId, client: client || 'mcp' }
  const tools = {
    ...buildProjectTools(context),
    ...buildCompileTools(context),
    ...buildFileTools(context),
    ...buildCommentTools(context),
    ...buildChatTools(context),
    ...buildHistoryTools(context),
    ...buildTrackChangesTools(context),
  }
  // overleaf-lab (issue #126, plan step 7): the mutating tools — their calls
  // are audited at info level with the agent identity attached.
  const MUTATING = new Set([
    'write_file', 'edit_file', 'delete_file', 'rename_file', 'move_file',
    'add_comment', 'reply_to_comment', 'edit_comment_message',
    'delete_comment_message', 'delete_comment', 'resolve_comment',
    'reopen_comment', 'send_chat_message', 'edit_chat_message',
    'delete_chat_message', 'create_version', 'delete_version_label',
    'restore_project_version', 'restore_file_version', 'accept_changes',
    'reject_changes', 'set_tracked_changes', 'update_settings', 'compile',
  ])
  const key = `${projectId}:${userId}`
  for (const [name, { rateLimiter, handler, ...config }] of Object.entries(tools)) {
    const limitedHandler = rateLimit(rateLimiter, key, handler)
    server.registerTool(name, config, auditedHandler(name, MUTATING.has(name), context, limitedHandler))
  }

  return server
}

async function handleRequest(req, res) {
  const server = createServer(
    req.oauth_user._id.toString(),
    req.params.project_id,
    clientIdentity(req)
  )
  // Stateless: a new server and transport for every request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}

function methodNotAllowed(req, res) {
  res.set('Allow', 'POST').status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  })
}

async function downloadOutputFile(req, res) {
  let link
  try {
    link = JsonWebToken.getDecoded(req.params.token)
  } catch (err) {
    return res.sendStatus(404)
  }
  const { projectId, userId, buildId, clsiServerId, file } = link
  if (link.aud !== DOWNLOAD_AUDIENCE || projectId !== req.params.project_id) {
    return res.sendStatus(404)
  }
  // the user may have lost access since the link was made
  const user = await UserGetter.promises.getUser(userId, { suspended: 1 })
  if (!user || user.suspended || !(await AuthorizationManager.promises.canUserReadProject(userId, projectId))) {
    return res.sendStatus(404)
  }

  let stream
  try {
    stream = await ClsiManager.promises.getOutputFileStream(
      projectId,
      compileUserId(userId),
      clsiServerId,
      buildId,
      file
    )
  } catch (err) {
    if (err instanceof Errors.OutputFileFetchFailedError) {
      logger.debug({ err, projectId, buildId, file }, 'MCP output file not found')
      return res.sendStatus(404)
    }
    throw err
  }
  res.attachment(Path.basename(file))
  await pipeline(stream, res)
}

export default {
  handleRequest: expressify(handleRequest),
  methodNotAllowed,
  downloadOutputFile: expressify(downloadOutputFile),
}
