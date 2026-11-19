import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import TypstSourcemap from '../../../app/js/TypstSourcemap.js'

const {
  parse,
  offsetAt,
  lineColAt,
  nearestByOffset,
  nearestByPoint,
  viewRecord,
  loadSidecar,
} = TypstSourcemap
const { NotCompiledError, NotFoundError, SourcemapError } =
  TypstSourcemap.errors

const SIDECAR = {
  typst: '0.15.1+clsi',
  pages: 2,
  pageSizes: [
    [595, 842],
    [595, 842],
  ],
  locations: [
    { span: { file: 'main.typ', byteOffset: 10 }, page: 0, x: 72, y: 700, w: 100, h: 12 },
    { span: { file: 'main.typ', byteOffset: 40 }, page: 0, x: 72, y: 680, w: 90, h: 12 },
    { span: { file: 'chapters/intro.typ', byteOffset: 5 }, page: 1, x: 72, y: 770, w: 80, h: 12 },
  ],
}

describe('parse', () => {
  it('parses a valid sidecar', () => {
    const sm = parse(JSON.stringify(SIDECAR))
    expect(sm.pages).toBe(2)
    expect(sm.locations).toHaveLength(3)
  })

  it('defaults empty locations/pageSizes to arrays', () => {
    const sm = parse('{}')
    expect(sm.locations).toEqual([])
    expect(sm.pageSizes).toEqual([])
  })

  it('rejects malformed json', () => {
    expect(() => parse('not json')).toThrow(SourcemapError)
  })
})

describe('offsetAt / lineColAt', () => {
  const content = 'line one\nline two\nline three'

  it('maps (1,1) to 0', () => {
    expect(offsetAt(content, 1, 1)).toBe(0)
  })

  it('maps within a line', () => {
    // "line one" is 8 chars; column 5 -> offset 4
    expect(offsetAt(content, 1, 5)).toBe(4)
  })

  it('maps line 2 to after the first newline', () => {
    expect(offsetAt(content, 2, 1)).toBe(9)
  })

  it('saturates past the end', () => {
    expect(offsetAt(content, 99, 1)).toBe(content.length)
  })

  it('round-trips lineColAt(offsetAt())', () => {
    for (const [line, column] of [
      [1, 1],
      [1, 5],
      [2, 1],
      [2, 7],
      [3, 3],
    ]) {
      const offset = offsetAt(content, line, column)
      const back = lineColAt(content, offset)
      expect(back).toEqual({ line, column })
    }
  })

  it('saturates lineColAt at boundaries', () => {
    expect(lineColAt(content, -5)).toEqual({ line: 1, column: 1 })
    expect(lineColAt(content, 100000).line).toBe(3)
  })
})

describe('nearestByOffset', () => {
  it('picks the nearest location for a file', () => {
    const loc = nearestByOffset(SIDECAR.locations, 'main.typ', 12)
    expect(loc.span.byteOffset).toBe(10)
    const loc2 = nearestByOffset(SIDECAR.locations, 'main.typ', 30)
    expect(loc2.span.byteOffset).toBe(40)
  })

  it('returns null when the file has no locations', () => {
    expect(nearestByOffset(SIDECAR.locations, 'other.typ', 0)).toBeNull()
  })
})

describe('nearestByPoint', () => {
  it('picks the nearest location on a 0-based page', () => {
    const loc = nearestByPoint(SIDECAR.locations, 0, 75, 695)
    expect(loc.span.byteOffset).toBe(40)
    const loc1 = nearestByPoint(SIDECAR.locations, 1, 70, 770)
    expect(loc1.span.file).toBe('chapters/intro.typ')
  })

  it('returns null when the page has no locations', () => {
    expect(nearestByPoint(SIDECAR.locations, 5, 0, 0)).toBeNull()
  })
})

describe('viewRecord', () => {
  it('maps the sidecar box onto the clsi synctex wire (page 1-based)', () => {
    const rec = viewRecord(SIDECAR.locations[0])
    expect(rec).toEqual({
      page: 1,
      h: 72,
      v: 700,
      width: 100,
      height: 12,
    })
  })
})

describe('loadSidecar', () => {
  async function expectRejection(fn, Ctor, projectId = 'proj-1') {
    try {
      await fn(projectId)
    } catch (err) {
      expect(err).toBeInstanceOf(Ctor)
      return
    }
    throw new Error('expected rejection')
  }

  it('405 arm: output.pdf missing -> NotCompiledError', async () => {
    const dir = await fs.mkdtemp(Path.join(os.tmpdir(), 'clsi-typst-'))
    await expectRejection(pid => loadSidecar(dir, pid), NotCompiledError)
  })

  it('404 arm: no sidecar -> NotFoundError', async () => {
    const dir = await fs.mkdtemp(Path.join(os.tmpdir(), 'clsi-typst-'))
    await fs.writeFile(Path.join(dir, 'output.pdf'), 'x')
    await expectRejection(pid => loadSidecar(dir, pid), NotFoundError)
  })

  it('loads a valid sidecar', async () => {
    const dir = await fs.mkdtemp(Path.join(os.tmpdir(), 'clsi-typst-'))
    await fs.writeFile(Path.join(dir, 'output.pdf'), 'x')
    await fs.writeFile(
      Path.join(dir, 'output.sourcemap.json'),
      JSON.stringify(SIDECAR)
    )
    const sm = await loadSidecar(dir, 'proj-1')
    expect(sm.locations).toHaveLength(3)
  })
})
