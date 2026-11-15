import logger from '@overleaf/logger'
import UserController from '../../../../../app/src/Features/User/UserController.mjs'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { store } from '../../../providers/index.mjs'
import OIDCAuthenticationController from './OIDCAuthenticationController.mjs'
import logout from '../../../logout.mjs'

/** Middleware: resolve `:providerId` to an enabled OIDC provider or 404. */
function requireOidcProvider(req, res, next) {
  const provider = store.get(req.params.providerId)
  if (!provider || provider.type !== 'oidc' || !provider.enabled) {
    return res.status(404).json({
      message: { type: 'error', text: 'Unknown SSO provider' },
    })
  }
  req.ssoProvider = provider
  next()
}

function loginWhitelistPaths() {
  const paths = []
  for (const provider of store.ofType('oidc')) {
    const id = encodeURIComponent(provider.id)
    paths.push(`/oidc/${id}/login`, `/oidc/${id}/login/callback`)
  }
  return paths
}

export default {
  apply(webRouter) {
    logger.debug({}, 'Init OIDC router')
    // rewrite logout route to ensure SSO logout is triggered
    // when user clicks logout button
    webRouter.stack = webRouter.stack.filter(layer => {
      return !(layer.route && layer.route.path === '/logout' && layer.route.methods.post)
    })

    // legacy single-provider route: keep working for existing deployments
    webRouter.get('/oidc/login', (req, res, next) => {
      const first = store.firstOfType('oidc')
      if (!first) {
        return res.status(404).json({
          message: { type: 'error', text: 'No OIDC provider configured' },
        })
      }
      req.ssoProvider = first
      return OIDCAuthenticationController.passportLogin(first)(req, res, next)
    })

    // multi-provider routes
    webRouter.get(
      '/oidc/:providerId/login',
      requireOidcProvider,
      (req, res, next) =>
        OIDCAuthenticationController.passportLogin(req.ssoProvider)(req, res, next)
    )
    webRouter.get(
      '/oidc/:providerId/login/callback',
      requireOidcProvider,
      (req, res, next) =>
        OIDCAuthenticationController.passportLoginCallback(req.ssoProvider)(req, res, next)
    )
    webRouter.get(
      '/oidc/:providerId/logout/callback',
      requireOidcProvider,
      (req, res, next) =>
        OIDCAuthenticationController.passportLogoutCallback(req.ssoProvider)(req, res, next)
    )

    for (const path of [...loginWhitelistPaths(), '/oidc/login']) {
      AuthenticationController.addEndpointToLoginWhitelist(path)
    }

    webRouter.post(
      '/user/oauth-unlink',
      AuthenticationController.requireLogin(),
      OIDCAuthenticationController.unlinkAccount
    )
    webRouter.post('/logout', logout, UserController.logout)

    // keep the login whitelist current when the admin adds providers
    store.onChange(() => {
      for (const path of loginWhitelistPaths()) {
        AuthenticationController.addEndpointToLoginWhitelist(path)
      }
    })
  },
}
