import { expressify } from '@overleaf/promise-utils'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import WorkbenchController from './WorkbenchController.mjs'
import PermissionsMiddleware, { getAiAccess } from './PermissionsMiddleware.mjs'
import { isConfigured } from './WorkbenchAiClient.mjs'

export default {
  apply(webRouter) {
    webRouter.use('/project', (req, res, next) => {
      res.locals.ExposedSettings.aiAvailable = isConfigured()
      next()
    })
    // No tab in the rail for a user without AI. The editor's routes, as in
    // core's router, which comes after the modules
    for (const route of [
      '/Project/:Project_id',
      '/Project/:Project_id/:detachRole(detacher|detached)',
    ]) {
      webRouter.get(
        route,
        expressify(async (req, res, next) => {
          const { chat } = await getAiAccess(
            SessionManager.getLoggedInUserId(req.session)
          )
          if (!chat) res.locals.ExposedSettings.aiAvailable = false
          next()
        })
      )
    }
    webRouter.get(
      '/workbench/access',
      AuthenticationController.requireLogin(),
      WorkbenchController.getAccess
    )
    // Workbench AI chat (Vercel AI SDK useChat endpoint). The global JSON body
    // parser (12 MB by default) handles the UI-message history payload.
    webRouter.post(
      '/workbench/chat',
      AuthenticationController.requireLogin(),
      PermissionsMiddleware.requireAiAccess,
      WorkbenchController.chat
    )
  },
}
