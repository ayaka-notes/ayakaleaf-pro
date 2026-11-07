import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { requireProjectAccess } from '../../../git-bridge/app/src/GitBridgeRouter.mjs'
import McpController from './McpController.mjs'
import { rateLimiters } from './McpUtils.mjs'

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    logger.debug({}, 'Init MCP server router')

    // One MCP server per project, for the users who can read it, as with
    // git clone. MCP clients send a Bearer token: on the public API router,
    // outside the CSRF protection of the web router
    publicApiRouter.post(
      '/project/:project_id/mcp',
      AuthenticationController.requireOauth('git_bridge'),
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
      McpController.downloadOutputFile
    )
  },
}
