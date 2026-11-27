import { describe, it, expect } from 'vitest'
import {
  parseBibFile,
  serializeBibEntry,
} from '../../../frontend/js/utils/bib-parser.ts'
import {
  ENTRY_TYPES,
  ALL_FIELDS,
  getEntryType,
  flattenRequired,
} from '../../../frontend/js/utils/bib-types.ts'
import {
  OVERLEAF_TYPES,
  HUMAN_LABELS,
  CAPTURED_FORM_ROWS,
  OPTIONAL_FIELD_TAXONOMY,
  offeredOptionalFields,
  humanizeCitationHeading,
} from '../../../frontend/js/utils/overleaf-type-map.ts'
import bibtexSchema from '../../../frontend/js/utils/bibtex-schema.json'
import reference48 from '../../../reference/capture/overleaf-48.json'

/**
 * C1 (PHASE_C_PLAN.md §3): 48-type vocabulary + schema expansion.
 *
 *  - supportedPublicationTypes = 48, every block consistent, required ⊆
 *    captured form rows ∪ year (plan §1.2 note: rows are UI, validation
 *    requiredFields are separate — both derive from the same capture)
 *  - 48 round-trip cases: write (serialize) per machine type → parse →
 *    machine type preserved
 *  - per-type form rows match the capture table (CAPTURED_FORM_ROWS)
 *  - taxonomy exclusion (Article does NOT offer Journal/Journal title,
 *    DOES offer Journal subtitle)
 */

// bibtexSchema is a plain JSON import; shape is checked in test/unit
// (no TS cast — this file is .mjs and esbuild would reject it).
const SCHEMA = bibtexSchema
// C1 ground truth: the machine-extracted reference type table (48 rows,
// `req` with "[a,b]" OR-group tokens, `opt` per-type default-optional).
const REFERENCE_48 = Object.fromEntries(
  reference48.map(r => [r.k, r])
)

