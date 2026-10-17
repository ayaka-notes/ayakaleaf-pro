import crypto from 'node:crypto'
import Path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import { MeteredStream } from '@overleaf/stream-utils'
import { z, zz, parseReq } from '@overleaf/validation-tools'
import * as BuildStore from './BuildStore.js'
import * as IngestManager from './IngestManager.js'
import { NotFoundError } from './Errors.js'
import {
  BUILD_ID_REGEX,
  EDITOR_BUILD_ID_REGEX,
  PROJECT_ID_REGEX,
  generateBuildId,
  getIngressLabel,
  getProjectKey,
  validateFilename,
} from './utils.js'

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.log': 'text/plain; charset=utf-8',
  '.blg': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.gz': 'application/gzip',
}

// ---- schemas ---------------------------------------------------------------

const projectParamsSchema = z.object({
  project_id: z.string().regex(PROJECT_ID_REGEX),
  user_id: zz.objectId().optional(),
})

const fileParamsSchema = projectParamsSchema.extend({
  filename: zz.filepath(),
})

const buildFileParamsSchema = fileParamsSchema.extend({
  editor_build_id: z.string().regex(EDITOR_BUILD_ID_REGEX),
})

const enqueueSchema = z.object({
  body: z.object({
    projectId: z.string().regex(PROJECT_ID_REGEX),
    userId: zz.objectId().nullish(),
    buildId: z.string().regex(BUILD_ID_REGEX),
    editorId: z.string().regex(/^[a-f0-9-]{36}$/),
    files: z.array(
      z.object({
        path: zz.filepath(),
        size: z.number().int().nonnegative().optional(),
        contentId: z.string().optional(),
        ranges: z.array(z.any()).optional(),
      })
    ),
    downloadHost: z.string().url(),
    clsiServerId: z.string(),
    compileGroup: z.string().optional(),
    stats: z.record(z.string(), z.any()).optional(),
    timings: z.record(z.string(), z.any()).optional(),
    options: z.record(z.string(), z.any()).optional(),
  }),
})

const importFromSchema = z.object({
  params: z.object({
    project_id: zz.objectId(),
    user_id: zz.objectId(),
  }),
  body: z.object({
    sourceProjectId: zz.objectId().optional(),
    lastUpdated: z.union([z.string(), z.number()]).nullish(),
    templateVersionId: z.string().min(1).optional(),
    imageName: z.string().min(1).optional(),
  }),
})

const exportAsTemplateSchema = z.object({
  params: z.object({
    submission_id: z.string().regex(PROJECT_ID_REGEX),
    editor_build_id: z.string().regex(EDITOR_BUILD_ID_REGEX),
  }),
  body: z.object({
    templateVersionId: z.string().min(1),
    imageName: z.string().min(1),
  }),
})

// ---- helpers ---------------------------------------------------------------

function selfUrl(req) {
  return Settings.publicUrl || `${req.protocol}://${req.get('host')}`
}

/**
 * Headers web reads in getRedirectWithFallback (ClsiCacheHandler.mjs).
 */
function setLookupHeaders(res, build, size) {
  const allFiles = JSON.stringify(build.files)
  res.set(
    'X-All-Files',
    // Header values must be ASCII, .blg files may carry custom names.
    /^[\x20-\x7e]*$/.test(allFiles)
      ? allFiles
      : Buffer.from(allFiles).toString('base64url')
  )
  res.set('X-Last-Modified', new Date(build.timestamp).toISOString())
  res.set('X-Content-Length', String(size))
  res.set('X-Shard', Settings.shard)
  res.set('X-Zone', Settings.zone)
}

/**
 * Answer a lookup with a redirect to the file. Object stores hand out signed
 * urls; with the fs backend the file is served by this instance. web parses
 * editorId/buildId back out of the "/build/<editorId>-<buildId>/" path segment.
 */
