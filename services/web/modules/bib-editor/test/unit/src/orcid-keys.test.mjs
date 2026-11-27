/**
 * ORCID import key normalisation (P2). ORCID-embedded BibTeX can carry
 * machine-style keys that are not legal citation keys (e.g. a DOI-URL as
 * the key) — the library REST layer rejects those. The import adapters
 * regenerate such keys from the entry's own metadata (author/year/title)
 * and de-duplicate within the batch.
 */
import { describe, it, expect } from 'vitest'
import {
  normaliseOrcidEntryKeys,
  VALID_CITATION_KEY,
} from '../../../frontend/js/utils/bib-import.ts'

const legal = (key) => key.length > 0 && VALID_CITATION_KEY.test(key)

describe('normaliseOrcidEntryKeys', () => {
  it('keeps valid keys untouched', () => {
    const out = normaliseOrcidEntryKeys([
      {
        type: 'article',
        id: 'smith2020',
        fields: { title: 'T', author: 'Jane A. Smith' },
      },
    ])
    expect(out[0].id).toBe('smith2020')
    expect(out[0]).toBeTypeOf('object')
  })

  it('regenerates illegal (URL-style) keys into legal ones', () => {
    const entry = {
      type: 'techreport',
      id: 'https://doi.org/10.17613/bmhwg-wxz66',
      fields: {
        title: 'FIELD DAY: Community Survey',
        author: 'Haak, Laurel L. and Roberts, Jeremy',
        year: '2025',
      },
    }
    const [out] = normaliseOrcidEntryKeys([entry])
    expect(legal(out.id)).toBe(true)
    expect(out.id).not.toBe(entry.id)
    expect(out.id.toLowerCase()).toContain('haak')
    expect(out.id).toContain('2025')
    // entry fields are preserved
    expect(out.fields.title).toBe(entry.fields.title)
    // the original object is not mutated
    expect(entry.id).toBe('https://doi.org/10.17613/bmhwg-wxz66')
  })

  it('regenerates keys that are too long', () => {
    const entry = {
      type: 'misc',
      id: 'a'.repeat(200),
      fields: { title: 'A title', author: 'Someone', year: '2020' },
    }
    const [out] = normaliseOrcidEntryKeys([entry])
    expect(out.id.length).toBeLessThanOrEqual(128)
    expect(legal(out.id)).toBe(true)
  })

  it('de-duplicates keys generated within the same batch', () => {
    const make = () => ({
      type: 'misc',
      id: 'https://example.org/x',
      fields: { title: 'Same', author: 'Jane Doe', year: '2021' },
    })
    const out = normaliseOrcidEntryKeys([make(), make(), make()])
    const ids = out.map(e => e.id)
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) {
      expect(legal(id)).toBe(true)
    }
  })

  it('keeps mixed batches valid and collision-free (generated key may collide with an existing one)', () => {
    const out = normaliseOrcidEntryKeys([
      { type: 'misc', id: 'okkey1999', fields: { title: 'A' } },
      { type: 'misc', id: 'bad/key', fields: { title: 'B', author: 'Okkey', year: '1999' } },
      { type: 'misc', id: 'bad/key2', fields: { title: 'C', author: 'Okkey', year: '1999' } },
    ])
    const ids = out.map(e => e.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('okkey1999')
    for (const id of ids) {
      expect(legal(id)).toBe(true)
    }
    // the two generated 'okkey1999' keys were de-duplicated
    expect(ids.slice(1).every(id => id.startsWith('okkey1999'))).toBe(true)
  })
})
