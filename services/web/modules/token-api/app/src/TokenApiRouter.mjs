import logger from '@overleaf/logger'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import tokenProjectAccess, {
  tokenThreadResolveAccess,
} from './TokenApiAuthMiddleware.mjs'
import TokenApiController from './TokenApiController.mjs'

const rateLimiter = new RateLimiter('token-api', { points: 60, duration: 60 })

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    logger.debug({}, 'Init token-api router')

    const guard = [
      RateLimiterMiddleware.rateLimit(rateLimiter, { ipOnly: true }),
      tokenProjectAccess,
    ]

    // API documentation (this module's README); no token needed.
    publicApiRouter.get(
      '/api/v1',
      RateLimiterMiddleware.rateLimit(rateLimiter, { ipOnly: true }),
      TokenApiController.docs
    )
    publicApiRouter.get(
      '/api/v1/project/:project_id/ranges',
      ...guard,
      TokenApiController.getRanges
    )
    publicApiRouter.get(
      '/api/v1/project/:project_id/threads',
      ...guard,
      TokenApiController.getThreads
    )
    publicApiRouter.post(
      '/api/v1/project/:project_id/comments',
      ...guard,
      TokenApiController.createComment
    )
    publicApiRouter.post(
      '/api/v1/project/:project_id/thread/:thread_id/messages',
      ...guard,
      TokenApiController.sendMessage
    )
    publicApiRouter.post(
      '/api/v1/project/:project_id/doc/:doc_id/thread/:thread_id/resolve',
      ...guard,
      tokenThreadResolveAccess,
      TokenApiController.resolveThread
    )
    publicApiRouter.post(
      '/api/v1/project/:project_id/doc/:doc_id/thread/:thread_id/reopen',
      ...guard,
      tokenThreadResolveAccess,
      TokenApiController.reopenThread
    )
  },
}
