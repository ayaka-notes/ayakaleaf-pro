import { describe, it, expect } from 'vitest'
import {
  requiredFlatList,
  missingRequiredLabels,
  previewFieldLabel,
  previewSummary,
  yearOf,
  prevEntry,
  nextEntry,
  navEnabled,
  allRowsSelected,
  isTypeOnlyDraft,
  bulkDeleteIds,
  downloadBibFilename,
  matchesSearch,
  splitHighlighted,
} from '../../../frontend/js/utils/preview-model.ts'
import {
  parseBibFile,
  serializeBibEntry,
} from '../../../frontend/js/utils/bib-parser.ts'

/**
 * C4 (PHASE_C_PLAN.md §3-C4): preview-panel model — pure, unit-tested.
 *
 *  - missing-required labels (the preview warning, capture "Author,
 *    Title, Journal, Year"; OR-groups list every empty member)
 *  - summary rows (title / who / year — capture `-title`/`-meta`)
 *  - prev/next over the current parse list (file order; wrap at the ends)
 *  - bulk-bar select-all state + W5 bulk-delete id snapshot
 *  - whole-file download filename (OQ-6)
 *  - the preview writes `abstract` through the normal form state: an
 *    abstract value survives a serialize → parse round trip
 */

const ENTRY = (over = {}) => ({
  id: 'a1',
  type: 'article',
  fields: {},
  ...over,
})

