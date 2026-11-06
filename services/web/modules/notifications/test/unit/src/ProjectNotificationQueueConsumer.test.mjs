import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'

const consumerPath = path.join(
  import.meta.dirname,
  '../../../app/src/ProjectNotificationQueueConsumer.mjs'
)

let consumer
const savedEnv = {}

beforeAll(async function () {
  consumer = await import(consumerPath)
  for (const key of [
    'QUEUES_REDIS_HOST',
    'QUEUES_REDIS_PORT',
    'QUEUES_REDIS_PASSWORD',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
  ]) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

describe('ProjectNotificationQueueConsumer', function () {
  it('does not start a queue in the test environment', function () {
    expect(consumer.startProjectNotificationConsumer()).toBeNull()
    // idempotent no-op on repeat calls
    expect(consumer.startProjectNotificationConsumer()).toBeNull()
  })

  it('resolves redis config preferring QUEUES_REDIS_* over REDIS_*', function () {
    // no env at all → localhost default (same as the enqueue script's bull)
    expect(consumer.getQueueRedisConfig()).toEqual({
      host: '127.0.0.1',
      port: 6379,
      password: undefined,
    })

    process.env.REDIS_HOST = 'stackredis'
    process.env.REDIS_PORT = '6380'
    process.env.REDIS_PASSWORD = 'secret'
    expect(consumer.getQueueRedisConfig()).toEqual({
      host: 'stackredis',
      port: 6380,
      password: 'secret',
    })

    // explicit QUEUES_REDIS_* must win over REDIS_*
    process.env.QUEUES_REDIS_HOST = 'queuesredis'
    process.env.QUEUES_REDIS_PORT = '7777'
    expect(consumer.getQueueRedisConfig()).toEqual({
      host: 'queuesredis',
      port: 7777,
      password: 'secret',
    })
  })

  it('exposes the upstream queue name', function () {
    expect(consumer.QUEUE_NAME).toBe('project-notification')
  })
})

describe('fireHookWithTimeout', function () {
  it('rejects when a hook handler never settles', async function () {
    // hung handler (like the promisified-async regression) must not wedge the
    // worker: it rejects and the Bull job can fail/retry instead of hanging
    let err = null
    try {
      await consumer.fireHookWithTimeout(
        'projectModified',
        {},
        50,
        () => new Promise(() => {})
      )
    } catch (e) {
      err = e
    }
    expect(err).not.toBeNull()
    expect(String(err.message)).toMatch(/timed out/)
  })

  it('resolves with the hook results when they settle in time', async function () {
    const result = await consumer.fireHookWithTimeout(
      'projectModified',
      {},
      500,
      async () => ['scheduled:1']
    )
    expect(result).toEqual(['scheduled:1'])
  })

  it('propagates handler errors', async function () {
    let err = null
    try {
      await consumer.fireHookWithTimeout('projectModified', {}, 500, async () => {
        throw new Error('boom')
      })
    } catch (e) {
      err = e
    }
    expect(err).not.toBeNull()
    expect(String(err.message)).toBe('boom')
  })
})
