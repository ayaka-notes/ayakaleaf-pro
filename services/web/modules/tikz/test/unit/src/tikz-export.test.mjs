import { describe, expect, it } from 'vitest'
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
})
