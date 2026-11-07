import fs from 'node:fs/promises'
import Path from 'node:path'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

const TTL_MS = 60 * 1000

function scheduleCleanup(conversionId, ttlMs = TTL_MS) {
  const conversionOutputDir = Path.join(Settings.path.outputDir, conversionId)
  setTimeout(() => {
    fs.rm(conversionOutputDir, { recursive: true, force: true }).catch(err => {
      logger.warn(
        { err, conversionId, conversionOutputDir },
        'failed to clean up conversion output directory'
      )
    })
  }, ttlMs)
}

export default {
  TTL_MS,
  scheduleCleanup,
}
