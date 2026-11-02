import { describe, it, expect } from 'vitest'
import {
  parseBibFile,
  parseBibEntry,
  serializeBibEntry,
  replaceEntryInSource,
  removeEntryFromSource,
  generateCitationKey,
  escapeBibValue,
} from '../../../frontend/js/utils/bib-parser.ts'

describe('bib-parser', () => {
  it('parses a simple article with correct offsets', () => {
    const src = '@article{smith2024,\n  title = {A Title},\n  author = {John Smith},\n}\n'
    const entries = parseBibFile(src)
    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.type).toBe('article')
    expect(e.id).toBe('smith2024')
    expect(e.fields.title).toBe('A Title')
    expect(e.fields.author).toBe('John Smith')
    expect(e.sourceStart).toBe(0)
    expect(e.sourceEnd).toBe(src.lastIndexOf('}') + 1)
    expect(src.slice(e.sourceStart, e.sourceEnd)).toBe(e.raw)
  })

  it('parses multiple entries and skips @comment/@preamble/@string', () => {
    const src =
      '@preamble{"\\providecommand{\\nomelfield}[1]{#1}")\n' +
      '@comment{a comment}\n' +
      '@string{J = {Journal}}\n' +
      '@article{k1, title = {T1}, year = {2020}}\n' +
      '@book{k2, title = {B2}, year = {2021}}\n'
    const entries = parseBibFile(src)
    expect(entries.map(e => e.id)).toEqual(['k1', 'k2'])
    expect(entries.every(e => ['article', 'book'].includes(e.type))).toBe(true)
  })

  it('parses keyless and empty-field entries (red-frame entries)', () => {
    expect(parseBibFile('@misc{}\n')[0].id).toBe('')
    expect(parseBibFile('@misc{key}\n')[0].id).toBe('key')
    expect(parseBibFile('@article{a, title={T}}\n@misc{}\n').map(e => e.id)).toEqual(['a', ''])
  })

  it('parses nested-brace values of any depth', () => {
    const src = '@article{k, author = {{Last}, {First}}, title = {a {b} c}, note = {x{y}z}}'
    const e = parseBibFile(src)[0]
    expect(e.fields.author).toBe('{Last}, {First}')
    expect(e.fields.title).toBe('a {b} c')
    expect(e.fields.note).toBe('x{y}z')
  })

  it('parses quoted and bare values', () => {
    const e = parseBibFile('@misc{k, pages = "123", year = 2024, note = {a, b}}')[0]
    expect(e.fields.pages).toBe('123')
    expect(e.fields.year).toBe('2024')
    expect(e.fields.note).toBe('a, b')
  })

  it('serializes back to valid BibTeX and round-trips', () => {
    const entry = {
      type: 'article',
      id: 'smith2024',
      fields: { title: 'T{he}', author: 'Smith, John', year: '2024' },
    }
    const s = serializeBibEntry(entry)
    expect(s).toContain('  title = {T{he}}')
    const back = parseBibEntry(s)
    expect(back).not.toBeNull()
    expect(back.id).toBe('smith2024')
    expect(back.fields.title).toBe('T{he}')
    expect(back.fields.year).toBe('2024')
  })

  it('escapeBibValue: idempotent, preserves balanced braces, escapes unbalanced', () => {
    expect(escapeBibValue('a}b')).toBe('a\\}b')
    expect(escapeBibValue('a\\}b')).toBe('a\\}b')
    expect(escapeBibValue('{Last}, {First}')).toBe('{Last}, {First}')
    expect(escapeBibValue('{a, b}')).toBe('{a, b}')
    expect(escapeBibValue('')).toBe('')
  })

  it('escaped braces in serialized values do not confuse the parser', () => {
    // note value contains a raw closing brace -> serializer escapes it -> parser skips the escape
    const s = serializeBibEntry({ type: 'misc', id: 'k', fields: { note: 'a}b' } })
    expect(s).toContain('  note = {a\\}b}')
    const back = parseBibEntry(s)
    expect(back).not.toBeNull()
    expect(back.id).toBe('k')
    expect(back.fields.note).toBe('a\\}b')
  })

  it('replaceEntryInSource and removeEntryFromSource use offsets', () => {
    const src = 'prefix\n@misc{a, title={Old}}\nsuffix\n'
    const [a] = parseBibFile(src)
    const replaced = replaceEntryInSource(src, a, { type: 'misc', id: 'a', fields: { title: 'New' } })
    expect(replaced).toBe('prefix\n@misc{a,\n  title = {New}\n}\nsuffix\n')
    const removed = removeEntryFromSource(src, a)
    expect(removed).toBe('prefix\nsuffix\n')
  })

  it('generateCitationKey derives last-name+year with fallbacks', () => {
    expect(generateCitationKey({ author: 'Last, First and Other, X', year: '2024' })).toBe('last2024')
    expect(generateCitationKey({ author: 'John Smith', year: '2020' })).toBe('smith2020')
    expect(generateCitationKey({ title: 'A Cool Paper', year: '2019' })).toBe('a2019')
    expect(generateCitationKey({ year: '2001' })).toMatch(/^ref[a-z]{6}2001$/)
  })
})
