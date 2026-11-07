import { describe, expect, it } from 'vitest'
import {
  TIKZ_STORAGE_KEY,
  encodeTikzHostMessage,
  handleTikzEmbedMessage,
  isTikzFile,
  readTikzSource,
  tikzEmbedUrl
} from '../../../frontend/js/util/tikz-protocol'

describe('tikz-protocol', function () {
  describe('isTikzFile', function () {
    it('claims .tikz and .pgf files', function () {
      expect(isTikzFile('figure.tikz')).toBe(true)
      expect(isTikzFile('sub/dir/figure.pgf')).toBe(true)
    })
    it('does not claim other files', function () {
      expect(isTikzFile('main.tex')).toBe(false)
      expect(isTikzFile('notes.txt')).toBe(false)
      // quirk of the implementation: a dotless name matches its own
      // "extension", so a file literally named `tikz` is claimed
      expect(isTikzFile('tikz')).toBe(true)
      expect(isTikzFile(null)).toBe(false)
      expect(isTikzFile(undefined)).toBe(false)
    })
  })

  describe('readTikzSource', function () {
    it('prefers source over the xml alias', function () {
      expect(readTikzSource({ source: 'A', xml: 'B' })).toBe('A')
    })
    it('falls back to the xml alias', function () {
      expect(readTikzSource({ xml: 'B' })).toBe('B')
    })
    it('returns null when neither is usable', function () {
      expect(readTikzSource({})).toBe(null)
      expect(readTikzSource({ source: '   ', xml: '' })).toBe(null)
    })
  })

  describe('handleTikzEmbedMessage', function () {
    const state = { doc: 'initial source' }

    it('ignores non-object messages', function () {
      expect(handleTikzEmbedMessage(null, state)).toEqual({ kind: 'noop' })
      expect(handleTikzEmbedMessage('hi', state)).toEqual({ kind: 'noop' })
    })

    it('reports errors', function () {
      expect(handleTikzEmbedMessage({ error: 'boom' }, state)).toEqual({
        kind: 'error',
        message: 'boom'
      })
    })

    it('hands the current document to the embed on init', function () {
      expect(handleTikzEmbedMessage({ event: 'init' }, state)).toEqual({
        kind: 'boot-load',
        source: 'initial source'
      })
    })

    it('marks the embed ready on loaded', function () {
      expect(handleTikzEmbedMessage({ event: 'loaded' }, state)).toEqual({
        kind: 'ready'
      })
    })

    it('writes change/autosave/save sources back into the document', function () {
      for (const event of ['change', 'autosave', 'save']) {
        expect(handleTikzEmbedMessage({ event, source: 'new' }, state)).toEqual(
          { kind: 'doc-update', source: 'new' }
        )
      }
      // the xml alias works too
      expect(handleTikzEmbedMessage({ event: 'save', xml: 'aliased' }, state))
        .toEqual({ kind: 'doc-update', source: 'aliased' })
      // without a usable source the message is a no-op
      expect(handleTikzEmbedMessage({ event: 'save' }, state)).toEqual({
        kind: 'noop'
      })
    })

    it('resolves export payloads: data, then svg, then source', function () {
      expect(handleTikzEmbedMessage({ event: 'export', data: 'D', svg: 'S' }, state))
        .toEqual({ kind: 'export-result', data: 'D' })
      expect(handleTikzEmbedMessage({ event: 'export', svg: 'S' }, state))
        .toEqual({ kind: 'export-result', data: 'S' })
      expect(handleTikzEmbedMessage({ event: 'export', source: 'SRC' }, state))
        .toEqual({ kind: 'export-result', data: 'SRC' })
      expect(handleTikzEmbedMessage({ event: 'export' }, state)).toEqual({
        kind: 'export-result',
        data: null
      })
    })

    it('forwards persistence saves and drops malformed ones', function () {
      expect(handleTikzEmbedMessage({ event: 'persistence-save', key: 'k', value: 'v' }, state))
        .toEqual({ kind: 'persistence-save', key: 'k', value: 'v' })
      expect(handleTikzEmbedMessage({ event: 'persistence-save', key: 'k' }, state))
        .toEqual({ kind: 'noop' })
    })

    it('no-ops unknown events', function () {
      expect(handleTikzEmbedMessage({ event: 'mystery' }, state)).toEqual({
        kind: 'noop'
      })
    })
  })

  describe('encodeTikzHostMessage', function () {
    it('encodes actions as JSON strings (postMessage contract)', function () {
      const message = { action: 'load', source: 's', autosave: 1 }
      expect(encodeTikzHostMessage(message)).toBe(JSON.stringify(message))
    })
  })

  describe('tikzEmbedUrl', function () {
    it('points at the vendored same-origin app', function () {
      expect(tikzEmbedUrl(null)).toBe('/static/tikz-editor/index.html')
      expect(tikzEmbedUrl({})).toBe('/static/tikz-editor/index.html')
    })
    it('re-applies host storage via the #storage hash', function () {
      const url = tikzEmbedUrl({ a: '1' })
      expect(url).toBe(
        `/static/tikz-editor/index.html#storage=${encodeURIComponent(JSON.stringify({ a: '1' }))}`
      )
    })
  })

  describe('TIKZ_STORAGE_KEY', function () {
    it('is the host localStorage key the embed persists into', function () {
      expect(TIKZ_STORAGE_KEY).toBe('ollitex:tikz-editor:storage')
    })
  })
})
