import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { requireProjectAccess } from '../../../git-bridge/app/src/GitBridgeRouter.mjs'
import McpController from './McpController.mjs'
import { rateLimiters } from './McpUtils.mjs'
import { readAdminSettings } from '../../../llm/app/src/LLMAdminController.mjs' // overleaf-lab (2026-11-05): MCP service switch
import User from '../../../../app/src/models/User.mjs' // overleaf-lab (2026-11-05): per-user MCP override

// overleaf-lab (owner request 2026-11-05): MCP service governance gates.
// 1) site switch — from the LLM admin settings file (llmDisabledByAdmin
//    pattern): mcpEnabled === false -> 503 with a clear message.
// 2) per-user override — User.llmMcpEnabled false -> 403 for that user.
// Both are checked on the tool-call endpoint AND on the download-token
// endpoint (same service, same governance).
async function mcpServiceGate(req, res, next) {
  try {
    const settings = readAdminSettings()
    const siteOff = settings.mcpEnabled === false
    const userId = req.auth && req.auth.userId
    let override = null
    if (userId) {
      const doc = await User.findOne({ _id: userId }).select('llmMcpEnabled')
      if (doc && (doc.llmMcpEnabled === true || doc.llmMcpEnabled === false)) {
        override = doc.llmMcpEnabled === true ? 'allow' : 'deny'
      }
    }
    if (siteOff) {
      // per-user forced allow ("Allow (override site off)") still passes
      if (override !== 'allow') {
        res.status(503).json({
          error: 'mcp_disabled',
          message: 'The MCP service is disabled by the site administrator.',
        })
        return
      }
    } else if (override === 'deny') {
      res.status(403).json({
        error: 'mcp_user_disabled',
        message: 'MCP access has been disabled for your account by the site administrator.',
      })
      return
    }
    next()
  } catch (err) {
    // fail OPEN for the gate itself (the auth+project checks below still apply)
    logger.debug({ err }, 'MCP service gate failed (allowing; downstream checks apply)')
    next()
  }
}

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    logger.debug({}, 'Init MCP server router')

    // One MCP server per project, for the users who can read it, as with
    // git clone. MCP clients send a Bearer token: on the public API router,
    // outside the CSRF protection of the web router
    publicApiRouter.post(
      '/project/:project_id/mcp',
      AuthenticationController.requireOauth('git_bridge'),
      mcpServiceGate, // overleaf-lab (2026-11-05): site switch + per-user override
      requireProjectAccess(AuthorizationManager.promises.canUserReadProject),
      McpController.handleRequest
    )
    // Stateless server: no stream to open and no session to delete
    publicApiRouter.get('/project/:project_id/mcp', McpController.methodNotAllowed)
    publicApiRouter.delete('/project/:project_id/mcp', McpController.methodNotAllowed)

    // Links handed out by get_output_file_link, the token authorizes them
    publicApiRouter.get(
      '/project/:project_id/mcp/download/:token',
      RateLimiterMiddleware.rateLimit(rateLimiters.miscOutputDownload, {
        params: ['project_id'],
      }),
      mcpServiceGate, // overleaf-lab (2026-11-05): same service, same governance
      McpController.downloadOutputFile
    )
  },
}
