import logger from '@overleaf/logger'
import UserController from '../../../../../app/src/Features/User/UserController.mjs'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import OIDCAuthenticationController from './OIDCAuthenticationController.mjs'
import logout from '../../../logout.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init OIDC router')
    // rewrite logout route to ensure SAML logout is triggered 
    // when user clicks logout button
    webRouter.stack = webRouter.stack.filter(layer => {
      return !(layer.route && layer.route.path === '/logout' && layer.route.methods.post)
    })
    webRouter.get('/oidc/login', OIDCAuthenticationController.passportLogin)
    AuthenticationController.addEndpointToLoginWhitelist('/oidc/login')
    webRouter.get('/oidc/login/callback', OIDCAuthenticationController.passportLoginCallback)
    AuthenticationController.addEndpointToLoginWhitelist('/oidc/login/callback')
    webRouter.get('/oidc/logout/callback', OIDCAuthenticationController.passportLogoutCallback)
    webRouter.post('/user/oauth-unlink', AuthenticationController.requireLogin(), OIDCAuthenticationController.unlinkAccount)
    webRouter.post('/logout', logout, UserController.logout)
  },
}
