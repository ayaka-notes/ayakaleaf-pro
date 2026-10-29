// Integration tests for WebDAV route paths and helpers
import { expect, it } from 'vitest'
import { remotePath, default as webdavPaths } from '../../../app/src/WebdavPaths.mjs'

describe('WebDAV Paths', function () {
  it('exposes remotePath as both named and default export', () => {
    expect(typeof remotePath).toBe('function')
    expect(webdavPaths.remotePath).toBe(remotePath)
  })

  it('builds project remote paths by joining root, project and file path', () => {
    expect(remotePath('/Overleaf', 'demo', '/main.tex')).toBe(
      '/Overleaf/demo/main.tex'
    )
    expect(remotePath('/Overleaf/', 'demo')).toBe('/Overleaf/demo/')
  })

  it('collapses duplicate slashes in the remote path', () => {
    expect(remotePath('/a//b', 'c', '/d/e.tex')).toBe('/a/b/c/d/e.tex')
  })
})
