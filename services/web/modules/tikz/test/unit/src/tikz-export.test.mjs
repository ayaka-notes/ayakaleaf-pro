import { describe, expect, it } from 'vitest'
import {
  buildPdf,
  hasTikzSvgContent,
  tikzPdfObjectBodies
} from '../../../frontend/js/util/tikz-export-util'
import {
  isTikzExportError,
  isTikzExportNotReady,
  parseTikzSvgViewBox,
  TIKZ_EXPORT_FORMATS,
  TIKZ_EXPORT_MIME,
  tikzExportTargetName
} from '../../../frontend/js/util/tikz-export-util'

describe('tikz-export-util', function () {
  describe('TIKZ_EXPORT_FORMATS', function () {
    it('covers exactly png, svg and pdf', function () {
      expect([...TIKZ_EXPORT_FORMATS].sort()).toEqual(['pdf', 'png', 'svg'])
    })

    it('has a mime type per format', function () {
      for (const format of TIKZ_EXPORT_FORMATS) {
        expect(TIKZ_EXPORT_MIME[format]).toMatch(/^[a-z0-9]+\/[a-z0-9.+-]+$/)
      }
      expect(TIKZ_EXPORT_MIME.png).toBe('image/png')
      expect(TIKZ_EXPORT_MIME.pdf).toBe('application/pdf')
      expect(TIKZ_EXPORT_MIME.svg).toBe('image/svg+xml')
    })
  })

  describe('tikzExportTargetName', function () {
    it('replaces the tikz extension with the export extension', function () {
      expect(tikzExportTargetName('drawing.tikz', 'png')).toBe('drawing.png')
      expect(tikzExportTargetName('drawing.tikz', 'svg')).toBe('drawing.svg')
      expect(tikzExportTargetName('drawing.tikz', 'pdf')).toBe('drawing.pdf')
    })

    it('supports pgf sources and nested names', function () {
      expect(tikzExportTargetName('sub/fig.pgf', 'png')).toBe('sub/fig.png')
      expect(tikzExportTargetName('A_B-C.TIKZ', 'svg')).toBe('A_B-C.svg')
    })

    it('only replaces a trailing tikz/pgf extension', function () {
      expect(tikzExportTargetName('notes.md', 'png')).toBe('notes.md.png')
    })
  })

  describe('parseTikzSvgViewBox', function () {
    it('reads width/height from a standard viewBox', function () {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-18 -18 64.4528 64.4528"><path d="M0 0"/></svg>'
      const d = parseTikzSvgViewBox(svg)
      expect(d).not.toBeNull()
      expect(d.width).toBeCloseTo(64.4528)
      expect(d.height).toBeCloseTo(64.4528)
    })

    it('handles comma- and space-separated values and quoted forms', function () {
      expect(parseTikzSvgViewBox('<svg viewBox="0 0, 100 50">')).toEqual({
        width: 100,
        height: 50
      })
      expect(parseTikzSvgViewBox('<svg viewBox=\'1 2 3 4\'/>')).toEqual({
        width: 3,
        height: 4
      })
    })

    it('returns null for missing or degenerate viewBoxes', function () {
      expect(parseTikzSvgViewBox('<svg width="10"></svg>')).toBeNull()
      expect(parseTikzSvgViewBox('<svg viewBox="0 0 0 10">')).toBeNull()
      expect(parseTikzSvgViewBox('<svg viewBox="a b c d">')).toBeNull()
      expect(parseTikzSvgViewBox('')).toBeNull()
    })
  })

  describe('isTikzExportNotReady / isTikzExportError', function () {
    const notReady = { event: 'export', error: 'SVG is not ready yet.' }
    const hard = { event: 'export', error: 'boom' }
    const ok = { event: 'export', data: '<svg/>' }

    it('flags "not ready" retry signals', function () {
      expect(isTikzExportNotReady(notReady)).toBe(true)
      expect(isTikzExportNotReady(hard)).toBe(false)
      expect(isTikzExportNotReady(null)).toBe(false)
    })

    it('flags any non-empty error as an error', function () {
      expect(isTikzExportError(notReady)).toBe(true)
      expect(isTikzExportError(hard)).toBe(true)
      expect(isTikzExportError(ok)).toBe(false)
      expect(isTikzExportError(null)).toBe(false)
    })
  })

  describe('hasTikzSvgContent', function () {
    it('rejects empty canvases', function () {
      expect(hasTikzSvgContent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-18 -18 92.9 64.4"></svg>')).toBe(false)
      expect(hasTikzSvgContent('<svg viewBox="0 0 10 10">  </svg>')).toBe(false)
      expect(hasTikzSvgContent('')).toBe(false)
      expect(hasTikzSvgContent(null)).toBe(false)
    })

    it('accepts SVGs with figure content', function () {
      expect(hasTikzSvgContent('<svg viewBox="0 0 10 10"><path d="M0 0 L1 1" fill="red"/></svg>')).toBe(true)
      expect(hasTikzSvgContent('<svg viewBox="0 0 10 10"><text>Hi</text></svg>')).toBe(true)
      expect(hasTikzSvgContent('<svg viewBox="0 0 10 10"><defs><clipPath id="a"><rect/></clipPath></defs><rect/></svg>')).toBe(true)
    })
  })

  describe('generated PDF structure (strict mini-parser)', function () {
    // A deliberately picky tokenizer: walks every top-level object and
    // requires balanced << >> dictionaries, proper stream/endstream pairs,
    // exact /Length values, and valid xref offsets. Catches the class of
    // bug where a dictionary is closed with a single '>' (renders as a
    // blank page in every real viewer).
    function assemble (stream) {
      const blob = buildPdf({
        objects: tikzPdfObjectBodies({
          ptW: 100,
          ptH: 80,
          width: 10,
          height: 8,
          compressed: false,
          streamLength: stream.length,
        }),
        stream
      })
      // Blob → Uint8Array synchronously is not available; mirror buildPdf's
      // byte layout via its parts (same encoder) instead.
      return blob
    }

    function bytesOf (blob) {
      return blob.arrayBuffer().then(buf => new Uint8Array(buf))
    }

    function parseDictionaries (s, from, end) {
      // from `from` (pointing at '<') parse one dictionary; return the index
      // just past its closing '>>'
      expect(s.slice(from, from + 2)).toBe('<<')
      let i = from + 2
      let depth = 1
      while (i < end) {
        if (s.slice(i, i + 2) === '<<') { depth += 1; i += 2; continue }
        if (s.slice(i, i + 2) === '>>') {
          depth -= 1
          i += 2
          if (depth === 0) return i
          continue
        }
        i += 1
      }
      throw new Error(`unbalanced dictionary starting at ${from}: ${JSON.stringify(s.slice(from, Math.min(end, from + 80)))}`)
    }

    it('all dictionaries are balanced and streams are exact', async function () {
      const stream = new Uint8Array([1, 2, 3, 4])
      const bytes = await bytesOf(assemble(stream))
      const s = new TextDecoder().decode(bytes)
      expect(s.startsWith('%PDF-1.4')).toBe(true)

      // walk objects 1..5 in order
      let cursor = s.search(/\d+ 0 obj\n/)
      let objectNo = 0
      while (objectNo < 5) {
        const m = /^\s*(\d+) 0 obj\n/.exec(s.slice(cursor))
        expect(m, `expected "N 0 obj" at offset ${cursor}, got ${JSON.stringify(s.slice(cursor, cursor + 30))}`).not.toBeNull()
        objectNo = Number(m[1])
        expect(objectNo).toBeLessThanOrEqual(5)
        let i = cursor + m[0].length
        // the object body may be: [dict] [stream...] endobj
        const endObj = s.indexOf('endobj', i)
        expect(endObj).toBeGreaterThan(i)
        const body = s.slice(i, endObj)
        if (body.includes('stream')) {
          const dictEnd = parseDictionaries(body, 0, body.length)
          expect(body.slice(dictEnd, dictEnd + 8)).toBe('\nstream\n')
          const afterKw = dictEnd + 8
          const endStreamKw = body.lastIndexOf('endstream')
          const lengthDecl = /\/Length (\d+)/.exec(body.slice(0, dictEnd))
          expect(body[endStreamKw - 1]).toBe('\n') // EOL before endstream
          const data = body.slice(afterKw, endStreamKw - 1) // excl. that EOL
          expect(data.length).toBe(Number(lengthDecl[1]))
        } else {
          parseDictionaries(body, 0, body.length)
        }
        cursor = endObj + 6
      }

      // xref sanity: startxref points at "xref"
      const startxref = /startxref\n(\d+)\n/.exec(s)
      expect(s.slice(Number(startxref[1]), Number(startxref[1]) + 4)).toBe('xref')
    })

    it('image dictionary carries exact /Length and page dict is well-formed', function () {
      const objects = tikzPdfObjectBodies({
        ptW: 136,
        ptH: 136,
        width: 1088,
        height: 1088,
        compressed: true,
        streamLength: 3464,
      })
      expect(objects).toHaveLength(5)
      const imgDict = objects[3]
      expect(imgDict).toContain('/Length 3464>>')
      expect(imgDict.endsWith('>>')).toBe(true)
      const contentDict = objects[4].split('\nstream\n')[0]
      expect(contentDict.endsWith('>>')).toBe(true)
      const pageDict = objects[2]
      // balanced overall
      let depth = 0
      for (let i = 0; i < pageDict.length; i++) {
        if (pageDict.slice(i, i + 2) === '<<') { depth += 1; i += 1 }
        else if (pageDict.slice(i, i + 2) === '>>') { depth -= 1; i += 1 }
        else if (pageDict[i] === '<' || pageDict[i] === '>') {
          throw new Error(`lone bracket at ${i}`)
        }
      }
      expect(depth).toBe(0)
    })
  })
})
