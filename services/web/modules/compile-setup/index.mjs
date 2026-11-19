import logger from '@overleaf/logger'

import Modules from '../../app/src/infrastructure/Modules.mjs'
import CompileSetupRouter from './app/src/CompileSetupRouter.mjs'
import CompileSetupStateManager from './app/src/CompileSetupStateManager.mjs'

// Drop the "compile settings confirmed" marker together with the project.
Modules.hooks.attach('projectExpired', async projectId => {
  try {
    await CompileSetupStateManager.removeProjectState(projectId)
  } catch (err) {
    logger.warn({ err, projectId }, 'failed to remove compile setup state')
  }
})

export default {
  router: CompileSetupRouter,
}
