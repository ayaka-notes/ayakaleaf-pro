/**
 * BibTypes — API entry validation + normalization (LIBRARY_PLAN.md §3/§4,
 * D-C1). The 48-type vocabulary must match the frontend OVERLEAF_TYPES.
 */
import { describe, expect, it } from 'vitest'
import {
  BIB_TYPES,
  CITATION_KEY_REGEX,
  normalizeLibraryEntry,
  validateEntryBatch,
  validateLibraryEntry,
} from '../../../app/src/BibTypes.mjs'
import { OVERLEAF_TYPES } from '../../../frontend/js/utils/overleaf-type-map.ts'

describe('BIB_TYPES vocabulary', () => {
  it('has 48 types, unique and lowercase', () => {
    expect(BIB_TYPES.length).toBe(48)
    expect(new Set(BIB_TYPES).size).toBe(48)
    for (const t of BIB_TYPES) {
      expect(t).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('matches the frontend OVERLEAF_TYPES exactly (set equality)', () => {
    const frontend = OVERLEAF_TYPES.map(t => t.machine)
    expect([...BIB_TYPES].sort()).toEqual([...frontend].sort())
  })

  it('includes the reference-spreadsheet core types', () => {
    for (const t of [
      'article',
      'book',
      'inproceedings',
      'misc',
      'phdthesis',
      'techreport',
      'www',
      'software',
      'dataset',
    ]) {
      expect(BIB_TYPES).toContain(t)
    }
  })
})

describe('citation key charset', () => {
  it('accepts letters, digits, dot, underscore, dash', () => {
    expect(CITATION_KEY_REGEX.test('smith2024')).toBe(true)
    expect(CITATION_KEY_REGEX.test('a-b_c.d')).toBe(true)
    expect(CITATION_KEY_REGEX.test('Ernst2007')).toBe(true)
  })

  it('rejects spaces and special characters', () => {
    expect(CITATION_KEY_REGEX.test('a b')).toBe(false)
    expect(CITATION_KEY_REGEX.test('a:b')).toBe(false)
    expect(CITATION_KEY_REGEX.test('a/b')).toBe(false)
    expect(CITATION_KEY_REGEX.test('a{b}')).toBe(false)
    expect(CITATION_KEY_REGEX.test('')).toBe(false)
  })
})

describe('validateLibraryEntry', () => {
  const okEntry = {
    key: 'smith2024',
    type: 'article',
    fields: [
      { name: 'title', value: 'Foo' },
      { name: 'year', value: '2024' },
    ],
  }

  it('accepts a valid entry (case-insensitive type ok)', () => {
    expect(validateLibraryEntry(okEntry).ok).toBe(true)
    expect(validateLibraryEntry({ ...okEntry, type: 'Article' }).ok).toBe(true)
  })

  it('requires a key', () => {
    expect(validateLibraryEntry({ ...okEntry, key: '  ' }).reason).toBe(
      'key-missing'
    )
  })

  it('rejects invalid keys', () => {
    expect(
      validateLibraryEntry({ ...okEntry, key: 'a b' }).reason
    ).toBe('key-invalid')
    expect(
      validateLibraryEntry({ ...okEntry, key: 'a:b' }).reason
    ).toBe('key-invalid')
  })

  it('requires a known type', () => {
    expect(
      validateLibraryEntry({ ...okEntry, type: 'notatype' }).reason
    ).toBe('type-unknown')
    expect(validateLibraryEntry({ ...okEntry, type: '' }).reason).toBe(
      'type-invalid'
    )
  })

  it('validates field entries', () => {
    expect(
      validateLibraryEntry({
        ...okEntry,
        fields: [{ name: 'Title', value: 'X' }],
      }).ok
    ).toBe(true)
    expect(
      validateLibraryEntry({
        ...okEntry,
        fields: [{ name: '', value: 'X' }],
      }).reason
    ).toBe('field-name-invalid')
    expect(
      validateLibraryEntry({
        ...okEntry,
        fields: [{ name: 'title' }],
      }).ok
    ).toBe(true) // absent value = empty (allowed)
    expect(
      validateLibraryEntry({
        ...okEntry,
        fields: [{ name: 'title', value: 42 }],
      }).reason
    ).toBe('field-value-not-string')
    expect(
      validateLibraryEntry({ ...okEntry, fields: 'nope' }).reason
    ).toBe('fields-not-array')
  })

  it('rejects non-objects', () => {
    expect(validateLibraryEntry(null).reason).toBe('entry-not-object')
    expect(validateLibraryEntry('x').reason).toBe('entry-not-object')
    expect(validateLibraryEntry([1]).reason).toBe('entry-not-object')
  })
})

describe('validateEntryBatch', () => {
  it('requires a non-empty array (max 200)', () => {
    expect(validateEntryBatch(null).reason).toBe('entries-missing')
    expect(validateEntryBatch([]).reason).toBe('entries-missing')
    const big = Array.from(
      { length: 201 },
      () => ({ key: 'k', type: 'misc', fields: [] })
    )
    expect(validateEntryBatch(big).reason).toBe('entries-too-many')
  })

  it('validates every entry in the batch', () => {
    expect(
      validateEntryBatch([
        { key: 'ok1', type: 'misc', fields: [] },
        { key: 'bad key', type: 'misc', fields: [] },
      ]).reason
    ).toBe('key-invalid')
  })
})

describe('normalizeLibraryEntry', () => {
  it('trims, lower-cases names, drops empty values and duplicates (last-wins)', () => {
    const norm = normalizeLibraryEntry({
      key: '  smith2024  ',
      type: 'ARTICLE',
      fields: [
        { name: ' Title ', value: '  Foo  ' },
        { name: 'title', value: 'Bar' },
        { name: 'year', value: '   ' },
        { name: '', value: 'drop' },
        { name: '9bad', value: 'drop' },
      ],
    })
    expect(norm.key).toBe('smith2024')
    expect(norm.type).toBe('article')
    expect(norm.fields).toEqual([{ name: 'title', value: 'Bar' }])
  })

  it('tolerates a missing fields array', () => {
    expect(normalizeLibraryEntry({ key: 'k', type: 'misc' }).fields).toEqual(
      []
    )
  })
})
