import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import zlib from 'node:zlib'

const adapterPath = new URL('../../../app/js/SynctexAdapter.js', import.meta.url).pathname
const sourcemapPath = new URL('../../../app/js/TypstSourcemap.js', import.meta.url).pathname

// Real tinymist output (fingolfin/tinymist `synctex` branch, 4eef4a4),
// captured from:
//   main.typ:  1:#import "chap/intro.typ" 2: 3:= Main title 4: 5:#let x = 42
//              6:The value is #x. 7: 8:#figure([Click me.], caption: [A box.]) <fig:1>
//              9: 10:See @fig:1 again, and the value #x.
//   tinymist compile --synctex main.typ output.pdf
const REAL_SYNCTEX = [
  'SyncTeX Version:1',
  'Input:1:/compile/main.typ',
  'Output:pdf',
  'Magnification:1000',
  'Unit:1',
  'X Offset:0',
  'Y Offset:0',
  'Content:',
  '{1',
  '[1,3:0,55380990:39158276,55380990,0',
  '(1,3:4661700,5315110:4502959,905657,249208',
  ')',
  '(1,6:4661700,6333938:4586896,646898,178005',
  ')',
  '(1,8:18261464,7678385:2762702,646898,178005',
  ')',
  '(1,8:20056714,8624853:1921156,646898,178005',
  ')',
  '(1,10:4661700,9969301:1183809,646898,178005',
  ')',
  '(1,10:8242793,9969301:7126730,646898,178005',
  ')',
  ']',
  '}1',
  'Postamble:',
  'Count:7',
  'Post scriptum:',
  '',
].join('\n')

const MAIN_TYP =
  '#import "chap/intro.typ"\n' +
  '\n' +
  '= Main title\n' +
  '\n' +
  '#let x = 42\n' +
  'The value is #x.\n' +
  '\n' +
  '#figure([Click me.], caption: [A box.]) <fig:1>\n' +
  '\n' +
  'See @fig:1 again, and the value #x.\n'

// The adapter's logger import must be mocked before it loads (same pattern
// as TypstRunner.test.js): vi.doMock in beforeEach + dynamic import.
let A
let S
beforeEach(async () => {
  vi.doMock('@overleaf/logger', () => ({
    default: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }))
  A = (await import(adapterPath)).default
  S = (await import(sourcemapPath)).default
})
afterEach(() => {
  vi.resetModules()
})

const K = () => A.SP_PER_PT
const PAGE_H = () => 55380990 / A.SP_PER_PT
const PAGE_W = () => 39158276 / A.SP_PER_PT

describe('parseSyncTex', () => {
  it('parses the real tinymist output (split-line records included)', () => {
    const { files, pages } = A.parseSyncTex(REAL_SYNCTEX)
    expect(files).toEqual(['/compile/main.typ'])
    expect(pages).toHaveLength(1)
    expect(pages[0].number).toBe(1)
    expect(pages[0].width).toBe(39158276)
    expect(pages[0].height).toBe(55380990)
    expect(pages[0].records).toHaveLength(6)
    expect(pages[0].records[0]).toEqual({
      tag: 1,
      line: 3,
      offset: null,
      x: 4661700,
      y: 5315110,
      width: 4502959,
      ascent: 905657,
      depth: 249208,
    })
    expect(pages[0].records[5]).toMatchObject({ tag: 1, line: 10 })
  })

  it('parses multi-page, multi-file content', () => {
    const text = [
      'SyncTeX Version:1',
      'Input:1:/compile/main.typ',
      'Input:2:/compile/chap/intro.typ',
      'Content:',
      '{1',
      '[1,3:0,55380990:39158276,55380990,0',
      '(1,3:100,200:300,400,50',
      ')',
      ']',
      '}1',
      '{2',
      '[2,1:0,55380990:39158276,55380990,0',
      '(2,1:100,200:300,400,50',
      ')',
      ']',
      '}2',
      'Postamble:',
      'Count:4',
    ].join('\n')
    const { files, pages } = A.parseSyncTex(text)
    expect(files).toEqual(['/compile/main.typ', '/compile/chap/intro.typ'])
    expect(pages).toHaveLength(2)
    expect(pages[1].records[0].tag).toBe(2)
  })

  it('stops at the postamble', () => {
    const text = REAL_SYNCTEX + '\ngarbage (9,9:1,1:1,1,1\n'
    const { pages } = A.parseSyncTex(text)
    expect(pages[0].records).toHaveLength(6)
  })
})

