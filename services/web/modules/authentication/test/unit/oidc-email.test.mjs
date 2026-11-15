import { expect, describe, it } from 'vitest'
import { profileEmail } from '../../oidc/app/src/OIDCAuthenticationManager.mjs'

const provider = behavior => ({ behavior, attrs: { email: 'email' } })

describe('oidc manager: email resolution honours verifiedEmailRequired', () => {
  it('uses the verified primary email from the emails array', () => {
    const profile = {
      emails: [
        { value: 'unverified@example.com', primary: true, verified: false },
        { value: 'verified@example.com', primary: false, verified: true },
      ],
    }
    expect(profileEmail(provider({ verifiedEmailRequired: true }), profile)).toBe(
      'verified@example.com'
    )
  })

  it('refuses an unverified email when verification is required', () => {
    const profile = {
      emails: [{ value: 'only@example.com', primary: true, verified: false }],
    }
    expect(profileEmail(provider({ verifiedEmailRequired: true }), profile)).toBeNull()
  })

  it('accepts the email claim when verification is not required', () => {
    const profile = { email: 'claim@example.com', email_verified: false }
    expect(profileEmail(provider({ verifiedEmailRequired: false }), profile)).toBe(
      'claim@example.com'
    )
  })

  it('refuses the email claim when the IdP says email_verified=false and verification is required', () => {
    const profile = { email: 'claim@example.com', email_verified: false }
    expect(profileEmail(provider({ verifiedEmailRequired: true }), profile)).toBeNull()
  })

  it('allows claim emails without an explicit verified flag when required', () => {
    // IdPs that never send the flag: legacy behaviour preserved
    const profile = { email: 'claim@example.com' }
    expect(profileEmail(provider({ verifiedEmailRequired: true }), profile)).toBe(
      'claim@example.com'
    )
  })
})
