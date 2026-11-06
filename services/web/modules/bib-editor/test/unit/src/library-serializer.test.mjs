/**
 * LibrarySerializer — 1:1 port of the in-project serializer
 * (bib-parser.ts `escapeBibValue`/`serializeBibEntry`). The download
 * (.bib) path must produce files that the editor's PARSER accepts with
 * identical values (round-trip tests below use the TS parser).
 */
import { describe, expect, it } from 'vitest'
import {
  escapeBibValue,
  serializeBibEntry,
  serializeBibFile,
} from '../../../app/src/LibrarySerializer.mjs'
import {
  parseBibFile,
  serializeBibEntry as tsSerialize,
} from '../../../frontend/js/utils/bib-parser.ts'

describe('escapeBibValue', () => {
  it('escapes stray closing braces', () => {
    expect(escapeBibValue('a}b')).toBe('a\\}b')
  })

  it('keeps balanced nested braces', () => {
    expect(escapeBibValue('{Last, First}')).toBe('{Last, First}')
  })

  it('is idempotent on already-escaped braces', () => {
    expect(escapeBibValue('a\\}b')).toBe('a\\}b')
  })

  it('passes plain text through', () => {
    expect(escapeBibValue('A and B')).toBe('A and B')
  })
})

describe('serializeBibEntry (parity with the TS serializer)', () => {
  const entry = {
    key: 'smith2024',
    type: 'article',
    fields: [
      { name: 'title', value: 'Foo' },
      { name: 'author', value: 'A and B' },
      { name: 'year', value: '2024' },
    ],
  }

  it('matches the TS serializer byte-for-byte for typical entries', () => {
    const ts = tsSerialize({
      type: 'article',
      id: 'smith2024',
      fields: { title: 'Foo', author: 'A and B', year: '2024' },
    })
    expect(serializeBibEntry(entry)).toBe(ts)
  })

  it('drops empty values', () => {
    const out = serializeBibEntry({
      key: 'k1',
      type: 'misc',
      fields: [
        { name: 'note', value: '  ' },
        { name: 'title', value: 'X' },
      ],
    })
    expect(out).not.toContain('note')
    expect(out).toContain('title = {X}')
  })

  it('handles keyless entries', () => {
    expect(serializeBibEntry({ key: '', type: 'misc', fields: [] })).toBe(
      '@misc{}\n'
    )
  })
})

describe('serializeBibFile (download) round-trips through the TS parser', () => {
  const entries = [
    {
      key: 'Ernst2007',
      type: 'article',
      fields: [
        { name: 'title', value: 'Efficient Computation Based on Stochastic Spikes' },
        { name: 'author', value: 'Ernst, P. O. and Brown, T.' },
        { name: 'year', value: '2007' },
        { name: 'journal', value: 'Nature' },
        { name: 'abstract', value: 'We study {a} and b\\c — multi-line\nabstract.' },
      ],
    },
    {
      key: 'plain2',
      type: 'misc',
      fields: [],
    },
    {
      key: 'straybrace',
      type: 'book',
      fields: [{ name: 'title', value: 'a}b' }],
    },
  ]

  it('round-trips every value through parseBibFile', () => {
    const file = serializeBibFile(entries)
    const parsed = parseBibFile(file)
    expect(parsed.length).toBe(3)

    expect(parsed[0].id).toBe('Ernst2007')
    expect(parsed[0].type).toBe('article')
    expect(parsed[0].fields.title).toBe(
      'Efficient Computation Based on Stochastic Spikes'
    )
    expect(parsed[0].fields.author).toBe('Ernst, P. O. and Brown, T.')
    expect(parsed[0].fields.year).toBe('2007')
    expect(parsed[0].fields.journal).toBe('Nature')
    expect(parsed[0].fields.abstract).toBe(
      'We study {a} and b\\c — multi-line\nabstract.'
    )

    expect(parsed[1].id).toBe('plain2')
    expect(Object.keys(parsed[1].fields).length).toBe(0)

    expect(parsed[2].id).toBe('straybrace')
    // The parser preserves literal text (same convention as the in-project
    // editor): `\}` survives parsing verbatim — and in a compiled .bib
    // `\}` is exactly a literal `}`, so the value is semantically intact.
    expect(parsed[2].fields.title).toBe('a\\}b')
  })

  it('separates entries by a blank line and is empty for no entries', () => {
    expect(serializeBibFile([])).toBe('')
    const file = serializeBibFile([
      { key: 'a1', type: 'misc', fields: [{ name: 'note', value: '1' }] },
      { key: 'b2', type: 'misc', fields: [{ name: 'note', value: '2' }] },
    ])
    expect(file).toContain('}\n\n@misc{b2,')
  })
})
