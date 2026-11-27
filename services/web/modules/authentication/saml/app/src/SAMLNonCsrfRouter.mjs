import logger from '@overleaf/logger'
import translations from '../../../../../app/src/infrastructure/Translations.mjs'
import SAMLAuthenticationController from './SAMLAuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init SAML NonCsrfRouter')
    // this router runs before the language middleware, and a refused login
    // answers with a translated message
    webRouter.post(
      '/saml/login/callback',
      translations.setLangBasedOnDomainMiddleware,
      SAMLAuthenticationController.passportLoginCallback
    )
    webRouter.get ('/saml/logout/callback', SAMLAuthenticationController.passportLogoutCallback)
    webRouter.post('/saml/logout/callback', SAMLAuthenticationController.passportLogoutCallback)
  },
}
