import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import PermissionsMiddleware from '../../../workbench/app/src/PermissionsMiddleware.mjs'
import FixErrorController from './FixErrorController.mjs'

export default {
  apply(webRouter) {
    webRouter.post(
      '/project/:Project_id/ai/fix-error',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      PermissionsMiddleware.requireErrorAssistantAccess,
      FixErrorController.fixError
    )
  },
}
