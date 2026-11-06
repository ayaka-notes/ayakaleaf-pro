import Path from 'path'
import { pipeline } from 'stream/promises'
import logger from '@overleaf/logger'
import { appendFile } from 'node:fs/promises'
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
// overleaf-lab (issue #126, plan step 7): one structured audit line per tool
// call — tool, acting user, project, agent identity (X-MCP-Client), outcome,
// duration. Durable channel: JSON line appended to mcp-audit.log (container
// log volume) plus stderr.
//
// IMPORTANT — the `@overleaf/logger` import must NOT be called from inside
// MCP transport handlers: in this context it throws ("reading 'info' of
// undefined") and, on some paths, hangs the request. appendFile + stderr are
// bulletproof and keep the audit decoupled from the pino setup.
const AUDIT_PATH = '/var/log/overleaf/mcp-audit.log'
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
      const line = JSON.stringify({
        audit: 'mcp',
        ts: new Date().toISOString(),
        tool: toolName,
        userId: ctx.userId,
        projectId: ctx.projectId,
        client: ctx.client,
        mutating: isMutating,
        outcome: failure ? 'error' : 'ok',
        err: failure ? String(failure && failure.message || failure).slice(0, 200) : undefined,
        ms: Date.now() - t0,
      })
      void appendFile(AUDIT_PATH, line + '\n').catch(() => {})
      process.stderr.write(line + '\n')
    } catch {
      // auditing must NEVER take a tool call down
    }
    if (failure) throw failure
    return result
  }
}

// overleaf-lab (2026-11-05, owner request): the MCP service groups — the
// SINGLE source of truth for (a) the admin settings listing + per-service
// on/off, and (b) registration in createServer below. Keys are stable ids
// (persisted in admin settings mcpServices); labels are UI text.
export const MCP_SERVICE_GROUPS = [
  { key: 'projects', label: 'Projects', build: buildProjectTools,
    description: 'See who is working in the project: collaborators (people with access rights) and the project settings — read-only lookups.' },
  { key: 'compile', label: 'Compile', build: buildCompileTools,
    description: 'Start an Overleaf compile, check its status, and download the resulting PDF or other output files through a time-limited secure link.' },
  { key: 'files', label: 'Files', build: buildFileTools,
    description: 'Work with project files: list, search, read, create, edit, rename, move and delete files. Edits are live (collaborators see them in real time).' },
  { key: 'comments', label: 'Comments', build: buildCommentTools,
    description: 'Manage margin comments and chat messages: read, create, reply, edit, resolve and delete — including the text ranges a comment is attached to.' },
  { key: 'chat', label: 'Chat', build: buildChatTools,
    description: 'Read and write the project chat (team messages), including replying to and resolving existing messages.' },
  { key: 'versions', label: 'Versions & history', build: buildHistoryTools,
    description: 'Version control: create and list version labels, inspect diffs and history, and restore a project or file to a previous version.' },
  { key: 'track_changes', label: 'Track changes', build: buildTrackChangesTools,
    description: 'Collaborative editing protocol: enable tracked changes, accept or reject pending change suggestions, and read the diff state of files.' },
]
const MCP_MUTATING_TOOLS = new Set([
  'write_file', 'edit_file', 'delete_file', 'rename_file', 'move_file',
  'add_comment', 'reply_to_comment', 'edit_comment_message',
  'delete_comment_message', 'delete_comment', 'resolve_comment',
  'reopen_comment', 'send_chat_message', 'edit_chat_message',
  'delete_chat_message', 'create_version', 'delete_version_label',
  'restore_project_version', 'restore_file_version', 'accept_changes',
  'reject_changes', 'set_tracked_changes', 'update_settings', 'compile',
])

// overleaf-lab (2026-11-05, owner request): list the AVAILABLE MCP services
// for the admin page (name, purpose, per-service on/off state). The builders
// are the single source of truth, so this can never drift from registration.
export function listMcpServices() {
  const context = { userId: 'list', projectId: 'list', client: 'list' }
  const out = []
  for (const g of MCP_SERVICE_GROUPS) {
    const { key, label, build } = g
    let tools = []
    try {
      tools = Object.entries(build(context) || {}).map(([name, def]) => ({
        name,
        description: typeof def?.description === 'string' ? def.description : '',
        mutating: MCP_MUTATING_TOOLS.has(name),
      }))
    } catch {
      // a broken builder must not take the listing down
    }
    out.push({ key, label, description: g.description || '', tools })

  }
  return out
}

function createServer(userId, projectId, client, disabledServices = []) {
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

  const context = { userId, projectId, client: client || 'mcp', disabledServices }
  // overleaf-lab (2026-11-05, owner request): services disabled via the
  // admin settings (mcpServices) are NOT registered at all — tools/list
  // therefore never shows them, and calls to them fail as unknown tools.
  const key = `${projectId}:${userId}`
  const disabled = new Set(context.disabledServices || [])
  for (const { key: serviceKey, build } of MCP_SERVICE_GROUPS) {
    if (disabled.has(serviceKey)) continue
    const defs = build(context) || {}
    for (const [name, { rateLimiter, handler, ...config }] of Object.entries(defs)) {
      const limitedHandler = rateLimit(rateLimiter, key, handler)
      server.registerTool(
        name,
        config,
        auditedHandler(name, MCP_MUTATING_TOOLS.has(name), context, limitedHandler),
      )
    }
  }

  return server
}

async function handleRequest(req, res) {
  // overleaf-lab (2026-11-05, owner request): per-service admin off-switches
  // (admin settings → MCP service, default all on). Computed in the gate
  // (McpRouter) where the admin settings are already read — attached to the
  // request, so no settings read here and no import cycle.
  const disabledServices = Array.isArray(req.mcpDisabledServices) ? req.mcpDisabledServices : []
  const server = createServer(
    req.oauth_user._id.toString(),
    req.params.project_id,
    clientIdentity(req),
    disabledServices
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
