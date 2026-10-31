import logger from '@overleaf/logger'
import TexAutoformatterController from './TexAutoformatterController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init tex-autoformatter router')

    webRouter.post(
      '/api/format-tex',
      AuthenticationController.requireLogin(),
      TexAutoformatterController.formatTex
    )
  },
}
