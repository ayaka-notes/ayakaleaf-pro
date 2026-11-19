import { describe, expect, it } from 'vitest'

import {
  duplicateFile,
  resolveDuplicateName,
  splitFileName,
} from '../../../../frontend/js/features/file-tree/util/duplicate-file'

describe('splitFileName', () => {
  it('splits the last extension', () => {
    expect(splitFileName('report.pdf')).toEqual({
      base: 'report',
      ext: 'pdf',
    })
    expect(splitFileName('archive.tar.gz')).toEqual({
      base: 'archive.tar',
      ext: 'gz',
    })
  })

  it('handles names without a (useful) extension', () => {
    expect(splitFileName('noext')).toEqual({ base: 'noext', ext: '' })
    expect(splitFileName('.hidden')).toEqual({ base: '.hidden', ext: '' })
  })
})

describe('resolveDuplicateName', () => {
  it('appends -1 plus the original extension', () => {
    expect(resolveDuplicateName('report.pdf', () => false)).toBe(
      'report-1.pdf'
    )
    expect(resolveDuplicateName('data.csv', () => false)).toBe('data-1.csv')
  })

  it('loops while the candidate names are taken', () => {
    const exists = (n) => ['report-1.pdf', 'report-2.pdf'].includes(n)
    expect(resolveDuplicateName('report.pdf', exists)).toBe('report-3.pdf')
    expect(resolveDuplicateName('report.pdf', (n) => n === 'report-1.pdf')).toBe(
      'report-2.pdf'
    )
  })

  it('handles extension-less names', () => {
    expect(resolveDuplicateName('noext', () => false)).toBe('noext-1')
    expect(resolveDuplicateName('noext', (n) => n === 'noext-1')).toBe(
      'noext-2'
    )
  })

  it('does not collide with the source name itself', () => {
    // the source file name is taken by definition, but the derived name
    // must never be the source name
    const exists = (n) => n === 'report.pdf'
    expect(resolveDuplicateName('report.pdf', exists)).toBe('report-1.pdf')
  })
})

describe('duplicateFile', () => {
  const okFetchPair = (calls) => {
    let i = 0
    return async (input, init) => {
      calls[i] = { url: input, init }
      i += 1
      if (input.includes('/blob/')) {
        return new Response(new Blob(['file-bytes-123']), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
      return Response.json({ entity_id: 'E123', hash: 'h' })
    }
  }

  it('fetches the original and uploads a copy under the derived name', async () => {
    const calls = [{}, {}, {}]
    const result = await duplicateFile({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'report.pdf',
      csrfToken: 'CSRF',
      fetchImpl: okFetchPair(calls),
    })
    expect(result).toEqual({ ok: true, name: 'report-1.pdf', uploadedId: 'E123' })
    expect(calls[0].url).toBe('/project/PID/blob/HASH')
    expect(calls[1].url).toContain('/project/PID/upload?folder_id=F1')
    expect(calls[1].init.headers['X-CSRF-TOKEN']).toBe('CSRF')
    const fd = calls[1].init.body
    expect(fd.get('name')).toBe('report-1.pdf')
    const file = fd.get('qqfile')
    expect(file.name).toBe('report-1.pdf')
    expect(await file.text()).toBe('file-bytes-123')
  })

  it('avoids collisions with the exists predicate', async () => {
    const calls = [{}, {}, {}]
    const result = await duplicateFile({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'report.pdf',
      exists: (n) => n === 'report-1.pdf',
      fetchImpl: okFetchPair(calls),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('report-2.pdf')
    }
    expect(calls[1].init.body.get('name')).toBe('report-2.pdf')
  })

  it('surfaces a failed fetch of the original', async () => {
    const result = await duplicateFile({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'report.pdf',
      fetchImpl: async () => new Response('nope', { status: 404 }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/404/)
    }
  })

  it('surfaces a failed upload', async () => {
    const fetchImpl = async (input) => {
      if (input.includes('/blob/')) {
        return new Response(new Blob(['x']))
      }
      return new Response('denied', { status: 500 })
    }
    const result = await duplicateFile({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'report.pdf',
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/500/)
    }
  })
})
