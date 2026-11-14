import { vi, expect, describe, beforeEach, afterEach, it } from 'vitest'
import sinon from 'sinon'
import tk from 'timekeeper'
import path from 'node:path'

const modulePath = path.join(
  import.meta.dirname,
  '../../../app/js/RequestParser'
)

describe('RequestParser (clsi-typst)', () => {
  beforeEach(async ctx => {
    tk.freeze()
    ctx.callback = sinon.stub()
    ctx.validRequest = {
      compile: {
        options: {
          compiler: 'typst',
          timeout: 42,
        },
        resources: [],
      },
    }

    vi.doMock('@overleaf/settings', () => ({
      default: (ctx.settings = {}),
    }))

    vi.doMock('../../../app/js/OutputCacheManager', () => ({
      default: { BUILD_REGEX: /^[0-9a-f]+-[0-9a-f]+$/ },
    }))

    ctx.RequestParser = (await import(modulePath)).default
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    tk.reset()
  })

  function parseAsync(ctx, body) {
    return new Promise((resolve, reject) => {
      ctx.RequestParser.parse(body, (error, data) => {
        if (error) return reject(error)
        resolve(data)
      })
    })
  }

  describe('without a valid compiler', () => {
    beforeEach(ctx => {
      ctx.validRequest.compile.options.compiler = 'pdflatex'
      ctx.RequestParser.parse(ctx.validRequest, ctx.callback)
    })

    it('should return an error naming only typst', ctx => {
      expect(ctx.callback).to.have.been.called
      expect(ctx.callback.args[0][0].message).to.equal(
        'compiler attribute should be one of: typst'
      )
    })
  })

  describe('without a compiler specified', () => {
    it('should set the compiler to typst by default', async ctx => {
      delete ctx.validRequest.compile.options.compiler
      const data = await parseAsync(ctx, ctx.validRequest)
      expect(data.compiler).to.equal('typst')
    })
  })

  describe('with a valid typst request', () => {
    it('parses compiler and timeout', async ctx => {
      const data = await parseAsync(ctx, ctx.validRequest)
      expect(data.compiler).to.equal('typst')
      // the parser multiplies the timeout by 1000 (seconds -> ms)
      expect(data.timeout).to.equal(42000)
    })
  })
})