async function redirectToBuildFile(req, res, projectId, userId, build, filename) {
  const key = `${build.prefix}/${filename}`
  const size = await BuildStore.getObjectSize(key)
  const location =
    (await BuildStore.getRedirectUrl(key)) ||
    `${selfUrl(req)}/project/${projectId}${
      userId ? `/user/${userId}` : ''
    }/build/${build.editorBuildId}/output/${filename}`
  setLookupHeaders(res, build, size)
  res.redirect(302, location)
}

/**
 * @param {string|undefined} header
 * @param {number} size
 * @return {{start: number, end: number}|null}
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '')
  if (!match || (match[1] === '' && match[2] === '')) return null
  let start, end
  if (match[1] === '') {
    // suffix range: the last N bytes
    start = Math.max(0, size - parseInt(match[2], 10))
    end = size - 1
  } else {
    start = parseInt(match[1], 10)
    end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1)
  }
  if (start > end || start >= size) return null
  return { start, end }
}

// ---- handlers --------------------------------------------------------------

export async function enqueue(req, res) {
  const { body } = parseReq(req, enqueueSchema)
  IngestManager.enqueue(body)
  res.sendStatus(204)
}

export async function getLatestOutputFile(req, res) {
  const {
    params: { project_id: projectId, user_id: userId, filename },
  } = parseReq(req, z.object({ params: fileParamsSchema }))
  validateFilename(filename)
  const projectKey = getProjectKey(projectId, userId)
  const build = await BuildStore.findLatestBuild(projectKey, filename)
  if (!build) throw new NotFoundError('nothing cached', { projectKey })
  await redirectToBuildFile(req, res, projectId, userId, build, filename)
}

export async function getBuildOutputFile(req, res) {
  const {
    params: {
      project_id: projectId,
      user_id: userId,
      editor_build_id: editorBuildId,
      filename,
    },
  } = parseReq(req, z.object({ params: buildFileParamsSchema }))
  validateFilename(filename)
  const projectKey = getProjectKey(projectId, userId)
  const build = await BuildStore.findBuild(projectKey, editorBuildId, filename)
  if (!build) {
    throw new NotFoundError('build not cached', { projectKey, editorBuildId })
  }
  await redirectToBuildFile(req, res, projectId, userId, build, filename)
}

/**
 * Serve a file. This is where the redirects from the lookups point to
 * when the persistor cannot hand out urls itself.
 */
export async function streamOutputFile(req, res) {
  const {
    params: {
      project_id: projectId,
      user_id: userId,
      editor_build_id: editorBuildId,
      filename,
    },
  } = parseReq(req, z.object({ params: buildFileParamsSchema }))
  validateFilename(filename)
  const key = `${BuildStore.buildPrefix(
    getProjectKey(projectId, userId),
    editorBuildId
  )}/${filename}`

  const size = await BuildStore.getObjectSize(key)
  const range = parseRange(req.headers.range, size)
  const stream = await BuildStore.getObjectStream(key, range || {})

  res.set('Accept-Ranges', 'bytes')
  res.set(
    'Content-Type',
    CONTENT_TYPES[Path.extname(filename)] || 'application/octet-stream'
  )
  if (range) {
    res.status(206)
    res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    res.set('Content-Length', String(range.end - range.start + 1))
  } else {
    res.set('Content-Length', String(size))
  }

  try {
    await pipeline(
      stream,
      new MeteredStream(Metrics, 'clsi_cache_egress', {
        path: getIngressLabel(filename),
      }),
      res
    )
  } catch (err) {
    if (req.destroyed || res.headersSent) {
      // The client went away mid-transfer, nothing left to report.
      logger.debug({ err, key }, 'output file transfer interrupted')
      return
    }
    throw err
  }
}

export async function clearProject(req, res) {
  const {
    params: { project_id: projectId, user_id: userId },
  } = parseReq(req, z.object({ params: projectParamsSchema }))
  const projectKey = getProjectKey(projectId, userId)
  await BuildStore.deleteDirectory(BuildStore.projectPrefix(projectKey))
  res.sendStatus(204)
}

