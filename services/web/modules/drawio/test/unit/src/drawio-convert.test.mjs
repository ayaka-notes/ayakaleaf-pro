import { describe, expect, it } from 'vitest'

import {
  isDrawioFile,
  splitFileName,
  resolveConversionName,
  computeRasterPixelSize,
  diagramToSvg,
  convertAndUpload,
} from '../../../frontend/js/util/drawio-convert'

describe('isDrawioFile', () => {
  it('matches .drawio names', () => {
    expect(isDrawioFile('diagram.drawio')).toBe(true)
    expect(isDrawioFile('flow/DRAWIO.drawio')).toBe(true)
    expect(isDrawioFile('flow.drawio.bak')).toBe(false)
    expect(isDrawioFile('drawio')).toBe(false)
    expect(isDrawioFile('main.tex')).toBe(false)
    expect(isDrawioFile('')).toBe(false)
  })
})

describe('splitFileName', () => {
  it('splits the last extension', () => {
    expect(splitFileName('diagram.drawio')).toEqual({
      base: 'diagram',
      ext: 'drawio',
    })
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
    expect(resolveConversionName('diagram.drawio', 'pdf', () => false)).toBe(
      'diagram.pdf'
    )
    expect(resolveConversionName('diagram.drawio', 'png', () => false)).toBe(
      'diagram.png'
    )
  })

  it('loops around existing names in the folder', () => {
    const exists = (n) => ['diagram.pdf', 'diagram-1.pdf'].includes(n)
    expect(resolveConversionName('diagram.drawio', 'pdf', exists)).toBe(
      'diagram-2.pdf'
    )
    expect(resolveConversionName('diagram.drawio', 'png', exists)).toBe(
      'diagram.png'
    )
  })
})

describe('computeRasterPixelSize', () => {
  it('prefers explicit width/height', () => {
    expect(
      computeRasterPixelSize('<svg width="300" height="200"></svg>')
    ).toEqual({ width: 300, height: 200 })
  })

  it('falls back to the viewBox, scaled to a 1200px longest side', () => {
    expect(
      computeRasterPixelSize('<svg viewBox="0 0 40 20"></svg>')
    ).toEqual({ width: 1200, height: 600 })
  })

  it('uses the 1200px default otherwise', () => {
    expect(computeRasterPixelSize('<svg></svg>')).toEqual({
      width: 1200,
      height: 1200,
    })
  })
})

describe('diagramToSvg', () => {
  it('returns the renderer output when it is an SVG document', async () => {
    const svg = '<svg width="10" height="10"><rect/></svg>'
    await expect(
      diagramToSvg('<mxGraphModel/>', () => svg)
    ).resolves.toBe(svg)
  })

  it('rejects empty input', async () => {
    await expect(
      diagramToSvg('   ', () => '<svg></svg>')
    ).rejects.toThrow('empty')
  })

  it('rejects non-SVG renderer output', async () => {
    await expect(
      diagramToSvg('<mxGraphModel/>', () => 'not an svg')
    ).rejects.toThrow('<svg>')
  })
})

describe('convertAndUpload', () => {
  const sourceText = '<mxGraphModel><root/></mxGraphModel>'
  const svgText = '<svg width="10" height="10"></svg>'

  const fakeFetch = (calls) =>
    (async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/upload')) {
        return new Promise((resolve) =>
          setTimeout(() => resolve(new Response(JSON.stringify({ entity_id: 'up-1' }), { status: 200 })), 0)
        )
      }
      return new Promise((resolve) =>
        setTimeout(() => resolve(new Response(sourceText, { status: 200 })), 0)
      )
    })

  const fakeRenderer = () => svgText
  const fakeConvert = () =>
    Promise.resolve(new Blob(['payload'], { type: 'image/png' }))

  it('fetches, renders, converts and uploads into the source folder', async () => {
    const calls = []
    const result = await convertAndUpload({
      projectId: 'p1',
      downloadPath: '/project/p1/blob/hash1',
      folderId: 'folder1',
      sourceName: 'diagram.drawio',
      target: 'pdf',
      fetchImpl: fakeFetch(calls),
      renderDiagram: fakeRenderer,
      convert: fakeConvert,
      csrfToken: 'tok',
    })

    expect(result).toEqual({ ok: true, name: 'diagram.pdf', uploadedId: 'up-1' })

    expect(calls[0].url).toBe('/project/p1/blob/hash1')
    expect(calls[1].url).toBe('/project/p1/upload?folder_id=folder1')
    expect(calls[1].init.headers['X-CSRF-TOKEN']).toBe('tok')
    const body = calls[1].init.body
    expect(body).toBeInstanceOf(FormData)
    const entry = body.get('qqfile')
    expect(entry.name).toBe('diagram.pdf')
    expect(body.get('name')).toBe('diagram.pdf')
  })

  it('avoids name collisions via the exists predicate', async () => {
    const calls = []
    const result = await convertAndUpload({
      projectId: 'p1',
      downloadPath: '/project/p1/blob/hash1',
      folderId: 'folder1',
      sourceName: 'diagram.drawio',
      target: 'png',
      exists: (n) => n === 'diagram.png',
      fetchImpl: fakeFetch(calls),
      renderDiagram: fakeRenderer,
      convert: fakeConvert,
    })
    expect(result).toMatchObject({ ok: true, name: 'diagram-1.png' })
  })

  it('reports upload failures as a result', async () => {
    const failingFetch = (async () => {
      throw new Error('boom')
    })
    const result = await convertAndUpload({
      projectId: 'p1',
      downloadPath: '/project/p1/blob/hash1',
      folderId: 'folder1',
      sourceName: 'diagram.drawio',
      target: 'pdf',
      fetchImpl: failingFetch,
      renderDiagram: fakeRenderer,
      convert: fakeConvert,
    })
    expect(result).toEqual({ ok: false, error: 'boom' })
  })
})
