/**
 * Tests for the shared `@/features/bibtex/citation-key` helpers, including
 * the unicode-aware key strip (CJK/accented surnames must yield a key
 * instead of degrading to '').
 */
import { describe, it, expect } from 'vitest'
import {
  generateBaseCitationKey,
  pickAvailableKey,
} from '@/features/bibtex/citation-key'
import { BibtexNameList } from '@shared/bibtex/bibtex-name.mts'

describe('features/bibtex/citation-key (shared)', () => {
  it('strips punctuation but keeps unicode letters/digits', () => {
    const key = (author, year) =>
      generateBaseCitationKey({ authors: new BibtexNameList(author), year })
    expect(key('John Doe', '1994')).toBe('Doe1994')
    expect(key('John von Neumann', '1965')).toBe('vonNeumann1965')
    expect(key("Catherine O'Hara", '2012')).toBe('OHara2012')
    // non-ASCII: btparse/biber accept these in keys — must not be ''
    expect(key('李雷', '2020')).toBe('李雷2020')
    expect(key('Jean Müller', '2019')).toBe('Müller2019')
    // pure punctuation still yields no suggestion
    expect(key('???', '2019')).toBe('')
  })

  it('returns no suggestion without author or with a non-year', () => {
    const key = (author, year) =>
      generateBaseCitationKey({ authors: new BibtexNameList(author), year })
    expect(key('', '2019')).toBe('')
    expect(key('John Doe', '2.2.1994')).toBe('')
    expect(key('John Doe', '194')).toBe('')
  })

  it('pickAvailableKey suffixes bijectively and ignores prefix look-alikes', () => {
    expect(pickAvailableKey('Doe1994', [])).toBe('Doe1994')
    expect(pickAvailableKey('Doe1994', ['Doe1994'])).toBe('Doe1994a')
    expect(pickAvailableKey('Doe1994', ['Doe1994', 'Doe1994a'])).toBe('Doe1994b')
    // unrelated key sharing the prefix is NOT a collision
    expect(pickAvailableKey('Doe1994', ['Doe1994Workshop'])).toBe('Doe1994')
    // wraps past single letters
    expect(pickAvailableKey('k', ['k', 'ka', 'kb'])).toBe('kc')
  })
})
