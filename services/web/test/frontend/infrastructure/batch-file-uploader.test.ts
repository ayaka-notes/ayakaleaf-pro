import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import {
  uploadBatch,
  BatchUploadOptions,
} from '@/infrastructure/batch-file-uploader'

describe('uploadBatch', function () {
  const batchUploadOptions = {
    projectId: 'test-project',
    folderId: 'test-folder',
  }

  const batchUploadItems = [
    {
      file: new Blob(['col1,col2\n1,2\n']),
      name: 'data.csv',
      relativePath: 'output/data.csv',
    },
    {
      file: new Blob(['hello world']),
      name: 'notes.txt',
      relativePath: 'output/notes.txt',
    },
    {
      file: new Blob([new Uint8Array([137, 80, 78, 71])]),
      name: 'figure.png',
      relativePath: 'output/figure.png',
    },
    {
      file: new Blob(['{"result":42}']),
      name: 'data.json',
    },
  ]

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('returns an empty array and makes no requests when items is empty', async function () {
    const results = await uploadBatch([], batchUploadOptions)

    expect(results).to.deep.equal([])
    expect(fetchMock.callHistory.called()).to.be.false
  })

  context('when all uploads succeed', function () {
    const expectedUrl = `/project/${batchUploadOptions.projectId}/upload?folder_id=${batchUploadOptions.folderId}`
    let results: Awaited<ReturnType<typeof uploadBatch>>
    let calls: ReturnType<typeof fetchMock.callHistory.calls>

    beforeEach(async function () {
      fetchMock.post(expectedUrl, {
        status: 200,
        body: { success: true },
      })
      results = await uploadBatch(batchUploadItems, batchUploadOptions)
      calls = fetchMock.callHistory.calls()
    })

    const findRequestFor = (name: string) =>
      calls.find(c => (c.options.body as FormData).get('name') === name)!

    it('makes one request per item', function () {
      expect(calls).to.have.lengthOf(4)
    })

    it('posts each request to the upload URL', function () {
      for (const call of calls) {
        expect(call.url).to.include(expectedUrl)
      }
    })

    it('sets the name form field from the item name', function () {
      for (const item of batchUploadItems) {
        const body = findRequestFor(item.name).options.body as FormData
        expect(body.get('name')).to.equal(item.name)
      }
    })

    it('sets the relativePath form field from the item path', function () {
      for (const item of batchUploadItems.filter(i => i.relativePath)) {
        const body = findRequestFor(item.name).options.body as FormData
        expect(body.get('relativePath')).to.equal(item.relativePath)
      }
    })

    it('omits the relativePath form field when the item has no relativePath', function () {
      for (const item of batchUploadItems.filter(i => !i.relativePath)) {
        const body = findRequestFor(item.name).options.body as FormData
        expect(body.has('relativePath')).to.be.false
      }
    })

    it('attaches the item file as qqfile', function () {
      for (const item of batchUploadItems) {
        const body = findRequestFor(item.name).options.body as FormData
        expect(body.get('qqfile')).to.be.instanceOf(Blob)
      }
    })

    it('returns a success result per item with name, relativePath, and server data', function () {
      expect(results).to.deep.equal([
        {
          status: 'success',
          name: 'data.csv',
          relativePath: 'output/data.csv',
          data: { success: true },
        },
        {
          status: 'success',
          name: 'notes.txt',
          relativePath: 'output/notes.txt',
          data: { success: true },
        },
        {
          status: 'success',
          name: 'figure.png',
          relativePath: 'output/figure.png',
          data: { success: true },
        },
        {
          status: 'success',
          name: 'data.json',
          relativePath: undefined,
          data: { success: true },
        },
      ])
    })
  })

  context('with mixed upload outcomes', function () {
    const expectedUrl = `/project/${batchUploadOptions.projectId}/upload?folder_id=${batchUploadOptions.folderId}`
    let results: Awaited<ReturnType<typeof uploadBatch>>

    beforeEach(async function () {
      fetchMock.post(expectedUrl, callLog => {
        const name = (callLog.options.body as FormData).get('name')
        switch (name) {
          case 'data.csv':
            return { status: 200, body: { success: true } }
          case 'notes.txt':
            return {
              status: 422,
              body: { success: false, error: 'duplicate_file_name' },
            }
          case 'figure.png':
            return { status: 500, body: {} }
          case 'data.json':
            return Promise.reject(new Error('network down'))
          default:
            throw new Error(`unexpected item name: ${name}`)
        }
      })
      results = await uploadBatch(batchUploadItems, batchUploadOptions)
    })

    it('returns a success result when the upload succeeds', function () {
      expect(results[0]).to.deep.equal({
        status: 'success',
        name: 'data.csv',
        relativePath: 'output/data.csv',
        data: { success: true },
      })
    })

    it('returns the server-provided error string when the response body has one', function () {
      expect(results[1]).to.deep.equal({
        status: 'error',
        name: 'notes.txt',
        relativePath: 'output/notes.txt',
        error: 'duplicate_file_name',
      })
    })

    it('falls back to a status-code message when the error body has no error field', function () {
      expect(results[2]).to.deep.equal({
        status: 'error',
        name: 'figure.png',
        relativePath: 'output/figure.png',
        error: 'Internal Server Error',
      })
    })

    it('returns the rejection message when fetch rejects', function () {
      expect(results[3]).to.deep.equal({
        status: 'error',
        name: 'data.json',
        relativePath: undefined,
        error: 'network down',
      })
    })
  })

  describe('default concurrency', function () {
    const expectedUrl = `/project/${batchUploadOptions.projectId}/upload?folder_id=${batchUploadOptions.folderId}`

    const manyItems = Array.from({ length: 6 }, (_, i) => ({
      file: new Blob([`content ${i}`]),
      name: `file-${i}.txt`,
    }))

    const waitFor = async (predicate: () => boolean, timeoutMs = 200) => {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (Date.now() > deadline) {
          throw new Error('waitFor timed out')
        }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    const observeMaxInFlight = async (options: BatchUploadOptions) => {
      let inFlight = 0
      let maxInFlight = 0
      let releaseAll!: () => void
      const release = new Promise<void>(resolve => {
        releaseAll = resolve
      })

      fetchMock.post(expectedUrl, async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await release
        inFlight--
        return { status: 200, body: { success: true } }
      })

      const batchPromise = uploadBatch(manyItems, options)
      await waitFor(() => inFlight === 3)
      releaseAll()
      await batchPromise
      return maxInFlight
    }

    it('uses a default cap of 3 when no concurrency is set', async function () {
      const max = await observeMaxInFlight(batchUploadOptions)
      expect(max).to.equal(3)
    })

    it('falls back to the default when concurrency is 0', async function () {
      const max = await observeMaxInFlight({
        ...batchUploadOptions,
        concurrency: 0,
      })
      expect(max).to.equal(3)
    })

    it('falls back to the default when concurrency is negative', async function () {
      const max = await observeMaxInFlight({
        ...batchUploadOptions,
        concurrency: -1,
      })
      expect(max).to.equal(3)
    })
  })
})
