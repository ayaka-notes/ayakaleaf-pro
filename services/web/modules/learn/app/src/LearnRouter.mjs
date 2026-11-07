import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import LearnProxyController from './LearnProxy.mjs'

export default {
  apply(webRouter) {
    if (!Settings.proxyLearn) {
      logger.debug({}, 'Learn proxy disabled via Settings.proxyLearn')
      return
    }

    // Mount the more specific sections first; the bare `/learn` mount is the
    // catch-all for the main namespace and the documentation home page. Each
    // mount strips its prefix so `req.baseUrl` identifies the wiki namespace.
    webRouter.use('/learn/how-to', LearnProxyController.learnPage)
    webRouter.use('/learn/latex', LearnProxyController.learnPage)
    webRouter.use('/learn', LearnProxyController.learnPage)
  },
}