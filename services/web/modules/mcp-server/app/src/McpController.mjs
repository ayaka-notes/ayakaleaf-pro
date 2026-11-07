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
import { buildFileTools } from './FileTools.mjs'
import { buildProjectTools } from './ProjectTools.mjs'
import { rateLimit } from './McpUtils.mjs'

// The router checked that the user can read the project
function createServer(userId, projectId) {
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
        'Never download output files into the clone, and never commit them.',
    }
  )

  const context = { userId, projectId }
  const tools = {
    ...buildProjectTools(context),
    ...buildCompileTools(context),
    ...buildFileTools(context),
    ...buildCommentTools(context),
  }
  const key = `${projectId}:${userId}`
  for (const [name, { rateLimiter, handler, ...config }] of Object.entries(tools)) {
    server.registerTool(name, config, rateLimit(rateLimiter, key, handler))
  }

  return server
}

async function handleRequest(req, res) {
  const server = createServer(
    req.oauth_user._id.toString(),
    req.params.project_id
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