describe('C1: 48-type vocabulary (overleaf-type-map + schema)', () => {
  it('supports exactly the 48 captured machine types', () => {
    expect(SCHEMA.supportedPublicationTypes).toHaveLength(48)
    expect(new Set(SCHEMA.supportedPublicationTypes).size).toBe(48)
    const machineNames = OVERLEAF_TYPES.map(t => t.machine)
    expect(machineNames).toHaveLength(48)
    expect(new Set(machineNames).size).toBe(48)
    // the map and the schema agree on the set
    expect(SCHEMA.supportedPublicationTypes.slice().sort()).toEqual(
      [...machineNames].sort()
    )
  })

  it('entry types all carry labels / required / optional', () => {
    for (const t of ENTRY_TYPES) {
      expect(typeof t.label, `label for ${t.name}`).toBe('string')
      expect(t.label.length, `label non-empty for ${t.name}`).toBeGreaterThan(0)
      // C1 reference: 16 types require NOTHING (misc, software, artwork…);
      // the OR-groups / standalone mix is asserted per-type against
      // reference/capture/overleaf-48.json below.
      const reqOk =
        Array.isArray(t.requiredFields) &&
        t.requiredFields.every(
          r => Array.isArray(r) || typeof r === 'string'
        )
      expect(reqOk, `${t.name} requiredFields shape`).toBe(true)
      expect(HUMAN_LABELS[t.name], `HUMAN_LABELS[${t.name}]`).toBe(t.label)
    }
    // label lookup is case-insensitive at the consumer (getEntryType path)
    expect(getEntryType('ARTICLE')?.label).toBe('Article')
  })

  describe('schema invariants (all 48)', () => {
    for (const type of SCHEMA.supportedPublicationTypes) {
      const rule = SCHEMA.publicationTypes[type]
      it(`${type}: block exists, required members known (C1 OR-groups)`, () => {
        expect(
          SCHEMA.publicationTypes,
          `${type} must have a rule`
        ).toHaveProperty(type)
        // required ⊆ captured form rows ∪ year/date OR-members. (C1:
        // requiredFields are the reference OR-groups — a member may live
        // outside the type's form rows, e.g. `journaltitle` for `article` —
        // but every member must be a known field of its catalogue.)
        const catalog = new Set([
          ...rule.optionalFields,
          ...(rule.defaultOptionalFields || []),
          ...SCHEMA.allKnownFields,
        ])
        for (const r of rule.requiredFields) {
          for (const f of Array.isArray(r) ? r : [r]) {
            expect(
              catalog,
              `${type}: required "${f}" not a known field`
            ).toContain(f)
          }
        }
        // Year + Date both always render (capture): both must be KNOWN
        // fields (the per-type catalogue carries whichever of year/date is
        // NOT required — reference: year|date is an OR-group or required
        // standalone).
        const reqFlat = new Set(flattenRequired(rule.requiredFields))
        const known = new Set([
          ...rule.optionalFields,
          ...reqFlat,
          ...SCHEMA.allKnownFields,
        ])
        expect(known, `${type}: year known`).toContain('year')
        expect(known, `${type}: date known`).toContain('date')
        for (const f of rule.optionalFields) {
          expect(new Set(SCHEMA.allKnownFields), `${type}: optional "${f}" unknown`).toContain(f)
        }
        // C1: required/defaultOptional must EQUAL the reference capture
        const ref = REFERENCE_48[type]
        expect(ref, `${type}: missing from reference capture`).toBeDefined()
        const refReq = ref.req.map(t =>
          t.startsWith('[') ? t.slice(1, -1).split(',') : t
        )
        expect(rule.requiredFields, `${type}: requiredFields diverge from reference`).toEqual(
          refReq
        )
        expect(
          rule.defaultOptionalFields,
          `${type}: defaultOptionalFields diverge from reference opt`
        ).toEqual(ref.opt)
      })

      it(`${type}: round-trip — serialize → parse keeps the machine type`, () => {
        const entry = {
          type,
          id: `k_${type.replace(/[^a-z0-9]/gi, '')}`,
          fields: { title: `T ${type}`, year: '2024' },
        }
        const src = serializeBibEntry(entry)
        expect(src.startsWith(`@${type}{`), src.slice(0, 20)).toBe(true)
        const parsed = parseBibFile(src)
        expect(parsed).toHaveLength(1)
        expect(parsed[0]?.type, 'machine type preserved').toBe(type)
        expect(parsed[0]?.id, 'key preserved').toBe(entry.id)
      })

      it(`${type}: all optional fields are known fields`, () => {
        const known = new Set(SCHEMA.allKnownFields)
        for (const f of rule.optionalFields) {
          expect(known).toContain(f)
        }
      })
    }
  })

  describe('form rows match the capture (§1.2 table)', () => {
    it('article: author, title, journal, journaltitle (journal ≠ journaltitle)', () => {
      expect(CAPTURED_FORM_ROWS.article?.mainFields).toEqual([
        'author',
        'title',
        'journal',
        'journaltitle',
      ])
      // C1 reference: article req has the OR-groups [journal, journaltitle]
      // and [year, date] — a member is satisfied by ANY in its group.
      const req = getEntryType('article')?.requiredFields ?? []
      const flat = flattenRequired(req)
      expect(flat).toContain('journal')
      expect(flat).toContain('journaltitle')
      expect(
        req.some(r => Array.isArray(r) && r.includes('journal') && r.includes('journaltitle')),
        'article has the [journal, journaltitle] OR-group'
      ).toBe(true)
    })

    it('unpublished: Note row renders AFTER Date (postDate)', () => {
      expect(CAPTURED_FORM_ROWS.unpublished?.postDate).toEqual(['note'])
      expect(CAPTURED_FORM_ROWS.unpublished?.mainFields).toEqual([
        'author',
        'title',
      ])
    })

    it('electronic/online/www: DOI/Eprint/URL rows after Date', () => {
      for (const t of ['electronic', 'online', 'www']) {
        expect(CAPTURED_FORM_ROWS[t]?.postDate).toEqual(['doi', 'eprint', 'url'])
      }
    })

    it('mastersthesis/phdthesis: institution + school rows', () => {
      for (const t of ['mastersthesis', 'phdthesis']) {
        expect(CAPTURED_FORM_ROWS[t]?.mainFields).toEqual([
          'author',
          'title',
          'institution',
          'school',
        ])
      }
    })

    it('proceedings/mvproceedings: title only (no author row)', () => {
      expect(CAPTURED_FORM_ROWS.proceedings?.mainFields).toEqual(['title'])
      expect(CAPTURED_FORM_ROWS.mvproceedings?.mainFields).toEqual(['title'])
    })

    it('patent: author, title, number', () => {
      expect(CAPTURED_FORM_ROWS.patent?.mainFields).toEqual([
        'author',
        'title',
        'number',
      ])
    })

    it('report/thesis: author, title, type, institution', () => {
      for (const t of ['report', 'thesis']) {
        expect(CAPTURED_FORM_ROWS[t]?.mainFields).toEqual([
          'author',
          'title',
          'type',
          'institution',
        ])
      }
    })
  })

  describe('taxonomy (8 groups, 64 options — reference capture)', () => {
    it('has exactly 8 groups in capture order', () => {
      expect(
        OPTIONAL_FIELD_TAXONOMY.map(g => g.label)
      ).toEqual([
        'Common',
        'Contributors',
        'Books and volumes',
        'Periodicals and journals',
        'Events and conferences',
        'Publication details',
        'Digital and online',
        'Language and origin',
      ])
    })

    it('offers 64 options (reference-verified count, incl. journaltitle)', () => {
      const all = OPTIONAL_FIELD_TAXONOMY.flatMap(g => g.fields)
      expect(all).toHaveLength(64)
      const names = new Set(all.map(f => f.field))
      expect(names.size, 'no duplicate field names').toBe(64)
      expect(names, 'journaltitle present in Periodicals (D3)').toContain('journaltitle')
    })

    it('only known fields (allKnownFields ∪ additions)', () => {
      const known = new Set(ALL_FIELDS)
      for (const g of OPTIONAL_FIELD_TAXONOMY) {
        for (const f of g.fields) {
          expect(known, `taxonomy field "${f.field}" must be known`).toContain(f.field)
        }
      }
    })

    it('Article: excludes Journal/Journal title (main rows), offers Journal subtitle', () => {
      const offered = offeredOptionalFields(
        'article',
        getEntryType('article')?.requiredFields ?? []
      )
      const offeredFields = new Set(offered.map(o => o.field))
      expect(offeredFields).not.toContain('journal')
      expect(offeredFields).not.toContain('journaltitle')
      expect(offeredFields).toContain('journalsubtitle')
      // required members are never offered
      expect(offeredFields).not.toContain('author')
      expect(offeredFields).not.toContain('year')
      expect(offeredFields).not.toContain('date')
    })

    it('book: Publisher is a main row → not offered (but location is)', () => {
      const offered = new Set(
        offeredOptionalFields('book', getEntryType('book')?.requiredFields ?? [])
          .map(o => o.field)
      )
      expect(offered).not.toContain('publisher')
      expect(offered).toContain('location')
    })

    it('unpublished: Note (postDate) not offered', () => {
      const offered = offeredOptionalFields(
        'unpublished',
        getEntryType('unpublished')?.requiredFields ?? []
      )
      expect(offered.map(o => o.field)).not.toContain('note')
    })
  })

  describe('humanizeCitationHeading (preview / import cards)', () => {
    it('Ernst et al. (2007) — multiple authors + year', () => {
      expect(
        humanizeCitationHeading('ernst07', {
          author: 'Ernst and Bruns and Pasch?',
          year: '2007',
        })
      ).toBe('Ernst et al. (2007)')
    })

    it('last-first BibTeX order: "Ernst, J. and Bruns, T." → Ernst et al.', () => {
      expect(
        humanizeCitationHeading('ernst07', {
          author: 'Ernst, J. and Bruns, T. and Pasch, E.',
          year: '2007',
        })
      ).toBe('Ernst et al. (2007)')
    })

    it('"Smith, John and Doe" → Smith et al. (1999)', () => {
      expect(
        humanizeCitationHeading('smith99', {
          author: 'Smith, John and Doe',
          year: '1999',
        })
      ).toBe('Smith et al. (1999)')
    })

    it('no people → citation key; no id → "Unknown"', () => {
      expect(humanizeCitationHeading('key123', { year: '2000' })).toBe(
        'key123 (2000)'
      )
      expect(humanizeCitationHeading('', {})).toBe('Unknown')
    })

    it('year missing → no parens', () => {
      expect(humanizeCitationHeading('x', { author: 'Curie' })).toBe('Curie')
    })

    it('space-form single author → surname', () => {
      expect(humanizeCitationHeading('x', { author: 'Ada Lovelace' })).toBe(
        'Lovelace'
      )
    })
  })
})