describe('lineStartOffset', () => {
  const content = 'line1\nline2\nline3\n'
  it('maps 1-based lines to 0-based offsets', () => {
    expect(A.lineStartOffset(content, 1)).toBe(0)
    expect(A.lineStartOffset(content, 2)).toBe(6)
    expect(A.lineStartOffset(content, 3)).toBe(12)
  })
  it('saturates past the last line', () => {
    expect(A.lineStartOffset(content, 99)).toBe(content.length)
  })
})

describe('relativizePath', () => {
  it('strips the container compile root', () => {
    expect(A.relativizePath('/compile/main.typ', '/compile')).toBe('main.typ')
    expect(A.relativizePath('/compile/chap/intro.typ', '/compile')).toBe('chap/intro.typ')
  })
  it('falls back to the basename without the root', () => {
    expect(A.relativizePath('/elsewhere/x/main.typ', '/compile')).toBe('main.typ')
    expect(A.relativizePath('main.typ', '/compile')).toBe('main.typ')
  })
})

describe('toSidecar', () => {
  const readMain = vi.fn(file => {
    if (file === 'main.typ') return Promise.resolve(MAIN_TYP)
    const err = new Error('no such file')
    err.code = 'ENOENT'
    return Promise.reject(err)
  })

  it('converts coordinates to PDF user space (points, y up from bottom)', async () => {
    const sidecar = await A.toSidecar(A.parseSyncTex(REAL_SYNCTEX), {
      readContent: readMain,
    })
    expect(sidecar.pages).toBe(1)
    expect(sidecar.pageSizes[0][0]).toBeCloseTo(PAGE_W(), 1)
    expect(sidecar.pageSizes[0][1]).toBeCloseTo(PAGE_H(), 1)
    expect(sidecar.pageSizes[0][0]).toBeCloseTo(595.28, 1)
    expect(sidecar.pageSizes[0][1]).toBeCloseTo(841.89, 1)

    const loc = sidecar.locations[0] // line 3: the heading
    expect(loc.page).toBe(0)
    expect(loc.span.file).toBe('main.typ')
    expect(loc.span.byteOffset).toBe(26) // start of line 3 in MAIN_TYP
    expect(loc.x).toBeCloseTo(4661700 / K(), 1)
    expect(loc.w).toBeCloseTo(4502959 / K(), 1)
    expect(loc.h).toBeCloseTo((905657 + 249208) / K(), 1)
    // y = distance of the box BOTTOM from the page BOTTOM
    expect(loc.y).toBeCloseTo(PAGE_H() - 5315110 / K() - 249208 / K(), 1)
  })

  it('keeps same-line runs distinct (two runs on line 10)', async () => {
    const sidecar = await A.toSidecar(A.parseSyncTex(REAL_SYNCTEX), {
      readContent: readMain,
    })
    const byLine10 = sidecar.locations.filter(
      l => l.span.byteOffset === A.lineStartOffset(MAIN_TYP, 10)
    )
    expect(byLine10).toHaveLength(2)
    const xs = byLine10.map(l => l.x).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeGreaterThan(0)
  })

  it('uses the explicit byte offset when present (word-level, not line start)', async () => {
    // Same record as REAL_SYNCTEX's first run, but with the third link field
    // (byte offset 28) that the --synctex writer now emits.
    const WITH_OFFSET = [
      'SyncTeX Version:1',
      'Input:1:/compile/main.typ',
      'Output:pdf',
      'Magnification:1000',
      'Unit:1',
      'X Offset:0',
      'Y Offset:0',
      'Content:',
      '{1',
      '[1,3:0,55380990:39158276,55380990,0',
      '(1,3,28:4661700,5315110:4502959,905657,249208',
      ')',
      ']',
      '}1',
      'Postamble:',
      'Count:2',
      'Post scriptum:',
      '',
    ].join('\n')
    const parsed = A.parseSyncTex(WITH_OFFSET)
    // The parser captures the third link field as an explicit byte offset.
    expect(parsed.pages[0].records[0].offset).toBe(28)
    const sidecar = await A.toSidecar(parsed, { readContent: readMain })
    const loc = sidecar.locations[0]
    // 28 is NOT the line start (26): proves the explicit offset is used, so a
    // cursor lands on the exact spot rather than the start of the line.
    expect(A.lineStartOffset(MAIN_TYP, 3)).toBe(26)
    expect(loc.span.byteOffset).toBe(28)
  })

  it('degrades to byteOffset 0 when the source file is unreadable', async () => {
    const parsed = A.parseSyncTex(
      REAL_SYNCTEX.replace('/compile/main.typ', '/compile/missing.typ')
    )
    const sidecar = await A.toSidecar(parsed, {
      readContent: file => {
        const err = new Error('no such file')
        err.code = 'ENOENT'
        return Promise.reject(err)
      },
    })
    expect(sidecar.locations).toHaveLength(6)
    expect(sidecar.locations.every(l => l.span.byteOffset === 0)).toBe(true)
  })

  it('feeds the consumer (TypstSourcemap) unchanged', async () => {
    const sidecar = await A.toSidecar(A.parseSyncTex(REAL_SYNCTEX), {
      readContent: readMain,
    })
    const sm = S.parse(JSON.stringify(sidecar))
    expect(sm.locations).toHaveLength(6)
    // round-trip: byteOffset -> (line 3, column 1)
    const { line, column } = S.lineColAt(MAIN_TYP, 26)
    expect(line).toBe(3)
    expect(column).toBe(1)
    // hit-test: a point inside the heading box resolves to the heading
    const box = sm.locations[0]
    const hit = S.nearestByPoint(sm.locations, 0, box.x + 5, box.y + box.h / 2)
    expect(hit.span.byteOffset).toBe(26)
    // forward lookup: cursor at line 6 -> the line-6 location
    const fwd = S.nearestByOffset(
      sm.locations,
      'main.typ',
      S.offsetAt(MAIN_TYP, 6, 1)
    )
    expect(fwd.span.byteOffset).toBe(A.lineStartOffset(MAIN_TYP, 6))
  })
})

