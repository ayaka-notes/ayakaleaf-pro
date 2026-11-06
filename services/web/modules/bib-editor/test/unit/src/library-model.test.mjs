/**
 * Library model (LIBRARY_PLAN.md §5) — pure API↔BibEntry mapping,
 * suggestion-key merge (D-C1/R5), row normalization, and the client-side
 * search filter (same fold map as the server, so loaded pages don't
 * flicker).
 */
import { describe, it, expect } from 'vitest'
import {
  apiToBibEntry,
  bibEntryToApi,
  pickSuggestedKey,
  toRows,
  entryMatchesQuery,
  duplicateKeyRowIds,
} from '../../../frontend/js/library/library-model.ts'

function api(over = {}) {
  return {
    key: 'smith2020',
    type: 'article',
    fields: [
      { name: 'title', value: 'Title' },
      { name: 'author', value: 'Smith, A.' },
    ],
    _id: 'abc123',
    occurrenceIndex: 0,
    updatedAt: null,
    createdAt: null,
    ...over,
  }
}

describe('apiToBibEntry / bibEntryToApi', () => {
  it('maps API fields to the module field map', () => {
    const e = apiToBibEntry(api())
    expect(e).toEqual({
      type: 'article',
      id: 'smith2020',
      fields: { title: 'Title', author: 'Smith, A.' },
      // row identity for bulk ops (delete/restore by Mongo _id, not key)
      libId: 'abc123',
      updatedAt: null,
    })
  })

  it('is a round trip (entry → api → entry)', () => {
    const entry = {
      type: 'book',
      id: 'doe1999',
      fields: { title: 'T', year: '1999' },
      libId: undefined,
      updatedAt: null,
    }
    expect(apiToBibEntry(bibEntryToApi(entry))).toEqual(entry)
  })

  it('tolerates missing fields', () => {
    expect(apiToBibEntry(api({ fields: undefined }))?.fields).toEqual({})
  })
})

describe('pickSuggestedKey', () => {
  it('returns the first server key not taken', () => {
    expect(
      pickSuggestedKey('smith', ['smith2021', 'smith2022'], new Set(['smith2021']))
    ).toBe('smith2022')
  })

  it('falls back to the local pattern when the server list is empty', () => {
    expect(pickSuggestedKey('smith', [], new Set())).toBe('smith')
    expect(
      pickSuggestedKey('smith', [], new Set(['smith']))
    ).toBe('smithb')
  })

  it('skips taken local-pattern keys', () => {
    const taken = new Set(['smith', 'smithb'])
    expect(pickSuggestedKey('smith', [], taken)).toBe('smithc')
    expect(
      pickSuggestedKey('smith', [], new Set(['smith', ...'bcdefghijklmnopqrstuvwxyz'.split('')].map(c => (c === 'smith' ? c : `smith${c}`))))
    ).toBe('smith2')
  })

  it('normalizes the base (lowercase, alnum-only)', () => {
    expect(pickSuggestedKey('Smith & Jones', [], new Set())).toBe('smithjones')
  })
})

describe('toRows', () => {
  it('uses _id as rowId when present, key#occurrence otherwise', () => {
    const rows = toRows([
      api({ _id: 'x1' }),
      api({ _id: '', occurrenceIndex: 3 }),
    ])
    expect(rows[0].rowId).toBe('x1')
    expect(rows[1].rowId).toBe('smith2020#3')
  })
})

describe('entryMatchesQuery (SaaS fold map)', () => {
  const entry = {
    type: 'article',
    id: 'café2021',
    fields: { title: 'Über die Quantentheorie', author: 'Ærø, Łukasz' },
  }

  it('matches plain tokens', () => {
    expect(entryMatchesQuery(entry, 'quant')).toBe(true)
  })

  it('folds diacritics (æ→ae, ø→o, ł→l, ß→ss, ç→c)', () => {
    expect(entryMatchesQuery(entry, 'aero')).toBe(true) // ærø → aro… token 'aero'
    expect(entryMatchesQuery(entry, 'lu')).toBe(true) // łukasz → lu
  })

  it('matches key with diacritics folded', () => {
    expect(entryMatchesQuery(entry, 'cafe2021')).toBe(true)
  })

  it('requires ALL tokens to be present (AND)', () => {
    expect(entryMatchesQuery(entry, 'quant nothere')).toBe(false)
    expect(entryMatchesQuery(entry, 'quant luka')).toBe(true)
  })

  it('matches every query for an empty query', () => {
    expect(entryMatchesQuery(entry, '')).toBe(true)
    expect(entryMatchesQuery(entry, '   ')).toBe(true)
  })
})

describe('duplicateKeyRowIds', () => {
  it('flags rows sharing a citation key', () => {
    const rows = toRows([
      api({ _id: '1', key: 'dup' }),
      api({ _id: '2', key: 'dup' }),
      api({ _id: '3', key: 'solo' }),
    ])
    expect(duplicateKeyRowIds(rows)).toEqual(new Set(['1', '2']))
  })

  it('does not flag distinct keys', () => {
    const rows = toRows([api({ _id: '1', key: 'a' }), api({ _id: '2', key: 'b' })])
    expect(duplicateKeyRowIds(rows).size).toBe(0)
  })
})
