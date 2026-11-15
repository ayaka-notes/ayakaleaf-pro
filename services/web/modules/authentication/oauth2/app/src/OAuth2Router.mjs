import logger from '@overleaf/logger'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { store } from '../../../providers/index.mjs'
import OAuth2AuthenticationController from './OAuth2AuthenticationController.mjs'
/** Middleware: resolve `:providerId` to an enabled OAuth2 provider or 404. */
function requireOauth2Provider(req, res, next) {
  const provider = store.get(req.params.providerId)
  if (!provider || provider.type !== 'oauth2' || !provider.enabled) {
    return res.status(404).json({
      message: { type: 'error', text: 'Unknown SSO provider' },
    })
  }
  req.ssoProvider = provider
  next()
}
function loginWhitelistPaths() {
  const paths = []
  for (const provider of store.ofType('oauth2')) {
    const id = encodeURIComponent(provider.id)
    paths.push(`/oauth2/${id}/login`, `/oauth2/${id}/login/callback`)
  }
  return paths
}
export default {
  apply(webRouter) {
    logger.debug({}, 'Init OAuth2 router')
    webRouter.get(
      '/oauth2/:providerId/login',
      requireOauth2Provider,
      (req, res, next) =>
        OAuth2AuthenticationController.passportLogin(req.ssoProvider)(req, res, next)
    )
    webRouter.get(
      '/oauth2/:providerId/login/callback',
      requireOauth2Provider,
      (req, res, next) =>
        OAuth2AuthenticationController.passportLoginCallback(req.ssoProvider)(req, res, next)
    )
    for (const path of loginWhitelistPaths()) {
      AuthenticationController.addEndpointToLoginWhitelist(path)
    }
    // keep the login whitelist current when the admin adds providers
    store.onChange(() => {
      for (const path of loginWhitelistPaths()) {
        AuthenticationController.addEndpointToLoginWhitelist(path)
      }
    })
  },
}
