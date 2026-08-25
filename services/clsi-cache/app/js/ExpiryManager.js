import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import * as BuildStore from './BuildStore.js'
import { isInflight } from './IngestManager.js'

let timer
let sweeping = false

export function init() {
  const { sweepIntervalMs } = Settings.expiry
  if (!sweepIntervalMs) return
  timer = setInterval(() => {
    sweep().catch(err => logger.warn({ err }, 'clsi-cache sweep failed'))
  }, sweepIntervalMs)
  timer.unref()
}

export function stop() {
  clearInterval(timer)
}

/**
 * Drop builds that are older than the expiry or beyond the per-project limit.
 * Templates are kept: they are tied to a template version and only replaced
 * when the template is published again.
 *
 * @return {Promise<{projects: number, deleted: number}>}
 */
export async function sweep() {
  if (sweeping) return { projects: 0, deleted: 0 }
  sweeping = true
  const { buildAgeMs, maxBuildsPerProject } = Settings.expiry
  const now = Date.now()
  let deleted = 0
  try {
    const projectKeys = await BuildStore.listProjectKeys()
    for (const projectKey of projectKeys) {
      const builds = await BuildStore.listBuilds(projectKey)
      for (const [index, build] of builds.entries()) {
        if (isInflight(build.prefix)) continue
        const expired = now - build.timestamp > buildAgeMs
        if (expired || index >= maxBuildsPerProject) {
          await BuildStore.deleteDirectory(build.prefix)
          deleted++
        }
      }
      if (builds.length > 0 && deleted > 0) {
        const remaining = await BuildStore.listBuilds(projectKey)
        if (remaining.length === 0) {
          await BuildStore.deleteDirectory(BuildStore.projectPrefix(projectKey))
        }
      }
    }
    Metrics.count('clsi_cache_expired_builds', deleted)
    logger.debug({ projects: projectKeys.length, deleted }, 'clsi-cache sweep')
    return { projects: projectKeys.length, deleted }
  } finally {
    sweeping = false
  }
}
