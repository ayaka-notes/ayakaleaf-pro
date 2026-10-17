// Metrics must be initialized before importing anything else
import '@overleaf/metrics/initialize.js'

import fs from 'node:fs'
import express from 'express'
import bodyParser from 'body-parser'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import { expressify } from '@overleaf/promise-utils'
import { handleValidationError } from '@overleaf/validation-tools'
import * as HttpController from './app/js/HttpController.js'
import * as ExpiryManager from './app/js/ExpiryManager.js'
import { InvalidNameError, NotFoundError } from './app/js/Errors.js'
import {
  EDITOR_BUILD_ID_REGEX,
  PROJECT_ID_REGEX,
  USER_ID_REGEX,
} from './app/js/utils.js'

logger.initialize('clsi-cache')
Metrics.open_sockets.monitor(true)
Metrics.memory.monitor(logger)
Metrics.leaked_sockets.monitor(logger)

const app = express()

Metrics.injectMetricsRoute(app)
app.use(Metrics.http.monitor(logger))

// Downloads of large PDFs on slow connections may take a while.
const TIMEOUT = 10 * 60 * 1000
app.use(function (req, res, next) {
  req.setTimeout(TIMEOUT)
  res.setTimeout(TIMEOUT)
  res.removeHeader('X-Powered-By')
  next()
})

for (const [param, regex] of [
  ['project_id', PROJECT_ID_REGEX],
  ['submission_id', PROJECT_ID_REGEX],
  ['user_id', USER_ID_REGEX],
  ['editor_build_id', EDITOR_BUILD_ID_REGEX],
]) {
  app.param(param, function (req, res, next, value) {
    if (regex.test(value)) {
      next()
    } else {
      res.status(400).end()
    }
  })
}

// clsi -> clsi-cache: build notifications, then pull the outputs.
app.post(
  '/enqueue',
  bodyParser.json({ limit: '20mb' }),
  expressify(HttpController.enqueue)
)

// Lookups answer with a redirect and the X-* headers describing the build.
app.get(
  '/project/:project_id/user/:user_id/latest/output/:filename(.*)',
  expressify(HttpController.getLatestOutputFile)
)
app.get(
  '/project/:project_id/latest/output/:filename(.*)',
  expressify(HttpController.getLatestOutputFile)
)
app.get(
  '/project/:project_id/user/:user_id/build/:editor_build_id/search/output/:filename(.*)',
  expressify(HttpController.getBuildOutputFile)
)
app.get(
  '/project/:project_id/build/:editor_build_id/search/output/:filename(.*)',
  expressify(HttpController.getBuildOutputFile)
)

// Where the redirects point to with the fs backend.
app.get(
  '/project/:project_id/user/:user_id/build/:editor_build_id/output/:filename(.*)',
  expressify(HttpController.streamOutputFile)
)
app.get(
  '/project/:project_id/build/:editor_build_id/output/:filename(.*)',
  expressify(HttpController.streamOutputFile)
)

app.delete(
  '/project/:project_id/user/:user_id/output',
  expressify(HttpController.clearProject)
)
app.delete('/project/:project_id/output', expressify(HttpController.clearProject))

app.post(
  '/project/:project_id/user/:user_id/import-from',
  bodyParser.json(),
  expressify(HttpController.importFrom)
)
app.post(
  '/submission/:submission_id/build/:editor_build_id/export-as-template',
  bodyParser.json(),
  expressify(HttpController.exportAsTemplate)
)

app.get('/status', expressify(HttpController.status))
app.get('/health_check', expressify(HttpController.status))

app.use(handleValidationError)
app.use(function (err, req, res, next) {
  if (err instanceof NotFoundError) {
    res.status(404).end()
  } else if (err instanceof InvalidNameError) {
    res.status(400).end()
  } else if (err.type === 'entity.too.large' || err.type === 'entity.parse.failed') {
    res.status(err.status || 400).end()
  } else {
    logger.error({ err, url: req.originalUrl }, 'unhandled error')
    res.status(500).end()
  }
})

// The fs persistor writes temp files next to the objects, the directory must exist.
fs.mkdirSync(Settings.path.cacheDir, { recursive: true })

const { port, host } = Settings.internal.clsiCache
const server = app.listen(port, host, function (err) {
  if (err) {
    logger.fatal({ err }, `cannot bind to ${host}:${port}. Exiting.`)
    process.exit(1)
  }
  logger.info({ host, port, shard: Settings.shard }, 'clsi-cache starting up')
})
ExpiryManager.init()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down')
    ExpiryManager.stop()
    server.close(() => process.exit(0))
  })
}

export default app
