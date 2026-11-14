import logger from '@overleaf/logger'
import { store } from '../../../providers/index.mjs'
import translations from '../../../../../app/src/infrastructure/Translations.mjs'
import SAMLAuthenticationController from './SAMLAuthenticationController.mjs'

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

export default {
  apply(webRouter) {
    logger.debug({}, 'Init SAML NonCsrfRouter')
    // this router runs before the language middleware, and a refused login
    // answers with a translated message
    // legacy single-IdP callback routes
    webRouter.post('/saml/login/callback', translations.setLangBasedOnDomainMiddleware, (req, res, next) => {
      const first = store.firstOfType('saml')
      if (!first) {
        return res.status(404).json({
          message: { type: 'error', text: 'No SAML IdP configured' },
        })
      }
      req.ssoProvider = first
      return SAMLAuthenticationController.passportLoginCallback(first)(req, res, next)
    })
    webRouter.get('/saml/logout/callback', (req, res, next) => {
      const first = store.firstOfType('saml')
      if (!first) {
        return res.status(404).json({
          message: { type: 'error', text: 'No SAML IdP configured' },
        })
      }
      req.ssoProvider = first
      return SAMLAuthenticationController.passportLogoutCallback(first)(req, res, next)
    })
    webRouter.post('/saml/logout/callback', (req, res, next) => {
      const first = store.firstOfType('saml')
      if (!first) {
        return res.status(404).json({
          message: { type: 'error', text: 'No SAML IdP configured' },
        })
      }
      req.ssoProvider = first
      return SAMLAuthenticationController.passportLogoutCallback(first)(req, res, next)
    })
    // multi-IdP callback routes
    webRouter.post(
      '/saml/:providerId/login/callback',
      translations.setLangBasedOnDomainMiddleware,
      requireSamlProvider,
      (req, res, next) =>
        SAMLAuthenticationController.passportLoginCallback(req.ssoProvider)(req, res, next)
    )
    webRouter.get(
      '/saml/:providerId/logout/callback',
      requireSamlProvider,
      (req, res, next) =>
        SAMLAuthenticationController.passportLogoutCallback(req.ssoProvider)(req, res, next)
    )
    webRouter.post(
      '/saml/:providerId/logout/callback',
      requireSamlProvider,
      (req, res, next) =>
        SAMLAuthenticationController.passportLogoutCallback(req.ssoProvider)(req, res, next)
    )
  },
}