describe('synctexToSidecar (end-to-end)', () => {
  let dir
  beforeEach(async () => {
    dir = await fs.mkdtemp(Path.join(os.tmpdir(), 'synctex-adapter-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reads the .gz and writes output.sourcemap.json next to the PDF', async () => {
    await fs.writeFile(dir + '/output.pdf', '%PDF-1.7 fake')
    await fs.writeFile(
      dir + '/output.synctex.gz',
      zlib.gzipSync(Buffer.from(REAL_SYNCTEX, 'utf8'))
    )
    await fs.mkdir(dir + '/chap', { recursive: true })
    await fs.writeFile(dir + '/main.typ', MAIN_TYP)
    await fs.writeFile(dir + '/chap/intro.typ', 'x')

    const sidecar = await A.synctexToSidecar(dir)
    expect(sidecar.locations).toHaveLength(6)

    const written = JSON.parse(
      await fs.readFile(dir + '/output.sourcemap.json', 'utf8')
    )
    expect(written).toEqual(sidecar)
    // and the consumer can load it from disk
    const sm = await S.loadSidecar(dir, 'test-project')
    expect(sm.locations).toHaveLength(6)
  })

  it('propagates ENOENT when the .gz is absent', async () => {
    await fs.writeFile(dir + '/output.pdf', '%PDF-1.7 fake')
    let err = null
    try {
      await A.synctexToSidecar(dir)
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: 'ENOENT' })
  })
})
