import { describe, expect, it } from 'vitest'

import {
  computeSvgPixelSize,
  convertAndUpload,
  resolveConversionName,
  splitFileName,
} from '../../../frontend/js/util/svg-convert'

describe('splitFileName', () => {
  it('splits the last extension', () => {
    expect(splitFileName('logo.svg')).toEqual({ base: 'logo', ext: 'svg' })
    expect(splitFileName('archive.tar.gz')).toEqual({
      base: 'archive.tar',
      ext: 'gz',
    })
  })

  it('handles names without an extension', () => {
    expect(splitFileName('noext')).toEqual({ base: 'noext', ext: '' })
    // dotfiles have no meaningful extension
    expect(splitFileName('.hidden')).toEqual({ base: '.hidden', ext: '' })
  })
})

describe('resolveConversionName', () => {
  it('derives the target name from the source', () => {
    expect(resolveConversionName('logo.svg', 'pdf', () => false)).toBe(
      'logo.pdf'
    )
    expect(resolveConversionName('logo.svg', 'png', () => false)).toBe(
      'logo.png'
    )
  })

  it('loops around existing names in the folder', () => {
    const exists = (n) => ['logo.pdf', 'logo-1.pdf'].includes(n)
    expect(resolveConversionName('logo.svg', 'pdf', exists)).toBe(
      'logo-2.pdf'
    )
    expect(resolveConversionName('logo.svg', 'png', () => false)).toBe(
      'logo.png'
    )
  })

  it('only treats the target extension as a collision', () => {
    // logo.pdf exists, but we convert to png → no collision
    const exists = (n) => n === 'logo.pdf'
    expect(resolveConversionName('logo.svg', 'png', exists)).toBe('logo.png')
  })
})

describe('computeSvgPixelSize', () => {
  it('prefers explicit width/height', () => {
    expect(computeSvgPixelSize('<svg width="100" height="50"></svg>')).toEqual({
      width: 100,
      height: 50,
    })
  })

  it('reads numeric attributes with units', () => {
    expect(
      computeSvgPixelSize('<svg width="300px" height="200px"></svg>')
    ).toEqual({ width: 300, height: 200 })
  })

  it('derives the missing dimension from the viewBox aspect', () => {
    expect(computeSvgPixelSize('<svg width="200" viewBox="0 0 10 5"></svg>')).toEqual(
      { width: 200, height: 100 }
    )
    expect(computeSvgPixelSize('<svg height="100" viewBox="0 0 10 5"></svg>')).toEqual(
      { width: 200, height: 100 }
    )
  })

  it('uses the viewBox aspect for viewBox-only documents', () => {
    expect(computeSvgPixelSize('<svg viewBox="0 0 4 2"></svg>')).toEqual({
      width: 1200,
      height: 600,
    })
  })

  it('falls back to the 1200x1200 default', () => {
    expect(computeSvgPixelSize('<svg></svg>')).toEqual({
      width: 1200,
      height: 1200,
    })
  })
})

describe('convertAndUpload', () => {
  const okFetchPair = (calls) => {
    let i = 0
    return async (input, init) => {
      calls[i] = { url: input, body: init && init.body }
      i += 1
      if (input.includes('/blob/')) {
        return new Response('<svg width="10" height="10"></svg>', {
          status: 200,
        })
      }
      return Response.json({ entity_id: 'E123', hash: 'h' })
    }
  }

  const fakeConvert = async () =>
    new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' })

  it('fetches the original, converts and uploads under the derived name', async () => {
    const calls = [{}, {}, {}]
    const result = await convertAndUpload({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'logo.svg',
      target: 'pdf',
      convert: fakeConvert,
      csrfToken: 'CSRF',
      fetchImpl: okFetchPair(calls),
    })
    expect(result).toEqual({ ok: true, name: 'logo.pdf', uploadedId: 'E123' })

    expect(calls[0].url).toBe('/project/PID/blob/HASH')
    const uploadUrl = calls[1].url
    expect(uploadUrl).toContain('/project/PID/upload?folder_id=F1')
    const fd = calls[1].body
    expect(fd.get('name')).toBe('logo.pdf')
    const file = fd.get('qqfile')
    expect(file.name).toBe('logo.pdf')
    expect(await file.text()).toBe('%PDF-1.4 fake')
  })

  it('avoids colliding names with the exists predicate', async () => {
    const calls = [{}, {}, {}]
    const result = await convertAndUpload({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'logo.svg',
      target: 'pdf',
      exists: (n) => n === 'logo.pdf',
      convert: fakeConvert,
      fetchImpl: okFetchPair(calls),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('logo-1.pdf')
    }
    expect(calls[1].body.get('name')).toBe('logo-1.pdf')
  })

  it('surfaces a failed fetch of the original', async () => {
    const result = await convertAndUpload({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'logo.svg',
      target: 'png',
      convert: fakeConvert,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/404/)
    }
  })

  it('surfaces an empty original', async () => {
    const result = await convertAndUpload({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'logo.svg',
      target: 'png',
      convert: fakeConvert,
      fetchImpl: async () => new Response('   ', { status: 200 }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i)
    }
  })

  it('surfaces a failed upload', async () => {
    const fetchImpl = async (input) => {
      if (input.includes('/blob/')) {
        return new Response('<svg/>', { status: 200 })
      }
      return new Response('denied', { status: 500 })
    }
    const result = await convertAndUpload({
      projectId: 'PID',
      downloadPath: '/project/PID/blob/HASH',
      folderId: 'F1',
      sourceName: 'logo.svg',
      target: 'png',
      convert: fakeConvert,
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/500/)
    }
  })
})
