import { describe, it, expect } from 'vitest'
import { validateEntry } from '../../../frontend/js/utils/bib-validate.ts'

import {
  validateEntry,
  isValidCitationKey,
  hasValidBiblatexDate,
  isFormatWarning,
  hasBlockingValidationErrors,
} from '../../../frontend/js/utils/bib-validate.ts'

describe('bib-validate (Check button, pure)', () => {
  it('empty citation key is VALID source; required fields still flagged', () => {
    // Empty key: no message (the editor generates one at materialize time).
    const res = validateEntry({ type: 'article', id: '', fields: {} }, 'existing')
    expect(res.valid).toBe(false)
    expect(res.byField.id).toBeUndefined()
    expect(isFormatWarning(res.byField.id)).toBe(false)
    expect(res.byField.author.kind).toBe('required-missing')
    expect(res.byField.title.kind).toBe('required-missing')
    expect(res.byField.journal.kind).toBe('required-missing')
    expect(res.byField.year.kind).toBe('required-missing')
  })

  it('a non-empty invalid citation key is an error (format warnings are not)', () => {
    const empty = validateEntry({ type: 'misc', id: '', fields: {} }, 'new')
    expect(empty.byField.id).toBeUndefined()
    expect(empty.valid).toBe(true)

    const res = validateEntry({ type: 'misc', id: 'has space', fields: {} }, 'existing')
    expect(res.byField.id.kind).toBe('id-invalid')
    expect(isFormatWarning(res.byField.id)).toBe(false)
    expect(hasBlockingValidationErrors(res)).toBe(true)

    // legal btparse characters, including unicode (biber accepts non-ASCII)
    expect(isValidCitationKey('smith2024')).toBe(true)
    expect(isValidCitationKey('李2020')).toBe(true)
    expect(isValidCitationKey('has space')).toBe(false)
    expect(isValidCitationKey('a,b')).toBe(false)
  })

  it('date / urldate: BibLaTeX date syntax is a warning, not an error', () => {
    const bad = validateEntry({ type: 'misc', id: 'm', fields: { date: 'not a date' } }, 'existing')
    expect(bad.byField.date.kind).toBe('date-format')
    expect(isFormatWarning(bad.byField.date)).toBe(true)
    expect(hasBlockingValidationErrors(bad)).toBe(false)

    const urldate = validateEntry({ type: 'misc', id: 'm', fields: { urldate: 'xx' } }, 'existing')
    expect(urldate.byField.urldate.kind).toBe('date-format')
  })

  it('hasValidBiblatexDate: full, partial, ranged, uncertain; rejects junk', () => {
    expect(hasValidBiblatexDate('2020')).toBe(true)
    expect(hasValidBiblatexDate('2020-03')).toBe(true)
    expect(hasValidBiblatexDate('2020-03-15')).toBe(true)
    expect(hasValidBiblatexDate('2020-XX')).toBe(true)
    expect(hasValidBiblatexDate('2010/2020')).toBe(true)
    expect(hasValidBiblatexDate('2010-03 / 2010-06')).toBe(true)
    expect(hasValidBiblatexDate('2020-03-15T10:30:00Z')).toBe(true)
    expect(hasValidBiblatexDate('2020?')).toBe(true) // uncertainty marker
    expect(hasValidBiblatexDate('not a date')).toBe(false)
    expect(hasValidBiblatexDate('')).toBe(true) // empty is fine (caller skips)
  })

  it('format warnings never block; required-missing does', () => {
    const warn = validateEntry({ type: 'misc', id: 'm', fields: { year: '20x1' } }, 'existing')
    expect(warn.byField.year.kind).toBe('year-format')
    expect(hasBlockingValidationErrors(warn)).toBe(false)

    const block = validateEntry({ type: 'article', id: '', fields: {} }, 'existing')
    expect(hasBlockingValidationErrors(block)).toBe(true)
  })

  it('OR-group: message attached to EVERY empty member (book: author|editor)', () => {
    // book requires ["author","editor"], title, publisher, year
    const res = validateEntry({ type: 'book', id: 'b1', fields: {} }, 'existing')
    const a = res.byField.author
    const e = res.byField.editor
    expect(a).toMatchObject({ kind: 'required-missing', group: true })
    expect(e).toMatchObject({ kind: 'required-missing', group: true })
    expect(a.labelFields.sort()).toEqual(['author', 'editor'])
    expect(e.labelFields).toEqual(a.labelFields)
  })

  it('OR-group: filling ANY member clears the message from BOTH (reviewer rule)', () => {
    const res = validateEntry(
      { type: 'book', id: 'b1', fields: { author: 'Someone' } },
      'existing'
    )
    expect(res.byField.author).toBeUndefined()
    expect(res.byField.editor).toBeUndefined()
    // the remaining requireds are still flagged
    expect(res.byField.title.kind).toBe('required-missing')
  })

  it('article year/date OR-group behaves the same as author/editor', () => {
    // C1 reference: article has NO chapter/pages (that was Phase-B);
    // the OR semantics are exercised on the year|date group instead.
    const article = {
      type: 'article',
      id: 'a1',
      fields: { author: 'A', title: 'T', journal: 'J' },
    }
    const res = validateEntry(article, 'existing')
    expect(res.byField.year).toMatchObject({ kind: 'required-missing', group: true })
    expect(res.byField.date).toMatchObject({ kind: 'required-missing', group: true })
    // either member satisfies the OR-group
    const onlyDate = { ...article, fields: { ...article.fields, date: '2000-01' } }
    const res2 = validateEntry(onlyDate, 'existing')
    expect(res2.byField.year).toBeUndefined()
    expect(res2.byField.date).toBeUndefined()
    expect(res2.valid).toBe(true)
  })

  it('misc is valid with only a key (no required fields — btxdoc)', () => {
    const res = validateEntry({ type: 'misc', id: 'm1', fields: {} }, 'existing')
    expect(res.valid).toBe(true)
  })

  it('new entry: citation key is NOT required (autogenerated at materialize)', () => {
    const res = validateEntry({ type: 'article', id: '', fields: {} }, 'new')
    expect(res.byField.id).toBeUndefined()
    const resTyped = validateEntry({ type: 'article', id: 'ok', fields: {} }, 'new')
    expect(resTyped.byField.id).toBeUndefined()
  })

  it('rejects invalid citation key characters', () => {
    const res = validateEntry({ type: 'misc', id: 'bad key&', fields: {} }, 'existing')
    expect(res.byField.id.kind).toBe('id-invalid')
  })

  it('validates year, DOI and URL formats for filled values', () => {
    const res = validateEntry(
      { type: 'article', id: 'a1', fields: { author: 'A', title: 'T', journal: 'J', year: '20x1' } },
      'existing'
    )
    expect(res.byField.year.kind).toBe('year-format')
    const resD = validateEntry({ type: 'misc', id: 'm', fields: { doi: '10.abc/123' } }, 'new')
    expect(resD.byField.doi.kind).toBe('doi-format')
    const resU = validateEntry({ type: 'misc', id: 'm', fields: { url: 'not a url' } }, 'new')
    expect(resU.byField.url.kind).toBe('url-invalid')
    const resOk = validateEntry(
      { type: 'misc', id: 'm', fields: { doi: '10.1000/abc123', url: 'https://x.org/a' } },
      'new'
    )
    expect(resOk.valid).toBe(true)
  })

  it('a valid full article passes', () => {
    const res = validateEntry(
      {
        type: 'article',
        id: 'smith2024',
        fields: { author: 'Smith, John', title: 'T', journal: 'J', year: '2024' },
      },
      'existing'
    )
    expect(res.valid).toBe(true)
  })
})
