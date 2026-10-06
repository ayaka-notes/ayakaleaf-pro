import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import ErrorAssistantController from './ErrorAssistantController.mjs'
import PermissionsMiddleware from '../../../workbench/app/src/PermissionsMiddleware.mjs'

export default {
  apply(webRouter) {
    // AI "suggest fix" for a single compile error. Streams a custom SSE.
    webRouter.post(
      '/project/:Project_id/suggest-fix',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      PermissionsMiddleware.requireErrorAssistantAccess,
      ErrorAssistantController.suggestFix
    )
  },
}
