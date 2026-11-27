import { describe, it, expect } from 'vitest'
import { helperKeyForField } from '../../../frontend/js/utils/bib-form-helper.ts'

/**
 * P0 (plan §2.4): the stray helper line under Author/Editor in the shared
 * entry form (project + library) was removed. This test is the regression
 * guard: author/editor (and derived name rows) must map to NO helper key,
 * while the intentional capture helpers (pages/doi/eprint) stay.
 */
describe('P0: entry-form per-row helpers', () => {
  it('author/editor render NO helper (stray-string removal)', () => {
    expect(helperKeyForField('author')).toBeNull()
    expect(helperKeyForField('editor')).toBeNull()
    // derived name rows must not carry it either
    expect(helperKeyForField('author2')).toBeNull()
    expect(helperKeyForField('editora')).toBeNull()
    expect(helperKeyForField('editorb')).toBeNull()
  })

  it('keeps the intentional capture helpers', () => {
    expect(helperKeyForField('pages')).toBe('Page range')
    expect(helperKeyForField('doi')).toBe(
      'The identifier only, not the full URL, e.g. 10.1000/xyz123'
    )
    expect(helperKeyForField('eprint')).toBe(
      'The preprint archive identifier, e.g. math/0307200v3'
    )
  })

  it('returns null for all other fields', () => {
    expect(helperKeyForField('title')).toBeNull()
    expect(helperKeyForField('year')).toBeNull()
    expect(helperKeyForField('journal')).toBeNull()
    expect(helperKeyForField('url')).toBeNull()
  })

  it('the removed key is not used for any field', () => {
    for (const field of [
      'author',
      'editor',
      'author2',
      'editora',
      'title',
      'pages',
      'doi',
      'eprint',
    ]) {
      expect(helperKeyForField(field)).not.toBe(
        'Separate multiple names with "and"'
      )
    }
  })
})
