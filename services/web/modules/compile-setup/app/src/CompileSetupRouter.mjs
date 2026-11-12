import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import CompileSetupController from './CompileSetupController.mjs'

export default {
  apply(webRouter) {
    webRouter.get(
      '/project/:Project_id/compile-setup',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      CompileSetupController.getStatus
    )

    webRouter.post(
      '/project/:Project_id/compile-setup',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      CompileSetupController.markCompleted
    )
  },
}