describe('C4: preview model', () => {
  describe('missingRequiredLabels — the preview warning', () => {
    it('article: Author, Title, Journal + Journal title, Year + Date (C1 OR-groups)', () => {
      // reference article req: [author, title, [journal|journaltitle],
      // [year|date]] — a missing group lists EVERY member (bib-validate).
      expect(missingRequiredLabels('article', {})).toEqual([
        'Author',
        'Title',
        'Journal',
        'Journal title',
        'Year',
        'Date',
      ])
    })

    it('OR-group: an empty [author, editor] group lists both members', () => {
      const labels = missingRequiredLabels('book', {})
      // C1 reference book required: [[author|editor], title, [year|date]]
      // (NO publisher — that was the Phase-B over-statement)
      expect(labels).toEqual([
        'Author',
        'Editor',
        'Title',
        'Year',
        'Date',
      ])
    })

    it('valued members are omitted (partially filled entry)', () => {
      // author + year filled: the [year|date] group is satisfied (year
      // counts) → only Title + both journal or-members remain.
      expect(
        missingRequiredLabels('article', { author: 'a', year: '1990' })
      ).toEqual(['Title', 'Journal', 'Journal title'])
    })

    it('a filled entry has no warning', () => {
      expect(
        missingRequiredLabels('article', {
          author: 'a',
          title: 't',
          journal: 'j',
          year: '1990',
        })
      ).toEqual([])
    })

    it('unknown type → no labels (defensive, no crash)', () => {
      expect(missingRequiredLabels('doesnotexist', {})).toEqual([])
    })
  })

  describe('previewSummary — title / who / year rows', () => {
    it('full entry: title + "Last et al." + year', () => {
      const s = previewSummary({
        author: 'Ernst, Udo and Rotermund, David and Pawelzik, Klaus',
        title: 'Efficient Computation Based on Stochastic Spikes',
        year: '2007',
      })
      expect(s).toEqual({
        title: 'Efficient Computation Based on Stochastic Spikes',
        who: 'Ernst et al.',
        year: '2007',
      })
    })

    it('single author: no "et al."', () => {
      const s = previewSummary({ author: 'Smith, John', year: '1990' })
      expect(s?.who).toBe('Smith')
    })

    it('year falls back to the leading 4 digits of date (biblatex)', () => {
      expect(previewSummary({ author: 'a', date: '2007-05' })?.year).toBe(
        '2007'
      )
      expect(previewSummary({ author: 'a', date: '1990.01' })?.year).toBe(
        '1990'
      )
    })

    it('an empty entry has no summary rows', () => {
      expect(previewSummary({})).toBeNull()
    })

    it('title-only entry: who and year empty', () => {
      const s = previewSummary({ title: 'Only a title' })
      expect(s).toEqual({ title: 'Only a title', who: '', year: '' })
    })
  })

  describe('yearOf', () => {
    it('year= wins over date=', () => {
      expect(
        yearOf({ year: '2001', date: '1999-01' })
      ).toBe('2001')
    })
    it('no values → empty', () => {
      expect(yearOf({})).toBe('')
    })
  })

  describe('prev/next (file order of the current parse list)', () => {
    const entries = [
      ENTRY({ id: 'a' }),
      ENTRY({ id: 'b' }),
      ENTRY({ id: 'c' }),
    ]

    it('next wraps around to the first', () => {
      expect(nextEntry(entries, 0)?.id).toBe('b')
      expect(nextEntry(entries, 2)?.id).toBe('a')
    })

    it('prev wraps around to the last', () => {
      expect(prevEntry(entries, 0)?.id).toBe('c')
      expect(prevEntry(entries, 1)?.id).toBe('a')
    })

    it('single entry: prev/next are the same entry', () => {
      const one = [ENTRY({ id: 'only' })]
      expect(prevEntry(one, 0)?.id).toBe('only')
      expect(nextEntry(one, 0)?.id).toBe('only')
    })

    it('empty list: null (panel handles "no preview")', () => {
      expect(prevEntry([], 0)).toBeNull()
      expect(nextEntry([], 0)).toBeNull()
    })

    it('nav is enabled for ≥2 entries', () => {
      expect(navEnabled(entries)).toBe(true)
      expect(navEnabled(entries.slice(0, 1))).toBe(false)
      expect(navEnabled([])).toBe(false)
    })
  })

  describe('bulk bar (C3) + W5 bulk-delete snapshot', () => {
    it('select-all is checked only when every visible row is selected', () => {
      const rows = [ENTRY({ id: 'a' }), ENTRY({ id: 'b' })]
      expect(allRowsSelected(rows, [])).toBe(false)
      expect(allRowsSelected(rows, ['a'])).toBe(false)
      expect(allRowsSelected(rows, ['a', 'b'])).toBe(true)
      expect(allRowsSelected([], ['a'])).toBe(false)
    })

    it('bulkDeleteIds drops ids that no longer resolve in the parse', () => {
      const src = serializeBibEntry(
        ENTRY({ id: 'a', fields: { author: 'A', title: 't' } })
      ) +
        '\n' +
        serializeBibEntry(ENTRY({ id: 'b', fields: { title: 'x' } }))
      const parsed = parseBibFile(src)
      // stale id (deleted in Code mode) is excluded silently
      expect(
        bulkDeleteIds(parsed, ['a', 'deleted-id', 'b'])
      ).toEqual(['a', 'b'])
    })

    it('an empty selection is a deliberate no-op', () => {
      expect(
        bulkDeleteIds(parseBibFile(serializeBibEntry(ENTRY({ id: 'a' }))), [])
      ).toEqual([])
    })
  })

  describe('isTypeOnlyDraft (materializes nothing on flush)', () => {
    it('type-only form is a no-op', () => {
      expect(isTypeOnlyDraft(ENTRY({ id: '', fields: {} }))).toBe(true)
    })
    it('a key or any field makes it real', () => {
      expect(
        isTypeOnlyDraft(ENTRY({ id: 'k', fields: {} }))
      ).toBe(false)
      expect(
        isTypeOnlyDraft(ENTRY({ id: '', fields: { title: 't' } }))
      ).toBe(false)
    })
  })

  describe('downloadBibFilename (OQ-6: whole-file download)', () => {
    it('keeps an existing .bib name', () => {
      expect(downloadBibFilename('sample.bib')).toBe('sample.bib')
    })
    it('appends .bib when missing', () => {
      expect(downloadBibFilename('sample')).toBe('sample.bib')
      expect(downloadBibFilename('')).toBe('bibliography.bib')
    })
  })

  describe('requiredFlatList (OR-groups flattened, order kept)', () => {
    it('book: author, editor, title, publisher, year', () => {
      // from the schema: [['author','editor'], 'title', 'publisher', 'year']
      const flat = requiredFlatList([
        ['author', 'editor'],
        'title',
        'publisher',
        'year',
      ])
      expect(flat).toEqual(['author', 'editor', 'title', 'publisher', 'year'])
    })
  })

  describe('previewFieldLabel (DATA labels, snake→words fallback)', () => {
    it('known fields keep the captured label', () => {
      expect(previewFieldLabel('journaltitle')).toBe('Journal title')
      expect(previewFieldLabel('author')).toBe('Author')
      expect(previewFieldLabel('type')).toBe('Type')
    })
    it('unknown fields fall back to capitalized words', () => {
      expect(previewFieldLabel('my_field')).toBe('My Field')
    })
  })

  describe('search (D15): matchesSearch + splitHighlighted', () => {
    it('matches key, title, author, editor, year, venue fields', () => {
      const e = ENTRY({
        id: 'smith2019',
        type: 'article',
        fields: {
          author: 'Smith, Jane',
          title: 'A title about search',
          year: '2019',
          journal: 'Journal of X',
        },
      })
      expect(matchesSearch(e, '')).toBe(true) // empty query = everything
      expect(matchesSearch(e, 'SMITH')).toBe(true)
      expect(matchesSearch(e, 'search')).toBe(true)
      expect(matchesSearch(e, '2019')).toBe(true)
      expect(matchesSearch(e, 'journal of')).toBe(true)
      expect(matchesSearch(e, 'zzz-not-present-zzz')).toBe(false)
    })

    it('editor and journaltitle/booktitle also match', () => {
      const e1 = ENTRY({ fields: { editor: 'Doe' } })
      const e2 = ENTRY({
        type: 'inbook',
        fields: { journaltitle: 'Proceedings' },
      })
      const e3 = ENTRY({
        type: 'inbook',
        fields: { booktitle: 'The Book' },
      })
      expect(matchesSearch(e1, 'doe')).toBe(true)
      expect(matchesSearch(e2, 'proceedings')).toBe(true)
      expect(matchesSearch(e3, 'book')).toBe(true)
    })

    it('splitHighlighted: no query → single plain segment', () => {
      expect(splitHighlighted('Smith 2019', '')).toEqual([
        { text: 'Smith 2019', match: false },
      ])
    })

    it('splitHighlighted: empty text → no segments', () => {
      expect(splitHighlighted('', 'a')).toEqual([])
    })

    it('splitHighlighted: one match → plain segment after the match', () => {
      expect(splitHighlighted('Smith, Jane', 'smith')).toEqual([
        { text: 'Smith', match: true },
        { text: ', Jane', match: false },
      ])
    })

    it('splitHighlighted: multiple matches', () => {
      // 'aXb aXc' — the query hits twice, each match is its own segment
      expect(splitHighlighted('aXb aXc', 'a')).toEqual([
        { text: 'a', match: true },
        { text: 'Xb ', match: false },
        { text: 'a', match: true },
        { text: 'Xc', match: false },
      ])
    })

    it('splitHighlighted: case-insensitive, preserves original case', () => {
      expect(splitHighlighted('Krause 2019', 'KRAUSE')).toEqual([
        { text: 'Krause', match: true },
        { text: ' 2019', match: false },
      ])
    })
  })

  describe('write-side: the Abstract tab writes through the normal path', () => {
    it('an abstract value serializes and re-parses (round trip)', () => {
      const entry = ENTRY({
        id: 'a1',
        fields: {
          author: 'A',
          abstract: 'An abstract of the article.',
        },
      })
      const src = serializeBibEntry(entry)
      const parsed = parseBibFile(src)
      expect(parsed.length).toBe(1)
      expect(parsed[0].fields.abstract).toBe(
        'An abstract of the article.'
      )
    })
  })
})
