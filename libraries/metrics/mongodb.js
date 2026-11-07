const { Gauge, Summary, Counter } = require('prom-client')

/** @type {poolSize: Gauge<string>, availableConnections: Gauge<string>, waitQueueSize: Gauge<string>, maxPoolSize: Gauge<string>, mongoCommandStarted: Counter<string>, mongoCommandTimer: Summary<string>} */
let metrics
const collectPoolMetrics = []

/**
 * @param clientLabel
 */
function initMetricsOnce(clientLabel) {
  if (metrics) return
  const poolLabelNames = ['mongo_server']
  if (clientLabel) poolLabelNames.push('client')
  const poolSize = new Gauge({
    name: 'mongo_connection_pool_size',
    help: 'number of connections in the connection pool',
    labelNames: poolLabelNames,
    // Use this one metric's collect() to set all metrics' values.
    collect() {
      // Reset all gauges in case they contain values for servers that
      // disappeared
      metrics.poolSize.reset()
      metrics.availableConnections.reset()
      metrics.waitQueueSize.reset()
      metrics.maxPoolSize.reset()
      collectPoolMetrics.forEach(fn => fn())
    },
  })
  const availableConnections = new Gauge({
    name: 'mongo_connection_pool_available',
    help: 'number of connections that are not busy',
    labelNames: poolLabelNames,
  })
  const waitQueueSize = new Gauge({
    name: 'mongo_connection_pool_waiting',
    help: 'number of operations waiting for an available connection',
    labelNames: poolLabelNames,
  })
  const maxPoolSize = new Gauge({
    name: 'mongo_connection_pool_max',
    help: 'max size for the connection pool',
    labelNames: poolLabelNames,
  })

  const mongoCommandStarted = new Counter({
    name: 'mongo_command_started',
    help: 'mongo command started',
    labelNames: ['method', 'collection'],
  })
  const mongoCommandTimer = new Summary({
    name: 'mongo_command_time',
    help: 'time taken to complete a mongo command',
    percentiles: [],
    labelNames: ['status', 'method', 'ns'],
  })

  metrics = {
    poolSize,
    availableConnections,
    waitQueueSize,
    maxPoolSize,
    mongoCommandStarted,
    mongoCommandTimer,
  }
  return metrics
}

function monitor(mongoClient, clientLabel) {
  initMetricsOnce(clientLabel)

  mongoClient.on('commandStarted', event => {
    const { commandName, command } = event
    const collection = command?.[commandName]
    if (typeof collection !== 'string') return // Lifecycle commands
    if (commandName === 'create') return // Mongoose init
    metrics.mongoCommandStarted.inc({
      method: commandName === 'find' ? 'read' : 'write',
      collection,
    })
  })

  mongoClient.on('commandSucceeded', event => {
    metrics.mongoCommandTimer.observe(
      {
        status: 'success',
        method: event.commandName === 'find' ? 'read' : 'write',
        ns: event.reply?.cursor?.ns, // best effort, set on 'find'
      },
      event.duration
    )
  })

  mongoClient.on('commandFailed', event => {
    metrics.mongoCommandTimer.observe(
      {
        status: 'failed',
        method: event.commandName === 'find' ? 'read' : 'write',
      },
      event.duration
    )
  })

  function collect() {
    const servers = mongoClient.topology?.s?.servers
    if (servers != null) {
      for (const [address, server] of servers) {
        // The server object is different between v4 and v5 (c.f. https://github.com/mongodb/node-mongodb-native/pull/3645)
        const pool = server.s?.pool || server.pool
        if (pool == null) {
          continue
        }

        const labels = { mongo_server: address }
        if (clientLabel) labels.client = clientLabel
        metrics.poolSize.set(labels, pool.totalConnectionCount)
        metrics.availableConnections.set(labels, pool.availableConnectionCount)
        metrics.waitQueueSize.set(labels, pool.waitQueueSize)
        metrics.maxPoolSize.set(labels, pool.options.maxPoolSize)
      }
    }
  }
  collectPoolMetrics.push(collect)
}

module.exports = {
  monitor,
  reset() {
    metrics = undefined
    collectPoolMetrics.length = 0
  },
}
