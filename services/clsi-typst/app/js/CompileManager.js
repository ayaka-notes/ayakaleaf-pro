import fsPromises from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { callbackify, promisify } from 'node:util'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import ResourceWriter from './ResourceWriter.js'
import TypstRunner from './TypstRunner.js'
import OutputFileFinder from './OutputFileFinder.js'
import OutputCacheManager from './OutputCacheManager.js'
import ClsiMetrics from './Metrics.js'
import LockManager from './LockManager.js'
import Errors from './Errors.js'
import ProjectPersistenceManager from './ProjectPersistenceManager.js'
import TypstSourcemap from './TypstSourcemap.js'
import TypstWordcount from './TypstWordcount.js'
import CLSICacheHandler from './CLSICacheHandler.js'
import { callbackifyMultiResult } from '@overleaf/promise-utils'
import * as HistoryResourceWriter from './HistoryResourceWriter.js'

const { shouldSkipMetrics } = ClsiMetrics

const { downloadLatestCompileCache } = CLSICacheHandler
const {
  SourcemapError: TypstSourcemapError,
  NotCompiledError: TypstSourcemapNotCompiled,
  NotFoundError: TypstSourcemapNotFound,
} = TypstSourcemap.errors

function getCompileName(projectId, userId) {
  if (userId != null) {
    return `${projectId}-${userId}`
  } else {
    return projectId
  }
}

function getCompileDir(projectId, userId) {
  return Path.join(Settings.path.compilesDir, getCompileName(projectId, userId))
}

function getOutputDir(projectId, userId) {
  return Path.join(Settings.path.outputDir, getCompileName(projectId, userId))
}

async function doCompileWithLock(request, stats, timings) {
  const compileDir = getCompileDir(request.project_id, request.user_id)
  request.isInitialCompile =
    (await fsPromises.mkdir(compileDir, { recursive: true })) === compileDir
  // prevent simultaneous compiles
  const lock = LockManager.acquire(compileDir)
  try {
    return await doCompile(request, stats, timings)
  } finally {
    lock.release()
  }
}

async function doCompile(request, stats, timings) {
  const { project_id: projectId, user_id: userId } = request
  const compileDir = getCompileDir(request.project_id, request.user_id)

  const e2eCompileStart = Date.now()

  if (request.isInitialCompile) {
    stats.isInitialCompile = 1
    request.metricsOpts.compile = 'initial'
    if (request.compileFromClsiCache) {
      try {
        if (await downloadLatestCompileCache(projectId, userId, compileDir)) {
          stats.restoredClsiCache = 1
          request.metricsOpts.compile = 'from-clsi-cache'
        }
      } catch (err) {
        logger.warn(
          { err, projectId, userId },
          'failed to populate compile dir from cache'
        )
      }
    }
  } else {
    request.metricsOpts.compile = 'recompile'
  }

  const syncStart = Date.now()
  logger.debug(
    { projectId: request.project_id, userId: request.user_id },
    'syncing resources to disk'
  )

  let resourceList, baseHistoryVersion
  try {
    if (request.isCompileFromHistory) {
      ;({ resourceList, baseHistoryVersion } =
        await HistoryResourceWriter.syncResourcesToDisk(
          projectId,
          userId,
          request,
          compileDir,
          timings,
          stats
        ))
    } else {
      // NOTE: resourceList is insecure, it should only be used to exclude files from the output list
      resourceList = await ResourceWriter.promises.syncResourcesToDisk(
        request,
        compileDir
      )
    }
  } catch (error) {
    if (error instanceof Errors.FilesOutOfSyncError) {
      OError.tag(error, 'files out of sync, please retry', {
        projectId: request.project_id,
        userId: request.user_id,
      })
    } else {
      OError.tag(error, 'error writing resources to disk', {
        projectId: request.project_id,
        userId: request.user_id,
      })
    }
    throw error
  }

  timings.sync = Date.now() - syncStart
  logger.debug(
    {
      projectId: request.project_id,
      userId: request.user_id,
      timeTaken: timings.sync,
    },
    'written files to disk'
  )

  const compileStart = Date.now()
  const compileName = getCompileName(request.project_id, request.user_id)

  try {
    await TypstRunner.promises.runTypst(compileName, {
      directory: compileDir,
      mainFile: request.rootResourcePath,
      timeout: request.timeout,
      image: request.imageName,
      environment: {
        OVERLEAF_PROJECT_ID: request.project_id,
      },
      compileGroup: request.compileGroup,
      stats,
      timings,
    })
  } catch (error) {
    // typst compiles almost never hard-fail (the engine exits 0 and reports
    // diagnostics in output.log); when the runner itself errors (timeout,
    // killed, sandbox error) we still save whatever outputs exist so the user
    // can inspect the log.
    const { outputFiles, allEntries, buildId } = await _saveOutputFiles({
      request,
      compileDir,
      resourceList,
      stats,
      timings,
    })
    error.outputFiles = outputFiles // return output files so user can check logs
    error.buildId = buildId
    // Clear project if this compile was abruptly terminated
    if (error.terminated || error.timedout) {
      await clearProjectWithListing(request.project_id, request.user_id, allEntries)
    }

    if (!shouldSkipMetrics(request)) {
      const status = error.timedout ? 'timeout' : error.terminated ? 'terminated' : 'failure'
      timings.compile = Date.now() - compileStart
      _emitMetrics(request, status, stats, timings)
    }
    throw error
  }

  timings.compile = Date.now() - compileStart

  logger.debug(
    {
      projectId: request.project_id,
      userId: request.user_id,
      timeTaken: timings.compile,
      stats,
      timings,
    },
    'done compile'
  )

  const { outputFiles, buildId } = await _saveOutputFiles({
    request,
    compileDir,
    resourceList,
    stats,
    timings,
  })
  timings.compileE2E = Date.now() - e2eCompileStart

  const status =
    outputFiles.some(f => f.path === 'output.pdf' && f.size > 0) ? 'success' : 'error'
  _emitMetrics(request, status, stats, timings)

  return { outputFiles, buildId, baseHistoryVersion }
}

