/**
 * LibrarySearch — machine-extracted from the SaaS reference bundle
 * (LIBRARY_PLAN.md §1.4): diacritic fold map, NFD stripping, tokenization.
 */
import { describe, expect, it } from 'vitest'
import {
  blobMatchesQuery,
  entrySearchBlob,
  escapeRegex,
  normalizeSearchText,
  tokenizeSearchQuery,
} from '../../../app/src/LibrarySearch.mjs'

describe('normalizeSearchText (SaaS fold map)', () => {
  it('lowercases and strips diacritics (NFD)', () => {
    expect(normalizeSearchText('CaFÉ')).toBe('cafe')
    expect(normalizeSearchText('Über')).toBe('uber')
    expect(normalizeSearchText('Résumé')).toBe('resume')
  })

  it('applies the SaaS fold map for characters NFD does not split', () => {
    expect(normalizeSearchText('æ')).toBe('ae')
    expect(normalizeSearchText('œ')).toBe('oe')
    expect(normalizeSearchText('ø')).toBe('o')
    expect(normalizeSearchText('ß')).toBe('ss')
    expect(normalizeSearchText('ł')).toBe('l')
    expect(normalizeSearchText('đ')).toBe('d')
    expect(normalizeSearchText('ð')).toBe('d')
    expect(normalizeSearchText('þ')).toBe('th')
    expect(normalizeSearchText('ŋ')).toBe('ng')
  })

  it('leaves ordinary text untouched', () => {
    expect(normalizeSearchText('smith2024')).toBe('smith2024')
    expect(normalizeSearchText('a_b-c.d/')).toBe('a_b-c.d/')
  })
})

describe('tokenizeSearchQuery', () => {
  it('splits on punctuation and whitespace runs', () => {
    expect(tokenizeSearchQuery('a  b;c')).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates while preserving order', () => {
    expect(tokenizeSearchQuery('ernst ernst ERNST.')).toEqual(['ernst'])
    expect(tokenizeSearchQuery('b a b')).toEqual(['b', 'a'])
  })

  it('drops empty tokens', () => {
    expect(tokenizeSearchQuery('   ')).toEqual([])
    expect(tokenizeSearchQuery('&&&')).toEqual([])
  })
})

describe('entrySearchBlob', () => {
  it('normalizes key + type + field names + values', () => {
    const entry = {
      key: 'Ernst2007',
      type: 'article',
      fields: [
        { name: 'title', value: 'Efficient Computation Based on Stochastic Spikes' },
        { name: 'author', value: 'Ernst et al.' },
      ],
    }
    const blob = entrySearchBlob(entry)
    expect(blob).toContain('ernst2007')
    expect(blob).toContain('article')
    expect(blob).toContain('efficient computation based on stochastic spikes')
    expect(blob).toContain('ernst et al')
    expect(blob).toContain('title')
  })

  it('tolerates missing parts', () => {
    expect(entrySearchBlob({})).toBe('')
    expect(entrySearchBlob({ key: 'x', fields: null })).toBe('x')
  })
})

describe('blobMatchesQuery', () => {
  const blob = entrySearchBlob({
    key: 'Ernst2007',
    type: 'article',
    fields: [{ name: 'title', value: 'Stochastic Spikes' }],
  })

  it('matches a single token (case/diacritic insensitive)', () => {
    expect(blobMatchesQuery(blob, 'ernst')).toBe(true)
    expect(blobMatchesQuery(blob, 'ERNST')).toBe(true)
    expect(blobMatchesQuery(blob, 'ERST')).toBe(false)
    expect(blobMatchesQuery(blob, 'spikes')).toBe(true)
  })

  it('requires EVERY token (AND semantics)', () => {
    expect(blobMatchesQuery(blob, 'ernst spikes')).toBe(true)
    expect(blobMatchesQuery(blob, 'ernst missing')).toBe(false)
  })

  it('matches everything for an empty query', () => {
    expect(blobMatchesQuery(blob, '')).toBe(true)
    expect(blobMatchesQuery(blob, '   ')).toBe(true)
  })
})

describe('escapeRegex', () => {
  it('escapes metacharacters', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c')
    expect(escapeRegex('x|y(z)')).toBe('x\\|y\\(z\\)')
  })

  it('leaves plain text alone', () => {
    expect(escapeRegex('ernst2007')).toBe('ernst2007')
  })
})
