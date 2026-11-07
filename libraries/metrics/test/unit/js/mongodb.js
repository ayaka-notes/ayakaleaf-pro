const Metrics = require('../../..')

const { expect } = require('chai')
const prom = require('prom-client')

describe('mongodb', function () {
  beforeEach(function () {
    prom.register.clear()
    this.pool = {
      totalConnectionCount: 8,
      availableConnectionCount: 2,
      waitQueueSize: 4,
      options: { maxPoolSize: 10 },
    }
    this.servers = new Map([['server1', { s: { pool: this.pool } }]])

    this.mongoClient = {
      on() {},
      topology: { s: { servers: this.servers } },
    }
    Metrics.mongodb.reset()
  })

  it('handles an unconnected client', async function () {
    const mongoClient = { on() {} }
    Metrics.mongodb.monitor(mongoClient)
    const metrics = await getMetrics()
    expect(metrics).to.deep.equal({})
  })

  it('collects Mongo metrics', async function () {
    Metrics.mongodb.monitor(this.mongoClient)
    const metrics = await getMetrics()
    expect(metrics).to.deep.equal({
      'mongo_connection_pool_max:server1': 10,
      'mongo_connection_pool_size:server1': 8,
      'mongo_connection_pool_available:server1': 2,
      'mongo_connection_pool_waiting:server1': 4,
    })
  })

  it('collects Mongo metrics with client', async function () {
    Metrics.mongodb.monitor(this.mongoClient, 'native')
    const metrics = await getMetrics()
    expect(metrics).to.deep.equal({
      'mongo_connection_pool_max:server1:native': 10,
      'mongo_connection_pool_size:server1:native': 8,
      'mongo_connection_pool_available:server1:native': 2,
      'mongo_connection_pool_waiting:server1:native': 4,
    })
  })

  it('handles topology changes', async function () {
    Metrics.mongodb.monitor(this.mongoClient)
    let metrics = await getMetrics()
    expect(metrics).to.deep.equal({
      'mongo_connection_pool_max:server1': 10,
      'mongo_connection_pool_size:server1': 8,
      'mongo_connection_pool_available:server1': 2,
      'mongo_connection_pool_waiting:server1': 4,
    })

    // Add a server
    this.servers.set('server2', this.servers.get('server1'))
    metrics = await getMetrics()
    expect(metrics).to.deep.equal({
      'mongo_connection_pool_max:server1': 10,
      'mongo_connection_pool_size:server1': 8,
      'mongo_connection_pool_available:server1': 2,
      'mongo_connection_pool_waiting:server1': 4,
      'mongo_connection_pool_max:server2': 10,
      'mongo_connection_pool_size:server2': 8,
      'mongo_connection_pool_available:server2': 2,
      'mongo_connection_pool_waiting:server2': 4,
    })

    // Delete a server
    this.servers.delete('server1')
    metrics = await getMetrics()
    expect(metrics).to.deep.equal({
      'mongo_connection_pool_max:server2': 10,
      'mongo_connection_pool_size:server2': 8,
      'mongo_connection_pool_available:server2': 2,
      'mongo_connection_pool_waiting:server2': 4,
    })

    // Delete another server
    this.servers.delete('server2')
    metrics = await getMetrics()
    expect(metrics).to.deep.equal({})
  })
})

async function getMetrics() {
  const metrics = await prom.register.getMetricsAsJSON()
  const result = {}
  for (const metric of metrics) {
    for (const value of metric.values) {
      let key = `${metric.name}:${value.labels.mongo_server}`
      if (value.labels.client) {
        key = `${key}:${value.labels.client}`
      }
      result[key] = value.value
    }
  }
  return result
}
