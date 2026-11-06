import { describe, it, expect } from 'vitest'
import {
  bibPreviewSessionKey,
  readBibPreviewSession,
  writeBibPreviewSession,
  resolveBibPreviewSession,
} from '../../../frontend/js/utils/bib-preview-session.ts'
import {
  captureBibListPosition,
  restoreBibListPosition,
} from '../../../frontend/js/utils/bib-list-position.ts'

const KEY = bibPreviewSessionKey('doc-123')

function seed(payload) {
  localStorage.setItem(KEY, JSON.stringify(payload))
}

describe('bib-preview-session', () => {
  it('scopes the key to the open document', () => {
    expect(bibPreviewSessionKey('abc')).toBe('bib-editor:preview:v1:abc')
    expect(bibPreviewSessionKey('abc')).not.toBe(bibPreviewSessionKey('def'))
  })

  it('reads a valid session', () => {
    seed({
      entryId: 'smith2020',
      listPosition: { entryId: 'row2', offset: 12, scrollTop: 300 },
    })
    expect(readBibPreviewSession(KEY)).toEqual({
      entryId: 'smith2020',
      listPosition: { entryId: 'row2', offset: 12, scrollTop: 300 },
    })
  })

  it('returns null for absent keys and malformed payloads', () => {
    localStorage.removeItem(KEY)
    expect(readBibPreviewSession(KEY)).toBeNull()
    localStorage.setItem(KEY, '{broken json')
    expect(readBibPreviewSession(KEY)).toBeNull()
    localStorage.setItem(KEY, JSON.stringify('just a string'))
    expect(readBibPreviewSession(KEY)).toBeNull()
    seed({ entryId: 42 })
    expect(readBibPreviewSession(KEY)).toBeNull()
    seed({ entryId: 'k', listPosition: { entryId: 'r', offset: NaN, scrollTop: 0 } })
    expect(readBibPreviewSession(KEY)).toBeNull()
    seed({ entryId: 'k', listPosition: { entryId: 'r', offset: 0, scrollTop: -5 } })
    expect(readBibPreviewSession(KEY)).toBeNull()
  })

  it('keeps a session with a null listPosition', () => {
    seed({ entryId: 'k1', listPosition: null })
    expect(readBibPreviewSession(KEY)).toEqual({
      entryId: 'k1',
      listPosition: null,
    })
  })

  it('writes and round-trips', () => {
    localStorage.removeItem(KEY)
    writeBibPreviewSession(KEY, { entryId: 'x1', listPosition: null })
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({
      entryId: 'x1',
      listPosition: null,
    })
  })

  it('resolve: only an entry that still exists survives', () => {
    const entries = [{ id: 'a1' }, { id: 'b2' }]
    expect(
      resolveBibPreviewSession(
        { entryId: 'b2', listPosition: { entryId: 'r', offset: 1, scrollTop: 2 } },
        entries
      )
    ).toEqual({
      entry: { id: 'b2' },
      listPosition: { entryId: 'r', offset: 1, scrollTop: 2 },
    })
    // gone entry: the whole session (incl. list position) is dropped
    expect(
      resolveBibPreviewSession(
        { entryId: 'gone', listPosition: { entryId: 'r', offset: 1, scrollTop: 2 } },
        entries
      )
    ).toEqual({ entry: null, listPosition: null })
    expect(resolveBibPreviewSession(null, entries)).toEqual({
      entry: null,
      listPosition: null,
    })
  })
})

describe('bib-list-position (row-anchored capture/restore)', () => {
  // Fake geometry: body viewport at y=100; rows at
  //   e1 [20,80)  (fully above the viewport)
  //   e2 [80,160) (straddles → first visible, top 80)
  //   e3 [160,240)
  const RECTS = {
    e1: { top: 20, bottom: 80 },
    e2: { top: 80, bottom: 160 },
    e3: { top: 160, bottom: 240 },
  }

  function makeList(initialScrollTop = 0) {
    const list = document.createElement('div')
    list.className = 'bibtex-entry-list'
    const body = document.createElement('div')
    body.className = 'bibtex-entry-list-body'
    body.scrollTop = initialScrollTop
    list.appendChild(body)
    for (const id of ['e1', 'e2', 'e3']) {
      const row = document.createElement('div')
      row.className = 'bibtex-entry-card-row'
      row.dataset.entryId = id
      row.getBoundingClientRect = () => ({ ...RECTS[id], left: 0, right: 0 })
      body.appendChild(row)
    }
    body.getBoundingClientRect = () => ({ top: 100, bottom: 400, left: 0, right: 0 })
    return { list, body }
  }

  it('captures the first fully-or-partially visible row + offset + scrollTop', () => {
    const { list, body } = makeList(120)
    const pos = captureBibListPosition(list)
    expect(pos).toEqual({ entryId: 'e2', offset: 100 - 80, scrollTop: 120 })
    expect(captureBibListPosition(null)).toBeNull()
    // a list without the body (or without rows) yields null
    expect(captureBibListPosition(document.createElement('div'))).toBeNull()
  })

  it('restores the same row anchor with a relative delta', () => {
    const { list, body } = makeList(0)
    // saved: e3 was visible 10px below the viewport top; current scrollTop 0
    expect(
      restoreBibListPosition(list, { entryId: 'e3', offset: 10, scrollTop: 500 })
    ).toBe(true)
    // delta = rowTop(160) - viewportTop(100) + offset(10) = 70
    expect(body.scrollTop).toBe(70)
  })

  it('falls back to the stored pixel offset when the row is absent', () => {
    const { list, body } = makeList(0)
    expect(
      restoreBibListPosition(list, { entryId: 'nope', offset: 0, scrollTop: 431 })
    ).toBe(true)
    expect(body.scrollTop).toBe(431)
    expect(restoreBibListPosition(null, { entryId: 'x', offset: 0, scrollTop: 1 })).toBe(false)
  })
})
