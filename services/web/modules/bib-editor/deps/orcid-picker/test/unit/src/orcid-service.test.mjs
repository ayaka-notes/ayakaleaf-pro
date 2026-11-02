/**
 * orcid-picker service tests (pure/offline only — no network).
 * Covers the format guard, the SSRF address classifier, the BibTeX
 * builder, and the input-validation guards of the fetch functions.
 * Live flows are verified end-to-end in the browser (P2 verification).
 */
import { describe, it, expect } from 'vitest'
import {
  isValidOrcid,
  isPrivateAddress,
  buildBibtexFromOrcidWork,
  searchAuthors,
  fetchWorks,
  fetchBibtexFromOrcid,
} from '../../../app/src/OrcidService.mjs'

describe('isValidOrcid', () => {
  it('accepts well-formed ORCID iDs (including check digit X)', () => {
    expect(isValidOrcid('0000-0002-1825-0097')).toBe(true)
    expect(isValidOrcid('1234-5678-9012-345X')).toBe(true)
    expect(isValidOrcid(' 0000-0002-1825-0097 ')).toBe(true) // trimmed
  })

  it('rejects malformed values', () => {
    expect(isValidOrcid('1234-5678-9012-34XY')).toBe(false)
    expect(isValidOrcid('abc')).toBe(false)
    expect(isValidOrcid('10.1000/xyz')).toBe(false)
    expect(isValidOrcid('')).toBe(false)
    expect(isValidOrcid(null)).toBe(false)
    expect(isValidOrcid(1234)).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  const cases = [
    // [address, expected]
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.0.1', true],
    ['100.64.1.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['255.255.255.255', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['9.9.9.9', false],
    ['172.15.0.1', false],
    ['::1', true],
    ['::', true],
    ['fe80::1', true],
    ['fdbb::1', true],
    ['fc00::1', true],
    ['fec0::1', true],
    ['ffff::1', true],
    ['2001:4860:4860::8888', false],
    ['2606:4700:4700::1111', false],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['not-an-ip', false],
  ]

  it('classifies public and non-public ranges', () => {
    for (const [addr, expected] of cases) {
      expect(isPrivateAddress(addr), addr).toBe(expected)
    }
  })
})

describe('buildBibtexFromOrcidWork', () => {
  const baseWork = {
    title: { title: { value: 'My Paper' } },
    'publication-date': { year: { value: '2021' } },
    type: 'journal-article',
    'journal-title': { value: 'Journal X' },
    contributors: {
      contributor: [
        {
          'credit-name': { value: 'Jane A. Smith' },
          'contributor-type': 'author',
        },
        {
          'credit-name': { value: 'Joe Public' },
          'contributor-type': 'author',
        },
      ],
    },
  }

  it('maps ORCID work types to BibTeX types', () => {
    const map = {
      'journal-article': 'article',
      'conference-paper': 'inproceedings',
      'book': 'book',
      'book-chapter': 'incollection',
      'dissertation': 'phdthesis',
      'report': 'techreport',
      'edited-book': 'book',
      'unknown-orcid-shape': 'misc',
      undefined: 'misc',
    }
    for (const [orcidType, bibType] of Object.entries(map)) {
      const work = { ...baseWork, type: orcidType }
      const out = buildBibtexFromOrcidWork(work, null)
      expect(out.startsWith(`@${bibType}{`), orcidType).toBe(true)
    }
  })

  it('emits all metadata fields', () => {
    const out = buildBibtexFromOrcidWork(baseWork, '10.1000/probe')
    expect(out).toContain('author = {Jane A. Smith and Joe Public}')
    expect(out).toContain('title = {My Paper}')
    expect(out).toContain('year = {2021}')
    expect(out).toContain('journal = {Journal X}')
    expect(out).toContain('doi = {10.1000/probe}')
    expect(out).toContain('smith2021')
  })

  it('falls back to sensible defaults without authors/year/journal', () => {
    const out = buildBibtexFromOrcidWork({ title: { title: { value: 'T' } } }, null)
    expect(out.startsWith('@misc{unknown')).toBe(true)
    expect(out).toContain('title = {T}')
    expect(out).not.toContain('author')
    expect(out).not.toContain('doi')
  })
})

describe('input guards (no network)', () => {
  async function expectThrow(fn, message) {
    let error = null
    try {
      await fn()
    } catch (e) {
      error = e
    }
    expect(error, 'expected the call to throw').to.be.instanceOf(Error)
    expect(error.message, 'message').to.contain(message)
  }

  it('rejects empty search queries', async () => {
    await expectThrow(() => searchAuthors(''), 'Search query required')
    await expectThrow(() => searchAuthors('   '), 'Search query required')
    await expectThrow(() => searchAuthors(null), 'Search query required')
  })

  it('rejects invalid ORCID identifiers before any request', async () => {
    await expectThrow(() => fetchWorks('nope'), 'Invalid ORCID identifier')
    await expectThrow(
      () => fetchBibtexFromOrcid('nope', 1),
      'Invalid ORCID identifier'
    )
  })

  it('rejects invalid put-codes before any request', async () => {
    await expectThrow(
      () => fetchBibtexFromOrcid('0000-0002-1825-0097', 'abc'),
      'Invalid put-code'
    )
    await expectThrow(
      () => fetchBibtexFromOrcid('0000-0002-1825-0097', null),
      'Invalid put-code'
    )
  })
})
