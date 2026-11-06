import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { expressify } from '@overleaf/promise-utils'
import WorkbenchController from './WorkbenchController.mjs'
import PermissionsMiddleware from './PermissionsMiddleware.mjs'
import { isConfigured } from './WorkbenchAiClient.mjs'
import { resolveWorkbenchLane } from './LlmBridge.mjs'

export default {
  apply(webRouter) {
    // overleaf-lab (2026-11, BYO phase 1): aiAvailable is now PER-USER — the
    // assistant shows when the operator gateway is configured OR the logged-in
    // user can resolve an LLM lane (BYO row / site provider). Anonymous/
    // unprivileged visitors keep seeing no assistant, exactly as before.
    webRouter.use(
      '/project',
      expressify(async (req, res, next) => {
        let aiAvailable = isConfigured()
        if (!aiAvailable) {
          const userId = SessionManager.getLoggedInUserId(req.session)
          if (userId) {
            aiAvailable = Boolean(await resolveWorkbenchLane(userId))
          }
        }
        res.locals.ExposedSettings.aiAvailable = aiAvailable
        next()
      })
    )
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
