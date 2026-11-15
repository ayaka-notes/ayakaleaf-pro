import { expect, describe, it } from 'vitest'
import { resolveSsoEmail } from '../../providers/index.mjs'

describe('oauth2 manager: email resolution', () => {
  const provider = behavior => ({ behavior })

  it('prefers the verified primary email when verified is required', () => {
    const profile = {
      emails: [
        { value: 'unverified@example.com', primary: true, verified: false },
        { value: 'verified@example.com', primary: false, verified: true },
      ],
    }
    expect(
      resolveSsoEmail(provider({ verifiedEmailRequired: true }), profile)
    ).toBe('verified@example.com')
  })

  it('refuses to create from an unverified email when required', () => {
    const profile = {
      emails: [{ value: 'only@example.com', primary: true, verified: false }],
    }
    expect(
      resolveSsoEmail(provider({ verifiedEmailRequired: true }), profile)
    ).toBeNull()
  })

  it('falls back to any email when verification is not required', () => {
    const profile = {
      emails: [{ value: 'any@example.com', primary: true, verified: false }],
    }
    expect(
      resolveSsoEmail(provider({ verifiedEmailRequired: false }), profile)
    ).toBe('any@example.com')
  })

  it('returns null when the profile has no emails (e.g. ORCID)', () => {
    expect(resolveSsoEmail(provider({ verifiedEmailRequired: true }), { emails: [] })).toBeNull()
    expect(resolveSsoEmail(provider({ verifiedEmailRequired: false }), {})).toBeNull()
  })

  it('lowercases the chosen address', () => {
    const profile = {
      emails: [{ value: 'User@Example.COM', primary: true, verified: true }],
    }
    expect(
      resolveSsoEmail(provider({ verifiedEmailRequired: true }), profile)
    ).toBe('user@example.com')
  })
})
