import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs' 

// Middleware to ensure the user can manage templates
async function ensureUserCanManageTemplates(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const isAdminOrTemplateOwner =
    (await AuthorizationManager.promises.isUserSiteAdmin(userId)) ||
    Settings.templates?.user_id === userId

  if (isAdminOrTemplateOwner) {
    return next()
  }
  
  HttpErrorHandler.forbidden(req, res)
}

export default {
  ensureUserCanManageTemplates: expressify(ensureUserCanManageTemplates),
}