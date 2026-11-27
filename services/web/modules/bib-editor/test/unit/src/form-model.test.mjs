import { describe, it, expect } from 'vitest'
import {
  formModelFor,
  formRowsFor,
  optionalVisibleFor,
} from '../../../frontend/js/utils/bib-types.ts'

/**
 * C2 (PHASE_C_PLAN.md §3): form parity — the form-model layer.
 *
 *  - field order per type = captured main rows → Year → Date → postDate
 *  - Year/Date always present, in that order (48/48 capture, OQ-2: both
 *    independent rows)
 *  - unpublished: Note AFTER Date; electronic/online/www: DOI/Eprint/URL
 *    AFTER Date
 *  - dynamic Optional: rows = captured optional fields with a value
 *    (valued ∩ optional), NEVER form rows, never abstract (C4 Abstract
 *    tab), stable order
 */

describe('C2: form model (main rows, Year/Date, Optional dynamic)', () => {
  describe('formRowsFor — order per type', () => {
    it('article: author, title, journal, journaltitle, year, date', () => {
      expect(formRowsFor('article', {})).toEqual([
        'author',
        'title',
        'journal',
        'journaltitle',
        'year',
        'date',
      ])
    })

    it('book: author, editor, title, publisher, year, date', () => {
      expect(formRowsFor('book', {})).toEqual([
        'author',
        'editor',
        'title',
        'publisher',
        'year',
        'date',
      ])
    })

    it('bookinbook: booktitle/chapter/pages between title and publisher', () => {
      expect(formRowsFor('bookinbook', {})).toEqual([
        'author',
        'editor',
        'title',
        'booktitle',
        'chapter',
        'pages',
        'publisher',
        'year',
        'date',
      ])
    })

    it('unpublished: Note renders AFTER Date (capture)', () => {
      expect(formRowsFor('unpublished', {})).toEqual([
        'author',
        'title',
        'year',
        'date',
        'note',
      ])
    })

    it('electronic/online/www: DOI/Eprint/URL rows after Date', () => {
      for (const t of ['electronic', 'online', 'www']) {
        expect(formRowsFor(t, {}), t).toEqual([
          'author',
          'editor',
          'title',
          'year',
          'date',
          'doi',
          'eprint',
          'url',
        ])
      }
    })

    it('mastersthesis: institution + school rows (both)', () => {
      expect(formRowsFor('mastersthesis', {})).toEqual([
        'author',
        'title',
        'institution',
        'school',
        'year',
        'date',
      ])
    })

    it('patent: author, title, number, year, date', () => {
      expect(formRowsFor('patent', {})).toEqual([
        'author',
        'title',
        'number',
        'year',
        'date',
      ])
    })

    it('report: author, title, type, institution, year, date', () => {
      expect(formRowsFor('report', {})).toEqual([
        'author',
        'title',
        'type',
        'institution',
        'year',
        'date',
      ])
    })
  })

  describe('Year/Date invariants (OQ-2: Year AND Date, all types)', () => {
    const types = [
      'article', 'artwork', 'audio', 'book', 'bookinbook', 'booklet',
      'commentary', 'conference', 'collection', 'dataset', 'electronic',
      'image', 'inbook', 'incollection', 'inproceedings', 'inreference',
      'jurisdiction', 'legal', 'legislation', 'letter', 'manual',
      'mastersthesis', 'misc', 'movie', 'music', 'mvbook', 'mvcollection',
      'mvproceedings', 'mvreference', 'online', 'patent', 'performance',
      'periodical', 'phdthesis', 'proceedings', 'reference', 'report',
      'review', 'software', 'standard', 'suppbook', 'suppcollection',
      'suppperiodical', 'techreport', 'thesis', 'unpublished', 'video',
      'www',
    ]

    it.each(types)(
      '%s: Year row before Date row, both present',
      (type) => {
        const rows = formRowsFor(type, {})
        const yi = rows.indexOf('year')
        const di = rows.indexOf('date')
        expect(yi, `year row in ${type}`).toBeGreaterThanOrEqual(0)
        expect(di, `date row in ${type}`).toBeGreaterThanOrEqual(0)
        // capture: Year then Date, adjacent, and Year never re-appears
        // after Date (postDate rows — note/doi/eprint/url — follow Date)
        expect(
          di === yi + 1,
          `Year immediately precedes Date for ${type}`
        ).toBe(true)
        expect(rows.slice(di).includes('year'), 'year must not follow date').toBe(
          false
        )
      }
    )
  })

  describe('formModelFor — main/postDate split', () => {
    it('main excludes year/date; postDate holds captured trailing rows', () => {
      const m = formModelFor('unpublished', {})
      expect(m.mainFields).toEqual(['author', 'title'])
      expect(m.postDate).toEqual(['note'])
      const a = formModelFor('article', {})
      expect(a.mainFields).toEqual([
        'author',
        'title',
        'journal',
        'journaltitle',
      ])
      expect(a.postDate).toEqual([])
    })
  })

  describe('optionalVisibleFor — dynamic Optional (valued ∩ optional)', () => {
    it('nothing valued → empty Optional', () => {
      expect(optionalVisibleFor('article', {})).toEqual([])
      expect(optionalVisibleFor('book', { author: 'A', year: '1990' })).toEqual(
        []
      )
    })

    it('valued optional appears (article: note, series, volume in schema order)', () => {
      const v = optionalVisibleFor('article', {
        volume: '7',
        note: 'see also',
        series: 'Lecture notes',
      })
      expect(v).toEqual(['note', 'series', 'volume'])
      expect(v).not.toContain('journal')
      expect(v).not.toContain('author')
      expect(v).not.toContain('year')
      expect(v).not.toContain('abstract')
    })

    it('abstract is NEVER in Optional (C4 Abstract tab owns it)', () => {
      expect(
        optionalVisibleFor('article', {
          abstract: 'An abstract.',
          note: 'n',
        })
      ).not.toContain('abstract')
    })

    it('form rows (main/year/date/postDate) are never Optional rows', () => {
      const valued = {}
      for (const r of formRowsFor('article', {})) valued[r] = 'x'
      valued.volume = 'y'
      const v = optionalVisibleFor('article', valued)
      for (const r of formRowsFor('article', {})) {
        expect(v, `${r} must not be in Optional`).not.toContain(r)
      }
      expect(v).toContain('volume')
    })

    it('empty-string values are not "valued"', () => {
      expect(
        optionalVisibleFor('article', { volume: '   ', note: '' })
      ).toEqual([])
    })

    it('unknown type → empty (defensive)', () => {
      expect(optionalVisibleFor('doesnotexist', {})).toEqual([])
    })
  })

  describe('write-side parity (OQ-2: Year AND Date both written)', () => {
    it('a form with both years intact round-trips to `year=` AND `date=`', async () => {
      const { serializeBibEntry, parseBibFile } = await import(
        '../../../frontend/js/utils/bib-parser.ts'
      )
      const src = serializeBibEntry({
        type: 'article',
        id: 'a1',
        fields: {
          author: 'Smith',
          title: 'T',
          journal: 'J',
          year: '2024',
          date: '2024-01',
        },
      })
      const parsed = parseBibFile(src)
      expect(parsed[0].fields.year).toBe('2024')
      expect(parsed[0].fields.date).toBe('2024-01')
    })
  })
})
