import fs from 'node:fs'
import os from 'node:os'
import Path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'
import pLimit from 'p-limit'
import tarFs from 'tar-fs'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import { fetchStream } from '@overleaf/fetch-utils'
import { MeteredStream } from '@overleaf/stream-utils'
import * as BuildStore from './BuildStore.js'
import { InvalidTarballError } from './Errors.js'
import { getIngressLabel, getProjectKey, validateFilename } from './utils.js'

// Same layout as OutputCacheManager.CACHE_SUBDIR in clsi.
const CLSI_OUTPUT_SUBDIR = 'generated-files'
// Errors from fs.link that mean "fall back to copying", everything else is unexpected.
const LINK_FALLBACK_ERRORS = ['EXDEV', 'EPERM', 'EMLINK', 'ENOTSUP', 'EACCES']

const limit = pLimit(Settings.ingest.concurrency)

/**
 * Number of enqueue jobs still running per build prefix. export-as-template
 * waits for this to drain before copying a build.
 *
 * @type {Map<string, number>}
 */
const inflight = new Map()

function track(prefix, delta) {
  const n = (inflight.get(prefix) || 0) + delta
  if (n <= 0) {
    inflight.delete(prefix)
  } else {
    inflight.set(prefix, n)
  }
}

/**
 * @param {string} prefix
 * @return {boolean}
 */
export function isInflight(prefix) {
  return inflight.has(prefix)
}

/**
 * @param {string} prefix
 * @param {number} timeoutMs
 * @return {Promise<boolean>} false when the timeout expired first
 */
export async function waitForBuild(prefix, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (inflight.has(prefix)) {
    if (Date.now() > deadline) return false
    await sleep(250)
  }
  return true
}

/**
 * @typedef {Object} EnqueueJob
 * @property {string} projectId
 * @property {string} [userId]
 * @property {string} buildId
 * @property {string} editorId
 * @property {Array<{path: string, size?: number, contentId?: string, ranges?: any[]}>} files
 * @property {string} downloadHost
 * @property {string} clsiServerId
 * @property {string} compileGroup
 * @property {Object} stats
 * @property {Object} timings
 * @property {Object} options
 */

/**
 * Accept a build notification from clsi. The files are copied in the
 * background; clsi only waits for the request to be acknowledged.
 *
 * @param {EnqueueJob} job
 * @return {string} build prefix
 */
export function enqueue(job) {
  const projectKey = getProjectKey(job.projectId, job.userId)
  const prefix = BuildStore.buildPrefix(
    projectKey,
    `${job.editorId}-${job.buildId}`
  )
  Metrics.count('clsi_cache_enqueue_files', job.files.length)
  track(prefix, 1)
  limit(() => processJob(job, projectKey, prefix))
    .catch(err => {
      logger.warn(
        {
          err,
          projectId: job.projectId,
          userId: job.userId,
          buildId: job.buildId,
        },
        'ingest of clsi build failed'
      )
    })
    .finally(() => track(prefix, -1))
  return prefix
}

async function processJob(job, projectKey, prefix) {
  const timer = new Metrics.Timer('clsi_cache_ingest_job')
  let pdfEntry
  for (const file of job.files) {
    try {
      validateFilename(file.path)
    } catch (err) {
      logger.warn({ err, path: file.path }, 'refusing to ingest output file')
      continue
    }
    try {
      await ingestFile(job, projectKey, prefix, file)
      if (file.path === 'output.pdf') pdfEntry = file
    } catch (err) {
      Metrics.inc('clsi_cache_ingest_failed', 1, {
        path: getIngressLabel(file.path),
      })
      logger.warn(
        {
          err,
          projectId: job.projectId,
          userId: job.userId,
          buildId: job.buildId,
          path: file.path,
        },
        'failed to ingest output file'
      )
    }
  }
  // The meta file is what web looks up first. Only write it once the PDF
  // is in place, so that a build is never listed without its PDF.
  if (pdfEntry) {
    await writeMeta(prefix, job, pdfEntry)
  }
  timer.done()
}

