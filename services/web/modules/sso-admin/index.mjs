import logger from '@overleaf/logger'
import AuthorizationMiddleware from '../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import { store } from '../authentication/providers/index.mjs'
import { getPassport } from '../authentication/providers/passport.mjs'
import SsoAdminController from './app/src/SsoAdminController.mjs'

/**
 * Re-register passport strategies + login buttons after an admin change.
 */
async function refreshStrategies() {
  const passport = getPassport()
  if (!passport) return
  try {
    const { default: OIDCModuleManager } = await import(
      '../authentication/oidc/app/src/OIDCModuleManager.mjs'
    )
    const { default: SAMLModuleManager } = await import(
      '../authentication/saml/app/src/SAMLModuleManager.mjs'
    )
    OIDCModuleManager.refreshStrategies(passport)
    SAMLModuleManager.refreshStrategies(passport)
  } catch (error) {
    logger.error({ err: error }, 'failed to refresh SSO passport strategies')
  }
}

const router = {
  apply(webRouter) {
    const ensureAdmin = AuthorizationMiddleware.ensureUserIsSiteAdmin
    // pages
    webRouter.get('/admin/auths', ensureAdmin, SsoAdminController.indexPage)
    webRouter.get('/admin/auths/new', ensureAdmin, SsoAdminController.newPage)
    webRouter.get(
      '/admin/auths/:id/edit',
      ensureAdmin,
      SsoAdminController.editPage
    )
    // api (form posts from the admin page, or JSON)
    webRouter.post(
      '/admin/auths/validate',
      ensureAdmin,
      SsoAdminController.validate
    )
    webRouter.post('/admin/auths', ensureAdmin, SsoAdminController.create)
    webRouter.post(
      '/admin/auths/:id',
      ensureAdmin,
      SsoAdminController.update
    )
    webRouter.post(
      '/admin/auths/:id/toggle',
      ensureAdmin,
      SsoAdminController.toggle
    )
    webRouter.post(
      '/admin/auths/:id/delete',
      ensureAdmin,
      SsoAdminController.remove
    )
    webRouter.get('/admin/auths/catalog', ensureAdmin, SsoAdminController.catalog)
  },
}

// Live re-registration of passport strategies when providers change
store.onChange(() => {
  refreshStrategies()
})

const ssoAdminModule = {
  name: 'sso-admin',
  router,
}
export default ssoAdminModule
