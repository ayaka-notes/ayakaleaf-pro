// Metrics must be initialized before importing anything else
import '@overleaf/metrics/initialize.js'

import Metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import express from 'express'
import bodyParser from 'body-parser'
import { mongoClient } from './app/js/mongodb.mjs'
import EnqueueController from './app/js/EnqueueController.mjs'
import QueueWorker from './app/js/QueueWorker.mjs'

logger.initialize('third-party-datastore')
Metrics.open_sockets.monitor()

// Private API for web only, like the other backend services
const app = express()
app.use(Metrics.http.monitor(logger))
Metrics.injectMetricsRoute(app)

app.post(
  '/enqueue/web_to_tpds_http_requests',
  bodyParser.json({ limit: '1mb' }),
  EnqueueController.enqueue
)
app.get('/queues/:userId', EnqueueController.getQueues)

app.get('/status', (req, res) => res.send('third-party-datastore is alive'))
app.get('/health_check', (req, res) => res.sendStatus(200))

app.use((err, req, res, next) => {
  logger.error({ err, url: req.url }, 'request failed')
  res.sendStatus(500)
})

const { port, host } = Settings.internal.thirdPartyDataStore

try {
  await mongoClient.connect()
  app.listen(port, host, () => {
    logger.debug({ port, host }, 'third-party-datastore listening')
  })
  QueueWorker.start()
} catch (err) {
  logger.fatal({ err }, 'failed to start third-party-datastore')
  process.exit(1)
}