async function ingestFile(job, projectKey, prefix, file) {
  const key = `${prefix}/${file.path}`
  const label = getIngressLabel(file.path)

  if (Settings.path.localClsiOutputDir) {
    const src = Path.join(
      Settings.path.localClsiOutputDir,
      projectKey,
      CLSI_OUTPUT_SUBDIR,
      job.buildId,
      file.path
    )
    if (await importFromLocalDisk(src, key, label)) {
      await validateTarballIfNeeded(file.path, key)
      return
    }
    // Not on this host: the build ran on another clsi or expired already.
  }

  await downloadFromClsi(job, file, key, label)
  await validateTarballIfNeeded(file.path, key)
}

/**
 * Hard-link the output file into the cache when both live on the same
 * filesystem, copy it otherwise. Either way clsi can expire its copy
 * independently of ours.
 *
 * @return {Promise<boolean>} false when the file does not exist on disk
 */
async function importFromLocalDisk(src, key, label) {
  let stat
  try {
    stat = await fs.promises.stat(src)
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }

  if (BuildStore.isFsBackend) {
    const dst = BuildStore.fsPath(key)
    await fs.promises.mkdir(Path.dirname(dst), { recursive: true })
    try {
      await fs.promises.link(src, dst)
      Metrics.count('clsi_cache_ingress', stat.size, 1, {
        path: label,
        method: 'link',
      })
      return true
    } catch (err) {
      // Re-delivery of a build we already have.
      if (err.code === 'EEXIST') return true
      if (!LINK_FALLBACK_ERRORS.includes(err.code)) throw err
    }
  }

  await BuildStore.sendFile(key, src)
  Metrics.count('clsi_cache_ingress', stat.size, 1, {
    path: label,
    method: 'copy',
  })
  return true
}

async function downloadFromClsi(job, file, key, label) {
  const url = new URL(
    `/project/${job.projectId}${
      job.userId ? `/user/${job.userId}` : ''
    }/build/${job.buildId}/output/${file.path}`,
    job.downloadHost
  )
  const stream = await fetchStream(url, {
    signal: AbortSignal.timeout(Settings.ingest.downloadTimeoutMs),
  })
  const metered = new MeteredStream(Metrics, 'clsi_cache_ingress', {
    path: label,
    method: 'download',
  })
  stream.on('error', err => metered.destroy(err))
  await BuildStore.sendStream(key, stream.pipe(metered))
}

/**
 * clsi refuses tar-balls with too many entries or special files when
 * restoring a compile dir; drop them here so they are never served.
 */
async function validateTarballIfNeeded(path, key) {
  if (path !== 'output.tar.gz') return
  let n = 0
  let reason
  const tmpDir = await fs.promises.mkdtemp(
    Path.join(os.tmpdir(), 'clsi-cache-tar-')
  )
  try {
    const stream = await BuildStore.getObjectStream(key)
    await pipeline(
      stream,
      createGunzip(),
      tarFs.extract(tmpDir, {
        // Only inspect the headers, never write anything to disk.
        ignore(_, header) {
          if (reason) return true
          n++
          if (n > Settings.ingest.maxTarEntries) {
            reason = 'too many entries'
          } else if (header.type !== 'file' && header.type !== 'directory') {
            reason = `unexpected entry type ${header.type}`
          }
          return true
        },
      })
    )
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
  if (reason) {
    await BuildStore.deleteObject(key)
    throw new InvalidTarballError(reason, { key, entries: n })
  }
}

/**
 * Metadata web needs to build a compile response from the cache, see
 * tryGetLatestCompileResult in services/web/app/src/Features/Compile/ClsiCacheManager.mjs
 */
async function writeMeta(prefix, job, pdfEntry) {
  let { size } = pdfEntry
  if (size == null) {
    size = await BuildStore.getObjectSize(`${prefix}/output.pdf`)
  }
  await BuildStore.writeJSON(`${prefix}/${BuildStore.META_FILE}`, {
    ranges: pdfEntry.ranges,
    contentId: pdfEntry.contentId,
    size,
    clsiServerId: job.clsiServerId,
    compileGroup: job.compileGroup,
    options: job.options,
    stats: job.stats,
    timings: job.timings,
  })
}