/**
 * Seed the cache of a new project from another project or a template.
 * See prepareCacheSource in services/web/app/src/Features/Compile/ClsiCacheHandler.mjs
 */
export async function importFrom(req, res) {
  const {
    params: { project_id: projectId, user_id: userId },
    body: { sourceProjectId, lastUpdated, templateVersionId, imageName },
  } = parseReq(req, importFromSchema)

  let sourcePrefix
  if (sourceProjectId) {
    // Both projects belong to the same user, so look at their per-user compile
    // first; fall back to a shared compile of the source project.
    const build =
      (await BuildStore.findLatestBuild(
        getProjectKey(sourceProjectId, userId),
        'output.tar.gz'
      )) ||
      (await BuildStore.findLatestBuild(sourceProjectId, 'output.tar.gz'))
    if (!build) {
      throw new NotFoundError('source project not cached', { sourceProjectId })
    }
    // Never seed a new project from an outdated build of the source project:
    // the copy would pass the up-to-date check of the new project.
    if (lastUpdated != null && build.timestamp < new Date(lastUpdated).getTime()) {
      throw new NotFoundError('source build is stale', {
        sourceProjectId,
        buildId: build.buildId,
      })
    }
    sourcePrefix = build.prefix
  } else if (templateVersionId && imageName) {
    sourcePrefix = BuildStore.templatePrefix(
      templateVersionId,
      Path.basename(imageName)
    )
    const files = await BuildStore.listFiles(sourcePrefix)
    if (!files.includes('output.tar.gz')) {
      throw new NotFoundError('template not cached', {
        templateVersionId,
        imageName,
      })
    }
  } else {
    return res.status(400).json({ error: 'missing source' })
  }

  // The copy is a fresh build of the new project: stamped now, so that it is
  // newer than the project record created a moment ago.
  const editorBuildId = `${crypto.randomUUID()}-${generateBuildId()}`
  const dstPrefix = BuildStore.buildPrefix(
    getProjectKey(projectId, userId),
    editorBuildId
  )
  const files = await BuildStore.copyPrefix(sourcePrefix, dstPrefix)
  Metrics.inc('clsi_cache_import', 1, {
    source: sourceProjectId ? 'project' : 'template',
  })
  logger.debug(
    { projectId, userId, sourcePrefix, editorBuildId, files },
    'seeded clsi-cache'
  )
  res.sendStatus(204)
}

/**
 * Publish the outputs of a submission (template compile) as the cache
 * source for projects created from the template.
 * See exportSubmissionAsTemplate in services/web/app/src/Features/Compile/ClsiCacheHandler.mjs
 */
export async function exportAsTemplate(req, res) {
  const {
    params: { submission_id: submissionId, editor_build_id: editorBuildId },
    body: { templateVersionId, imageName },
  } = parseReq(req, exportAsTemplateSchema)

  // Submissions compile without a user id.
  const prefix = BuildStore.buildPrefix(submissionId, editorBuildId)
  // The outputs arrive from clsi asynchronously; web allows us to poll for up to 15s.
  const deadline = Date.now() + Settings.ingest.exportWaitMs
  let files
  for (;;) {
    await IngestManager.waitForBuild(prefix, deadline - Date.now())
    files = await BuildStore.listFiles(prefix)
    if (files.includes('output.tar.gz') && files.includes(BuildStore.META_FILE)) {
      break
    }
    if (Date.now() > deadline) {
      throw new NotFoundError('submission build not cached', {
        submissionId,
        editorBuildId,
        files,
      })
    }
    await sleep(500)
  }

  const dstPrefix = BuildStore.templatePrefix(
    templateVersionId,
    Path.basename(imageName)
  )
  await BuildStore.deleteDirectory(dstPrefix)
  await BuildStore.copyPrefix(prefix, dstPrefix)
  Metrics.inc('clsi_cache_export_template')
  logger.debug(
    { submissionId, editorBuildId, templateVersionId, imageName, files },
    'exported submission build as template'
  )
  res.sendStatus(204)
}

export async function status(req, res) {
  res.send('clsi-cache is up')
}
