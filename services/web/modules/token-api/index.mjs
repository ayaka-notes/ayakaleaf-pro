import logger from '@overleaf/logger'
import TokenApiRouter from './app/src/TokenApiRouter.mjs'

let TokenApiModule = {}

// Tokens are git-bridge personal access tokens, so the API only exists with the git bridge.
if (process.env.GIT_BRIDGE_ENABLED === 'true') {
  logger.debug({}, 'Enabling token-api module')
  TokenApiModule = {
    router: TokenApiRouter,
  }
}

export default TokenApiModule
