import { describe, expect, it } from 'vitest'

import {
  isDrawioFile,
  splitFileName,
  resolveConversionName,
  computeRasterPixelSize,
  diagramToSvg,
  convertAndUpload,
  resolveCssValue,
  sanitizeSvgForExport,
} from '../../../frontend/js/util/drawio-convert'
import { modelSignature, parseDrawioFile } from '../../../frontend/js/util/drawio-protocol'

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

describe('resolveCssValue', () => {
  it('keeps plain values', () => {
    expect(resolveCssValue('#ffffff')).toBe('#ffffff')
    expect(resolveCssValue('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)')
    expect(resolveCssValue('transparent')).toBe('transparent')
  })

  it('resolves light-dark() to the light value', () => {
    expect(
      resolveCssValue('light-dark(rgb(0, 0, 0), rgb(255, 255, 255))')
    ).toBe('rgb(0, 0, 0)')
    expect(resolveCssValue('light-dark(#fff, #000)')).toBe('#fff')
    // nested functions in the light value survive
    expect(
      resolveCssValue('light-dark(rgb(10, 20, 30), rgb(1, 2, 3))')
    ).toBe('rgb(10, 20, 30)')
  })

  it('resolves var() to the fallback (recursively)', () => {
    expect(resolveCssValue('var(--ge-adaptive-bg, #ffffff)')).toBe('#ffffff')
    expect(
      resolveCssValue('var(--x, light-dark(#fff, #000))')
    ).toBe('#fff')
    expect(
      resolveCssValue('var(--a, var(--b, rgb(1, 2, 3)))')
    ).toBe('rgb(1, 2, 3)')
  })

  it('rejects unresolvable values', () => {
    expect(resolveCssValue('var(--no-fallback)')).toBeNull()
    expect(resolveCssValue('')).toBeNull()
    expect(resolveCssValue('  ')).toBeNull()
    expect(resolveCssValue('var(--a,)')).toBeNull()
  })
})

describe('sanitizeSvgForExport', () => {
  it('resolves draw.io adaptive-color inline styles to light values', () => {
    const svg =
      '<svg width="133" height="67">' +
      '<style type="text/css">@supports (color: light-dark(#000, #fff)) {' +
      ' #x { --ge-adaptive-bg: light-dark(#ffffff, #121212); } }</style>' +
      '<rect fill="#ffffff" stroke="#000000" style="fill: var(--ge-adaptive-bg, #ffffff); stroke: light-dark(rgb(0, 0, 0), rgb(255, 255, 255));"/>' +
      '<g fill="#000000" style="fill: light-dark(rgb(0, 0, 0), rgb(255, 255, 255));"><text>x</text></g>' +
      '</svg>'
    const out = sanitizeSvgForExport(svg)
    expect(out).toContain('fill="#ffffff"')
    expect(out).toContain('stroke="#000000"')
    expect(out).toContain('fill: #ffffff')
    expect(out).toContain('stroke: rgb(0, 0, 0)')
    expect(out).not.toContain('light-dark(')
    expect(out).not.toContain('var(')
    expect(out).not.toContain('<style')
    // geometry and plain attributes are untouched
    expect(out).toMatch(/width="133" height="67"/)
  })

  it('drops unresolvable declarations but keeps the rest', () => {
    const svg =
      '<svg><rect style="fill: var(--unknown); stroke: #00f; opacity: 0.5"/></svg>'
    const out = sanitizeSvgForExport(svg)
    expect(out).not.toContain('var(')
    expect(out).toContain('stroke: #00f')
    expect(out).toContain('opacity: 0.5')
  })

  it('removes the style attribute entirely when nothing resolves', () => {
    const svg = '<svg><rect style="fill: var(--unknown)"/></svg>'
    const out = sanitizeSvgForExport(svg)
    expect(out).not.toContain('style=')
    expect(out).toContain('<rect/>')
  })

  it('leaves svgs without adaptive css unchanged', () => {
    const svg = '<svg width="10"><rect fill="#fff"/></svg>'
    expect(sanitizeSvgForExport(svg)).toBe(svg)
  })
})

describe('modelSignature', () => {
  it('fingerprint matches for the same diagram, differs between diagrams', () => {
    const a =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="abc-1" value="Shape A" parent="1"/></root></mxGraphModel>'
    const b =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="xyz-9" value="Shape B" parent="1"/></root></mxGraphModel>'
    expect(modelSignature(a)).not.toBe('')
    expect(modelSignature(a)).not.toBe(modelSignature(b))
  })

  it('is order-insensitive for cell elements', () => {
    const one =
      '<mxGraphModel><mxCell id="a" value="1"/><mxCell id="b" value="2"/></mxGraphModel>'
    const two =
      '<mxGraphModel><mxCell id="b" value="2"/><mxCell id="a" value="1"/></mxGraphModel>'
    expect(modelSignature(one)).toBe(modelSignature(two))
  })

  it('handles mxfile documents through parseDrawioFile', () => {
    const doc =
      '<mxfile host="x"><diagram id="p" name="Page-1">' +
      '&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id="0"/&gt;&lt;mxCell id="7" value="hi" parent="0"/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;' +
      '</diagram></mxfile>'
    const parsed = parseDrawioFile(doc)
    expect(parsed).not.toBeNull()
    if (parsed && parsed.form === 'inline') {
      expect(modelSignature(parsed.xml)).toContain('7|hi')
    }
  })

  it('is empty for non-diagram content', () => {
    expect(modelSignature('no cells here')).toBe('')
    expect(modelSignature('')).toBe('')
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
