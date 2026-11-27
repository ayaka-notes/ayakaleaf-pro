import { describe, it, expect } from 'vitest'
import {
  generateCitationKey,
  generateAvailableCitationKey,
  pickAvailableForEntry,
  displayCitationKey,
} from '../../../frontend/js/utils/bib-key-generation.ts'

describe('bib-key-generation', () => {
  it('derives first-author last-name + year (lowercased)', () => {
    expect(generateCitationKey({ author: 'Last, First and Other, X', year: '2024' })).toBe('last2024')
    expect(generateCitationKey({ author: 'John Smith', year: '2020' })).toBe('smith2020')
    expect(generateCitationKey({ author: 'John von Neumann', year: '1965' })).toBe('vonneumann1965')
    expect(generateCitationKey({ author: 'Catherine O\'Hara', year: '2012' })).toBe('ohara2012')
  })

  it('keeps non-ASCII letters/digits (btparse/biber accept them in keys)', () => {
    expect(generateCitationKey({ author: '李雷', year: '2020' })).toBe('李雷2020')
    expect(generateCitationKey({ author: 'Jean Müller', year: '2019' })).toBe('müller2019')
  })

  it('uses deterministic Unknown/0000 fallbacks instead of randomness', () => {
    expect(generateCitationKey({})).toBe('unknown0000')
    expect(generateCitationKey({ year: '2001' })).toBe('unknown2001')
    expect(generateCitationKey({ author: 'John Smith' })).toBe('smith0000')
    // non-year date values such as "2.2.2019" degrade to 0000
    expect(generateCitationKey({ author: 'John Smith', year: '2.2.2019' })).toBe('smith0000')
    // never a random `ref…` suffix and never empty
    expect(generateCitationKey({ title: 'A Cool Paper', year: '2019' })).toBe('unknown2019')
  })

  it('skips "others" and empty authors', () => {
    expect(generateCitationKey({ author: 'John Smith and others', year: '2019' })).toBe('smith2019')
    expect(generateCitationKey({ author: '   ', year: '2019' })).toBe('unknown2019')
    expect(generateCitationKey({ author: '', year: '2019' })).toBe('unknown2019')
  })

  it('picks the shared suffix policy and excludes the entry own key', () => {
    expect(pickAvailableForEntry('smith2020', [])).toBe('smith2020')
    expect(pickAvailableForEntry('smith2020', ['smith2020'])).toBe('smith2020a')
    expect(pickAvailableForEntry('smith2020', ['smith2020', 'smith2020a'])).toBe('smith2020b')
    // unrelated shared prefixes must not be mistaken for suffix collisions
    expect(pickAvailableForEntry('smith2020', ['smith2020workshop'])).toBe('smith2020')
    // renaming: the entry's own old key is excluded from the taken set,
    // so re-keying to the same value (or any free value) must not collide
    expect(
      pickAvailableForEntry('kz', ['kz', 'ka'], 'kz')
    ).toBe('kz')
    expect(
      pickAvailableForEntry('k', ['k', 'kz', 'kka'])
    ).toBe('ka')
  })

  it('generateAvailableCitationKey is deterministic end-to-end', () => {
    const fields = { author: 'John Smith', year: '2020' }
    expect(generateAvailableCitationKey(fields, [])).toBe('smith2020')
    expect(generateAvailableCitationKey(fields, ['smith2020'])).toBe('smith2020a')
    expect(generateAvailableCitationKey(fields, ['smith2020', 'smith2020a'], 'smith2020a')).toBe('smith2020a')
  })

  it('displayCitationKey prefers the existing key, else suggests', () => {
    expect(displayCitationKey({ id: 'own2020', fields: {} }, [])).toBe('own2020')
    expect(displayCitationKey({ id: '', fields: { author: 'John Smith', year: '2020' } }, ['smith2020'])).toBe('smith2020a')
  })
})