async function _saveOutputFiles({ request, compileDir, resourceList, stats, timings }) {
  const start = Date.now()
  const outputDir = getOutputDir(request.project_id, request.user_id)

  const { outputFiles: rawOutputFiles, allEntries } =
    await OutputFileFinder.promises.findOutputFiles(resourceList, compileDir)

  const { buildId, outputFiles } =
    await OutputCacheManager.promises.saveOutputFiles(
      { request, stats, timings },
      rawOutputFiles,
      compileDir,
      outputDir
    )

  timings.output = Date.now() - start
  return { outputFiles, allEntries, buildId }
}

async function stopCompile(projectId, userId) {
  const compileName = getCompileName(projectId, userId)
  if (!TypstRunner.isRunning(compileName)) return
  await TypstRunner.promises.killTypst(compileName)
}

async function clearProject(projectId, userId) {
  const compileDir = getCompileDir(projectId, userId)
  await fsPromises.rm(compileDir, { force: true, recursive: true })
}

async function clearProjectWithListing(projectId, userId, allEntries) {
  const compileDir = getCompileDir(projectId, userId)

  const exists = await _checkDirectory(compileDir)
  if (!exists) {
    // skip removal if no directory present
    return
  }

  for (const pathInProject of allEntries) {
    const path = Path.join(compileDir, pathInProject)
    if (path.endsWith('/')) {
      await fsPromises.rmdir(path)
    } else {
      await fsPromises.unlink(path)
    }
  }
  await fsPromises.rmdir(compileDir)
}

async function _findAllDirs() {
  const root = Settings.path.compilesDir
  const files = await fsPromises.readdir(root)
  return files.map(file => Path.join(root, file))
}

async function clearExpiredProjects(maxCacheAgeMs) {
  const now = Date.now()
  const dirs = await _findAllDirs()
  for (const dir of dirs) {
    let stats
    try {
      stats = await fsPromises.stat(dir)
    } catch (err) {
      // ignore errors checking directory
      continue
    }

    const age = now - stats.mtime
    if (age > maxCacheAgeMs) {
      await fsPromises.rm(dir, { force: true, recursive: true })
    }
  }
}

async function _checkDirectory(compileDir) {
  let stats
  try {
    stats = await fsPromises.lstat(compileDir)
  } catch (err) {
    if (err.code === 'ENOENT') {
      // directory does not exist
      return false
    }
    OError.tag(err, 'error on stat of project directory for removal', {
      dir: compileDir,
    })
    throw err
  }
  if (!stats.isDirectory()) {
    throw new OError('project directory is not directory', {
      dir: compileDir,
      stats,
    })
  }
  return true
}

function _syncSidecarDir(projectId, userId, opts) {
  const outputDir = getOutputDir(projectId, userId)
  if (opts?.buildId && OutputCacheManager.BUILD_REGEX.test(opts.buildId)) {
    return Path.join(outputDir, OutputCacheManager.CACHE_SUBDIR, opts.buildId)
  }
  return getCompileDir(projectId, userId)
}

async function syncFromCode(projectId, userId, filename, line, column, opts) {
  if (filename == null || filename === '') {
    throw new Errors.InvalidParameter('file parameter is required')
  }
  const sidecarDir = _syncSidecarDir(projectId, userId, opts)
  const sm = await _loadSidecar(sidecarDir, projectId)
  // Source content lives in the COMPILE dir (where typst compile read it).
  let content = ''
  try {
    content = await fsPromises.readFile(
      Path.join(getCompileDir(projectId, userId), filename),
      'utf8'
    )
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // best-effort: the location's file may have been edited away after the
    // compile; offset math saturates instead of erroring.
  }
  const loc = TypstSourcemap.nearestByOffset(
    sm.locations,
    filename,
    TypstSourcemap.offsetAt(content, line, column)
  )
  if (loc == null) {
    // no matched location: 200 with an empty record array (the clsi synctex
    // binary returns an empty parse list the same way).
    return { codePositions: [], downloadedFromCache: false }
  }
  return {
    codePositions: [TypstSourcemap.viewRecord(loc)],
    downloadedFromCache: false,
  }
}

