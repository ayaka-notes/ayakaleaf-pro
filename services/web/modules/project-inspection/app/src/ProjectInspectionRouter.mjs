import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import ProjectInspectionController from './ProjectInspectionController.mjs'

const analysisRateLimiter = new RateLimiter('project-inspection-analysis', {
  points: 6,
  duration: 60,
})

export default {
  apply(webRouter) {
    webRouter.post(
      '/project/:project_id/project-inspection/analyze',
      RateLimiterMiddleware.rateLimit(analysisRateLimiter, {
        params: ['project_id'],
      }),
      AuthorizationMiddleware.ensureUserCanReadProject,
      ProjectInspectionController.analyze
    )
  },
}
