import { describe, it, expect } from 'vitest'
import {
  isDoiLine,
  splitImportText,
  buildImportRows,
  importableRows,
  hasImportableRows,
} from '../../../frontend/js/utils/bib-import.ts'

/**
 * C5 (PHASE_C_PLAN.md §3-C5): the paste-references import model (pure).
 *
 *  - isDoiLine / splitImportText: paste-order split into bibtex / doi /
 *    error items (no network here)
 *  - buildImportRows: rows from items + resolved DOIs (+ conflict flags —
 *    OQ-9: a collision is pre-unchecked in the preview)
 *  - importableRows / hasImportableRows: what Import may write
 */

describe('C5: isDoiLine', () => {
  it('matches `doi:` lines', () => {
    expect(isDoiLine('doi:10.1000/xyz')).toBe(true)
    expect(isDoiLine('DOI: 10.1000/xyz')).toBe(true)
  })

  it('matches bare ISRC-style DOIs (10.xxxxx-…)', () => {
    expect(isDoiLine('10.1000/xyz')).toBe(true)
    expect(isDoiLine('10.100000000/a.b.2019.01.10')).toBe(true)
  })

  it('matches full DOI URLs (https://doi.org/…)', () => {
    expect(isDoiLine('https://doi.org/10.3389/fncom.2025.1692418')).toBe(true)
    expect(isDoiLine('http://dx.doi.org/10.1000/xyz')).toBe(true)
    expect(isDoiLine('doi.org/10.1000/xyz')).toBe(true)
  })

  it('rejects non-DOI lines', () => {
    expect(isDoiLine('title = {One}')).toBe(false)
    expect(isDoiLine('@article{k1,')).toBe(false)
    expect(isDoiLine('10.xxxx')).toBe(false)
    expect(isDoiLine('10.10abc/10')).toBe(false)
  })
})

describe('C5: splitImportText (paste order, no network)', () => {
  it('splits a mix of BibTeX + DOI lines, paste order kept', () => {
    const items = splitImportText(
      [
        '@article{k1,',
        '  title = {One},',
        '}',
        '',
        'doi:10.1000/xyz',
      ].join('\n')
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      kind: 'bibtex',
      entry: { type: 'article', id: 'k1', fields: { title: 'One' } },
    })
    expect(items[1]).toEqual({ kind: 'doi', raw: 'doi:10.1000/xyz' })
  })

  it('a multi-entry BibTeX paste yields one item per entry (first-past first)', () => {
    const items = splitImportText('@misc{a, title = {A}}\n@misc{b, title = {B}}')
    expect(items).toHaveLength(2)
    expect(items[0].kind).toBe('bibtex')
    expect(items[0].entry.id).toBe('a')
    expect(items[1].entry.id).toBe('b')
  })

  it('empty lines are dropped', () => {
    expect(splitImportText('\n\n\n')).toHaveLength(0)
  })

  it('a broken @-block is an error item', () => {
    const items = splitImportText('@article{unbalanced,')
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('error')
  })

  it('stray text on its own line is an error item', () => {
    const items = splitImportText('not bibtex @ all')
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('error')
    expect(items[0].raw).toBe('not bibtex @ all')
  })
})

describe('C5: buildImportRows (rows + conflicts)', () => {
  const items = [
    { kind: 'bibtex', entry: { type: 'article', id: 'k1', fields: {} } },
    { kind: 'bibtex', entry: { type: 'article', id: 'k2', fields: { title: 'Two' } } },
    { kind: 'bibtex', entry: { type: 'article', id: 'k2', fields: { title: 'dup' } } },
  ]

  it('a row whose key collides with the doc is a conflict', () => {
    const rows = buildImportRows(
      [
        { kind: 'bibtex', entry: { type: 'article', id: 'k1', fields: {} } },
      ],
      [],
      ['k1'] // the doc already holds k1
    )
    expect(rows[0].status).toBe('conflict')
    expect(rows[0].conflictWith).toBe('k1')
  })

  it('a duplicate key within the import is a conflict (the second one)', () => {
    const rows = buildImportRows(items, [], [])
    expect(rows[0].status).toBe('ok')
    expect(rows[1].status).toBe('ok')
    expect(rows[2].status).toBe('conflict')
  })

  it('a library collision (key already in the document) is flagged kind:library (D10 Already-in-library tag)', () => {
    const rows = buildImportRows(
      [{ kind: 'bibtex', entry: { type: 'article', id: 'already', fields: {} } }],
      [],
      ['already']
    )
    expect(rows[0].status).toBe('conflict')
    expect(rows[0].kind).toBe('library')
  })

  it('a duplicate key within the import is kind:duplicate', () => {
    const rows = buildImportRows(items, [], [])
    expect(rows[2].status).toBe('conflict')
    expect(rows[2].kind).toBe('duplicate')
  })

  it('an unresolved DOI line is a transient empty row', () => {
    const rows = buildImportRows(
      [{ kind: 'doi', raw: 'doi:10.1000/xyz' }],
      [undefined],
      []
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('empty')
  })

  it('a failed DOI is an error row (NOT importable)', () => {
    const rows = buildImportRows(
      [{ kind: 'doi', raw: 'doi:10.4040/404' }],
      ['Failed to fetch DOI entry.'],
      []
    )
    expect(rows[0].status).toBe('error')
    expect(rows[0].error).toBe('Failed to fetch DOI entry.')
    expect(importableRows(rows)).toHaveLength(0)
  })

  it('a resolved DOI row carries its entry', () => {
    const entry = { type: 'article', id: 'doi-1', fields: { title: 'x' } }
    const rows = buildImportRows(
      [{ kind: 'doi', raw: 'doi:10.1000/xyz' }],
      [entry],
      []
    )
    expect(rows[0].status).toBe('doi-ok')
    expect(rows[0].entry).toEqual(entry)
  })
})

describe('C5: importableRows / hasImportableRows', () => {
  it('keeps only importable rows', () => {
    const rows = buildImportRows(
      [
        { kind: 'bibtex', entry: { type: 'misc', id: 'a', fields: {} } },
        { kind: 'doi', raw: 'doi:10.4040/404' },
      ],
      ['Failed to fetch DOI entry.'],
      []
    )
    expect(importableRows(rows).map(e => e.id)).toEqual(['a'])
    expect(hasImportableRows(rows)).toBe(true)
    const errorsOnly = rows.filter(r => r.status === 'error')
    expect(hasImportableRows(errorsOnly)).toBe(false)
  })
})
