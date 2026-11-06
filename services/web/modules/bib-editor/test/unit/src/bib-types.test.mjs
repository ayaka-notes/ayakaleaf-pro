import { describe, it, expect } from 'vitest'
import {
  flattenRequired,
  requiredStarMembers,
  displayFieldsFor,
  getEntryType,
  getMissingRequiredFields,
  hasAllRequiredFields,
  ENTRY_TYPES,
  getNewEntryInitialType,
  isFormRebind,
} from '../../../frontend/js/utils/bib-types.ts'
import bibtexSchema from '../../../frontend/js/utils/bibtex-schema.json'

describe('bib-types (schema + display rules)', () => {
  it('flattens OR-groups without ever emitting a joined pseudo-name', () => {
    const flat = flattenRequired([['author', 'editor'], 'title', ['chapter', 'pages']])
    expect(flat).toEqual(['author', 'editor', 'title', 'chapter', 'pages'])
    for (const f of flat) {
      expect(typeof f).toBe('string')
      // the pseudo-field bug: no field name may equal a concatenation of a
      // group and be unparseable
      expect(f).not.toBe('authoreditor')
      expect(f).not.toBe('chapterpages')
    }
  })

  describe('getNewEntryInitialType (W1 New-Entry preset)', () => {
    it('falls back to article when there is no preset', () => {
      expect(getNewEntryInitialType(null)).toBe('article')
    })

    it('reuses a supported preset', () => {
      expect(getNewEntryInitialType('incollection')).toBe('incollection')
      expect(getNewEntryInitialType('manual')).toBe('manual')
    })

    it('rejects an unsupported preset (defensive) and falls back to article', () => {
      expect(getNewEntryInitialType('not-a-bibtex-type')).toBe('article')
    })
  })

  describe('isFormRebind (W3a post-write re-sync)', () => {
    it('is NOT a rebind for a fresh parse of the same bound entry', () => {
      expect(
        isFormRebind(
          { kind: 'existing', originalId: 'a' },
          { kind: 'existing', originalId: 'a' }
        )
      ).toBe(false)
    })

    it('is a rebind on materialization (new → existing)', () => {
      expect(
        isFormRebind(
          { kind: 'new', originalId: null },
          { kind: 'existing', originalId: 'a' }
        )
      ).toBe(true)
    })

    it('is a rebind on a rename (existing → existing, different key)', () => {
      expect(
        isFormRebind(
          { kind: 'existing', originalId: 'old' },
          { kind: 'existing', originalId: 'new' }
        )
      ).toBe(true)
    })
  })

  it('requiredStarMembers: stars show on every empty member of an empty group', () => {
    const req = [['author', 'editor'], 'title']
    expect(requiredStarMembers(req, {})).toEqual(['author', 'editor', 'title'])
    // one filled member -> the whole group is unstarred
    expect(requiredStarMembers(req, { author: 'A' })).toEqual(['title'])
    expect(requiredStarMembers(req, { editor: 'E' })).toEqual(['title'])
    // all filled -> no stars
    expect(requiredStarMembers(req, { author: 'A', title: 'T' })).toEqual([])
    // standalone required stays starred while empty
    expect(requiredStarMembers(['title'], { author: 'A' })).toEqual(['title'])
  })

  it('displayFieldsFor: new entry shows required (OR-flattened) + defaultOptionalFields only', () => {
    const article = getEntryType('article')
    const fields = displayFieldsFor(article, 'new', {}, false)
    expect(fields).toContain('author')
    expect(fields).toContain('title')
    expect(fields).toContain('journal')
    expect(fields).toContain('journaltitle') // OR-group member
    expect(fields).toContain('year')
    expect(fields).toContain('date') // OR-group member
    // reference article: required + 34 default-optional (not the ~150
    // citation-js catalogue)
    expect(fields.length).toBeLessThan(60)
    expect(fields).toContain('doi')
  })

  it('displayFieldsFor: existing entry shows required + full optional + valued extras', () => {
    const article = getEntryType('article')
    const valued = { weirdbiblatexfield: 'valued' }
    const fields = displayFieldsFor(article, 'existing', valued, false)
    expect(fields).toContain('abstract') // full optional visible
    expect(fields).toContain('weirdbiblatexfield')
    // still no pseudo-names
    for (const f of fields) expect(typeof f).toBe('string')
  })

  it('displayFieldsFor: showAll reveals required + optional + valued', () => {
    const article = getEntryType('article')
    const fields = displayFieldsFor(article, 'new', { note: 'n' }, true)
    expect(fields).toContain('note')
    expect(fields).toContain('abstract')
  })

  it('displayFieldsFor: unknown type falls back safely', () => {
    expect(displayFieldsFor(undefined, 'new', { x: '1' }, false).includes('x')).toBe(false)
    const all = displayFieldsFor(undefined, 'new', { x: '1' }, true)
    expect(all).toContain('x')
  })

  it('schema: reference re-derive (C1) — misc empty, software empty, booklet/title, OR-groups', () => {
    expect(bibtexSchema.supportedPublicationTypes).toContain('misc')
    expect(bibtexSchema.supportedPublicationTypes).toContain('manual')
    expect(
      JSON.stringify(bibtexSchema.publicationTypes.misc.requiredFields)
    ).toBe(JSON.stringify([]))
    expect(bibtexSchema.publicationTypes.manual.requiredFields).toEqual(['title'])
    // 16 reference types require NOTHING (incl. software — verified in bundle)
    expect(
      JSON.stringify(bibtexSchema.publicationTypes.software.requiredFields)
    ).toBe(JSON.stringify([]))
    // OR-group tokens are arrays (bib-validate OR semantics)
    expect(bibtexSchema.publicationTypes.article.requiredFields).toEqual([
      'author',
      'title',
      ['journal', 'journaltitle'],
      ['year', 'date'],
    ])
    expect(bibtexSchema.publicationTypes.book.requiredFields).toEqual([
      ['author', 'editor'],
      'title',
      ['year', 'date'],
    ])
  })

  it('schema: every defaultOptionalFields entry is a known field', () => {
    for (const [type, pt] of Object.entries(bibtexSchema.publicationTypes)) {
      const def = pt.defaultOptionalFields || []
      for (const f of def) {
        expect(
          bibtexSchema.allKnownFields,
          `${type}.defaultOptionalFields must contain known fields only`
        ).toContain(f)
      }
    }
  })

  it('schema: every publicationType entry referenced by supportedPublicationTypes exists', () => {
    for (const type of bibtexSchema.supportedPublicationTypes) {
      expect(
        bibtexSchema.publicationTypes,
        `supportedPublicationTypes entry ${type} must have a rule`
      ).toHaveProperty(type)
      const req = bibtexSchema.publicationTypes[type].requiredFields
      for (const r of req) {
        if (Array.isArray(r)) {
          expect(r.length, 'OR-groups have at least 2 members').toBeGreaterThanOrEqual(2)
        } else {
          expect(typeof r).toBe('string')
        }
      }
    }
  })

  it('getEntryType matches case-insensitively; misc empty (C1); article OR-groups', () => {
    expect(getEntryType('ARTICLE').name).toBe('article')
    expect(hasAllRequiredFields(getEntryType('misc').requiredFields, {})).toBe(true)
    // article (reference): the [journal, journaltitle] and [year, date]
    // OR-groups are missing when only author is filled
    expect(getMissingRequiredFields(getEntryType('article').requiredFields, { author: 'a' })).toEqual([
      'title',
      ['journal', 'journaltitle'],
      ['year', 'date'],
    ])
  })

  it('ENTRY_TYPES covers all supported types (no crash on misc/manual)', () => {
    const names = ENTRY_TYPES.map(t => t.name)
    for (const type of bibtexSchema.supportedPublicationTypes) {
      expect(names, `ENTRY_TYPES must include ${type}`).toContain(type)
    }
  })
})
