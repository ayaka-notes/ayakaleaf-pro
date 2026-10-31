import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@overleaf/settings', () => ({
  default: { webdav: { requestTimeoutMs: 1000 } },
}))

// Mock the webdav npm package so no real network calls happen and the
// transport behavior is fully deterministic.
const fakeWebdavClient = vi.hoisted(() => ({
  baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
  exists: vi.fn().mockResolvedValue(true),
  getDirectoryContents: vi.fn(),
  createDirectory: vi.fn().mockResolvedValue(undefined),
  putFileContents: vi.fn().mockResolvedValue(undefined),
  getFileContents: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  moveFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('webdav', () => ({
  createClient: vi.fn(() => fakeWebdavClient),
}))

const { default: WebdavClient, parseMultistatus } = await import(
  '../../../app/src/WebdavClient.mjs'
)
const { remotePath } = await import('../../../app/src/WebdavPaths.mjs')

describe('WebdavClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the configured WebDAV endpoint path when building URLs', () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    expect(client.url('/Overleaf/demo/main.tex').toString()).toBe(
      'https://cloud.example/remote.php/dav/files/alice/Overleaf/demo/main.tex'
    )
  })

  it('uses the connected user root for project paths', () => {
    expect(remotePath('/alice-files', 'demo', '/main.tex')).toBe(
      '/alice-files/demo/main.tex'
    )
  })

  it('converts absolute WebDAV hrefs to endpoint-relative paths', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/dav/files/alice/Overleaf/demo/main%20file.tex</d:href>
          <d:propstat><d:prop>
            <d:resourcetype />
            <d:getetag>abc</d:getetag>
            <d:getcontentlength>12</d:getcontentlength>
          </d:prop></d:propstat>
        </d:response>
      </d:multistatus>`

    expect(
      parseMultistatus(
        xml,
        '/Overleaf/demo',
        '/remote.php/dav/files/alice'
      )
    ).toEqual([
      {
        href: '/remote.php/dav/files/alice/Overleaf/demo/main%20file.tex',
        path: '/Overleaf/demo/main file.tex',
        isDirectory: false,
        etag: 'abc',
        modifiedAt: null,
        size: 12,
      },
    ])
  })

  it('rejects malformed multistatus XML', () => {
    expect(() => parseMultistatus('<not-xml', '/Overleaf/demo')).toThrow(
      'invalid WebDAV multistatus response'
    )
  })

  it('retries transient WebDAV responses', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    fakeWebdavClient.getFileContents
      .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { status: 503 }))
      .mockResolvedValueOnce('ok')

    const body = await client.get('/Overleaf/demo/main.tex')
    expect(body.byteLength).toBe(2)
    expect(fakeWebdavClient.getFileContents).toHaveBeenCalledTimes(2)
  })

  it('uses If-Match when replacing a known remote file', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    await client.put('/Overleaf/demo/main.tex', 'updated', { etag: '"v1"' })

    expect(fakeWebdavClient.putFileContents).toHaveBeenCalledTimes(1)
    const [, , options] = fakeWebdavClient.putFileContents.mock.calls[0]
    expect(options.headers['If-Match']).toBe('"v1"')
  })

  it('surfaces 404 as a not-found status from remove()', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    fakeWebdavClient.deleteFile.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { status: 404 })
    )

    const status = await client.remove('/Overleaf/demo/gone.tex')
    expect(status).toBe(404)
  })

  it('keeps binary ArrayBuffers byte-exact in put() (no UTF-8 mangling)', async () => {
    // Regression: push lanes hand put() the result of response.arrayBuffer()
    // for binary files. Decoding that through TextDecoder() replaced every
    // invalid UTF-8 byte with U+FFFD — PNG/PDF/JPG arrived on the DAV side
    // corrupted. Bytes must reach the transport untouched.
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    // PNG signature + every byte value 0x00..0xFF (deliberately invalid
    // UTF-8 sequences everywhere)
    const binary = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    ])
    const arrayBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)

    await client.put('/Overleaf/demo/image.png', arrayBuffer)

    expect(fakeWebdavClient.putFileContents).toHaveBeenCalledTimes(1)
    const [path, content, options] = fakeWebdavClient.putFileContents.mock.calls[0]
    expect(path).toBe('/Overleaf/demo/image.png')
    expect(typeof content).not.toBe('string')
    expect(Buffer.isBuffer(content)).toBe(true)
    expect(Buffer.compare(Buffer.from(content), binary)).toBe(0)
    expect(options.contentType).toBe('application/octet-stream')
  })

  it('keeps binary Buffers byte-exact in put()', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0xf0, 0x9f, 0x94, 0x88]) // emoji + NUL
    await client.put('/Overleaf/demo/blob.bin', binary)

    const [, content] = fakeWebdavClient.putFileContents.mock.calls[0]
    expect(Buffer.compare(Buffer.from(content), binary)).toBe(0)
  })

  it('requests binary content from the transport in get()', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    fakeWebdavClient.getFileContents.mockResolvedValueOnce(payload)

    const body = await client.get('/Overleaf/demo/blob.bin')
    const [path, options] = fakeWebdavClient.getFileContents.mock.calls[0]
    expect(path).toBe('/Overleaf/demo/blob.bin')
    expect(options).toEqual({ format: 'binary' })
    expect(Buffer.compare(Buffer.from(body), payload)).toBe(0)
  })
})