async function syncFromPdf(projectId, userId, page, h, v, opts) {
  const sidecarDir = _syncSidecarDir(projectId, userId, opts)
  const sm = await _loadSidecar(sidecarDir, projectId)
  const loc = TypstSourcemap.nearestByPoint(sm.locations, page - 1, h, v)
  if (loc == null) {
    // no location on the page: 200 with the "code" array empty.
    return { pdfPositions: [], downloadedFromCache: false }
  }
  let content = ''
  try {
    content = await fsPromises.readFile(
      Path.join(getCompileDir(projectId, userId), loc.span.file),
      'utf8'
    )
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const { line, column } = TypstSourcemap.lineColAt(content, loc.span.byteOffset)
  return {
    pdfPositions: [{ file: loc.span.file, line, column }],
    downloadedFromCache: false,
  }
}

// _loadSidecar maps the sourcemap reader's typed errors onto the service's
// error vocabulary: 405 (not compiled) and 404 (sourcemap not available).
async function _loadSidecar(dir, projectId) {
  try {
    return await TypstSourcemap.loadSidecar(dir, projectId)
  } catch (err) {
    if (err instanceof TypstSourcemapNotCompiled) {
      const e = new Errors.NotFoundError(err.message)
      e.statusCode = 405
      throw e
    }
    if (err instanceof TypstSourcemapNotFound) {
      throw new Errors.NotFoundError(err.message)
    }
    throw err
  }
}

function wordcount(projectId, userId, file, image, request, callback) {
  const compileDir = getCompileDir(projectId, userId)
  TypstWordcount.wordcount({
    projectId,
    userId,
    file,
    image,
    request,
    compileDir,
    syncResources: (req, dir) =>
      req.isCompileFromHistory
        ? HistoryResourceWriter.syncResourcesToDisk(
            projectId,
            userId,
            req,
            dir,
            {},
            {}
          ).then(r => r.resourceList)
        : ResourceWriter.promises.syncResourcesToDisk(req, dir),
  })
    .then(result => callback(null, result))
    .catch(err => callback(err))
}

function _emitMetrics(request, status, stats, timings) {
  if (request.metricsOpts.path === 'clsi-perf') {
    ClsiMetrics.e2eCompileDurationClsiPerfSeconds.set(
      { variant: request.metricsOpts.method },
      timings.compileE2E / 1000
    )
  }
  if (shouldSkipMetrics(request)) {
    return
  }

  // find the image tag to log it as a metric, e.g. 0.15.1
  let tag = 'default'
  if (request.imageName != null) {
    const match = request.imageName.match(/:(.*)/)
    if (match != null) {
      tag = match[1]
    }
  }

  ClsiMetrics.compilesTotal.inc({
    status,
    engine: request.compiler,
    image: tag,
    compile: request.metricsOpts.compile,
    group: request.compileGroup,
    draft: 'false',
    stop_on_first_error: 'false',
    passes: 1,
    type: request.syncType,
    png2pdf: 'false',
  })

  if (timings.sync != null) {
    ClsiMetrics.syncResourcesDurationSeconds.observe(
      {
        type: request.syncType,
        compile: request.metricsOpts.compile,
        group: request.compileGroup,
      },
      timings.sync / 1000
    )
  }

  if (timings.compile != null) {
    ClsiMetrics.compileDurationSeconds.observe(
      {
        status,
        engine: request.compiler,
        compile: request.metricsOpts.compile,
        group: request.compileGroup,
        passes: 'single',
      },
      timings.compile / 1000
    )
  }

  if (timings.output != null) {
    ClsiMetrics.processOutputFilesDurationSeconds.observe(
      {
        compile: request.metricsOpts.compile,
        group: request.compileGroup,
      },
      timings.output / 1000
    )
  }

  if (timings.compileE2E != null) {
    ClsiMetrics.e2eCompileDurationSeconds.observe(
      {
        compileFromHistory: request.isCompileFromHistory,
        compile: request.metricsOpts.compile,
        group: request.compileGroup,
      },
      timings.compileE2E / 1000
    )
  }
}

export default {
  doCompileWithLock: callbackify(doCompileWithLock),
  stopCompile: callbackify(stopCompile),
  clearProject: callbackify(clearProject),
  clearExpiredProjects: callbackify(clearExpiredProjects),
  syncFromCode: callbackifyMultiResult(syncFromCode, [
    'codePositions',
    'downloadedFromCache',
  ]),
  syncFromPdf: callbackifyMultiResult(syncFromPdf, [
    'pdfPositions',
    'downloadedFromCache',
  ]),
  wordcount, // callback-style (projectId, userId, file, image, request, callback)
  promises: {
    doCompileWithLock,
    stopCompile,
    clearProject,
    clearExpiredProjects,
    syncFromCode,
    syncFromPdf,
    wordcount,
  },
}
