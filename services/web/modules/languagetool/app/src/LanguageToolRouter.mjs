import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import LanguageToolController from './LanguageToolController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init languagetool router')

    // POST /languagetool/check is a stateless grammar query (login required,
    // no server state changes). Exempt it from CSRF: long-lived editor tabs
    // hold the page's meta token, and after an in-flight (re-)login the
    // browser's session has rotated, so the stale token would 403 every
    // check even though the request is fully authenticated.
    if (webRouter.csrf && webRouter.csrf.disableDefaultCsrfProtection) {
      webRouter.csrf.disableDefaultCsrfProtection('/languagetool/check', 'POST')
    }

    // Authenticated endpoints
    webRouter.get(
      '/languagetool/languages',
      AuthenticationController.requireLogin(),
      LanguageToolController.getLanguages
    )

    webRouter.post(
      '/languagetool/check',
      AuthenticationController.requireLogin(),
      LanguageToolController.check
    )
  }
}
