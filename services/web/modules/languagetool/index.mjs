import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

let LanguageToolModule = {}
if (process.env.LANGUAGE_TOOL_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enable LanguageTool module')

  Settings.languageToolURL = process.env.LANGUAGE_TOOL_URL ||
    `http://${process.env.LANGUAGE_TOOL_HOST || 'languagetool'}:${process.env.LANGUAGE_TOOL_PORT || '8010'}`

  const { default: LanguageToolRouter } = await import('./app/src/LanguageToolRouter.mjs')

  LanguageToolModule = {
    router: LanguageToolRouter,
  }
}

export default LanguageToolModule
