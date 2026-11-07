import sinon from 'sinon'
import { vi, describe, it, beforeEach, afterEach } from 'vitest'
import Path from 'node:path'

const MODULE_PATH = Path.join(
  import.meta.dirname,
  '../../../app/js/ConversionOutputCleaner'
)

describe('ConversionOutputCleaner', function () {
  beforeEach(async function (ctx) {
    ctx.clock = sinon.useFakeTimers()
    ctx.Settings = {
      path: { outputDir: '/output' },
    }
    ctx.fs = {
      rm: sinon.stub().resolves(),
    }
    ctx.logger = {
      warn: sinon.stub(),
    }

    vi.doMock('node:fs/promises', () => ({ default: ctx.fs }))
    vi.doMock('@overleaf/settings', () => ({ default: ctx.Settings }))
    vi.doMock('@overleaf/logger', () => ({ default: ctx.logger }))

    ctx.ConversionOutputCleaner = (await import(MODULE_PATH)).default
  })

  afterEach(function (ctx) {
    ctx.clock.restore()
  })

  it('does not remove the directory before the TTL elapses', function (ctx) {
    ctx.ConversionOutputCleaner.scheduleCleanup('test-conversion-id')
    ctx.clock.tick(ctx.ConversionOutputCleaner.TTL_MS - 1)
    sinon.assert.notCalled(ctx.fs.rm)
  })

  it('removes the conversion output directory once the TTL elapses', function (ctx) {
    ctx.ConversionOutputCleaner.scheduleCleanup('test-conversion-id')
    ctx.clock.tick(ctx.ConversionOutputCleaner.TTL_MS)
    sinon.assert.calledWith(ctx.fs.rm, '/output/test-conversion-id', {
      recursive: true,
      force: true,
    })
  })
})
