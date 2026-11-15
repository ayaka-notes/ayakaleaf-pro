import logger from '@overleaf/logger'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import UserController from '../../../../../app/src/Features/User/UserController.mjs'
import { store } from '../../../providers/index.mjs'
import SAMLAuthenticationController from './SAMLAuthenticationController.mjs'
import logout from '../../../logout.mjs'

/** Middleware: resolve `:providerId` to an enabled SAML provider or 404. */
function requireSamlProvider(req, res, next) {
  const provider = store.get(req.params.providerId)
  if (!provider || provider.type !== 'saml' || !provider.enabled) {
    return res.status(404).json({
      message: { type: 'error', text: 'Unknown SSO provider' },
    })
  }
  req.ssoProvider = provider
  next()
}

function loginWhitelistPaths() {
  const paths = []
  for (const provider of store.ofType('saml')) {
    const id = encodeURIComponent(provider.id)
    paths.push(`/saml/${id}/login`, `/saml/${id}/login/callback`)
  }
  return paths
}

export default {
  apply(webRouter) {
    logger.debug({}, 'Init SAML router')
    // rewrite logout route to ensure SAML logout is triggered
    // when user clicks logout button
    webRouter.stack = webRouter.stack.filter(layer => {
      return !(layer.route && layer.route.path === '/logout' && layer.route.methods.post)
    })

    // legacy single-IdP routes: keep working for existing deployments
    webRouter.get('/saml/login', (req, res, next) => {
      const first = store.firstOfType('saml')
      if (!first) {
        return res.status(404).json({
          message: { type: 'error', text: 'No SAML IdP configured' },
        })
      }
      req.ssoProvider = first
      return SAMLAuthenticationController.passportLogin(first)(req, res, next)
    })
    webRouter.get('/saml/meta', (req, res) => {
      const first = store.firstOfType('saml')
      if (!first) {
        return res.status(404).json({
          message: { type: 'error', text: 'No SAML IdP configured' },
        })
      }
      return SAMLAuthenticationController.getSPMetadata(first)(req, res)
    })

    // multi-IdP routes
    webRouter.get(
      '/saml/:providerId/login',
      requireSamlProvider,
      (req, res, next) =>
        SAMLAuthenticationController.passportLogin(req.ssoProvider)(req, res, next)
    )
    webRouter.get(
      '/saml/:providerId/meta',
      requireSamlProvider,
      (req, res) =>
        SAMLAuthenticationController.getSPMetadata(req.ssoProvider)(req, res)
    )

    for (const path of [...loginWhitelistPaths(), '/saml/login', '/saml/meta']) {
      AuthenticationController.addEndpointToLoginWhitelist(path)
    }

    webRouter.post('/logout', logout, UserController.logout)

    // keep the login whitelist current when the admin adds IdPs
    store.onChange(() => {
      for (const path of loginWhitelistPaths()) {
        AuthenticationController.addEndpointToLoginWhitelist(path)
      }
    })
  },
}
