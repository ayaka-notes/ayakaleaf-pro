import { expect, describe, it, vi, beforeEach } from 'vitest'

// keep the test independent of mongoose
vi.mock('../../providers/invites.mjs', () => ({
  hasPendingInvite: vi.fn(async () => ({ invited: false, via: null })),
}))

import { checkSsoAccess } from '../../providers/access.mjs'
import { hasPendingInvite } from '../../providers/invites.mjs'

const PEM = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'

function provider(overrides = {}) {
  return {
    id: 'test',
    type: 'saml',
    enabled: true,
    attrs: { userId: 'nameID', email: 'email', admin: null },
    behavior: { updateUserDetailsOnLogin: false, allowedEmailDomains: null },
    filter: { allow: [], deny: [], allowExistingUsers: true, allowInvited: true },
    saml: { entryPoint: 'https://idp', idpCert: [PEM] },
    ...overrides,
  }
}

describe('checkSsoAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(hasPendingInvite).mockResolvedValue({ invited: false, via: null })
  })

  it('allows when the filter passes', async () => {
    const result = await checkSsoAccess(
      provider(),
      { eduPersonAffiliation: 'student' },
      'a@example.de',
      false
    )
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('filter-pass')
  })

  it('denies a filtered-out profile without exceptions', async () => {
    const p = provider({
      filter: {
        allow: [
          { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        ],
        deny: [],
        allowExistingUsers: true,
        allowInvited: true,
      },
    })
    const result = await checkSsoAccess(
      p,
      { eduPersonScopedAffiliation: 'student@elsewhere.de' },
      'a@elsewhere.de',
      false
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('filter-denied')
  })

  it('lets existing accounts through (allowExistingUsers)', async () => {
    const p = provider({
      filter: {
        allow: [
          { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        ],
        deny: [],
        allowExistingUsers: true,
        allowInvited: true,
      },
    })
    const result = await checkSsoAccess(
      p,
      { eduPersonScopedAffiliation: 'student@elsewhere.de' },
      'a@elsewhere.de',
      true
    )
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('existing-user')
  })

  it('can disable the existing-user exception', async () => {
    const p = provider({
      filter: {
        allow: [
          { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        ],
        deny: [],
        allowExistingUsers: false,
        allowInvited: false,
      },
    })
    const result = await checkSsoAccess(
      p,
      { eduPersonScopedAffiliation: 'student@elsewhere.de' },
      'a@elsewhere.de',
      true
    )
    expect(result.allowed).toBe(false)
  })

  it('lets invited users through (allowInvited)', async () => {
    vi.mocked(hasPendingInvite).mockResolvedValue({ invited: true, via: 'project' })
    const p = provider({
      filter: {
        allow: [
          { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        ],
        deny: [],
        allowExistingUsers: true,
        allowInvited: true,
      },
    })
    const result = await checkSsoAccess(
      p,
      { eduPersonScopedAffiliation: 'student@elsewhere.de' },
      'a@elsewhere.de',
      false
    )
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('invited-project')
  })

  it('can disable the invited-user exception', async () => {
    vi.mocked(hasPendingInvite).mockResolvedValue({ invited: true, via: 'project' })
    const p = provider({
      filter: {
        allow: [
          { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        ],
        deny: [],
        allowExistingUsers: false,
        allowInvited: false,
      },
    })
    const result = await checkSsoAccess(
      p,
      { eduPersonScopedAffiliation: 'student@elsewhere.de' },
      'a@elsewhere.de',
      false
    )
    expect(result.allowed).toBe(false)
  })

  it('applies deny rules even to existing users when the exception is off', async () => {
    const p = provider({
      filter: {
        allow: [],
        deny: [
          { field: 'eduPersonAffiliation', op: 'oneOf', values: ['member'] },
        ],
        allowExistingUsers: false,
        allowInvited: false,
      },
    })
    const result = await checkSsoAccess(
      p,
      { eduPersonAffiliation: 'member' },
      'a@uni.de',
      true
    )
    expect(result.allowed).toBe(false)
  })
})
