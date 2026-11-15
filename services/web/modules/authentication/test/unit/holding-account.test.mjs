import { expect, describe, it, beforeEach, vi } from 'vitest'

// ---- mock the heavy app dependencies BEFORE importing the managers ----
vi.mock('../../../../app/src/Features/User/UserCreator.mjs', () => ({
  default: { promises: { createNewUser: vi.fn() } },
}))
vi.mock('../../../../app/src/Features/User/UserGetter.mjs', () => ({
  default: { promises: { ensureUniqueEmailAddress: vi.fn(async () => {}) } },
}))
vi.mock('../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs', () => ({
  default: {
    promises: {
      login: vi.fn(async () => {
        throw new Error('not linked')
      }),
      link: vi.fn(async () => {}),
    },
  },
}))
vi.mock('../../../../app/src/Features/User/SAMLIdentityManager.mjs', () => ({
  default: {
    promises: {},
    getUser: vi.fn(async () => {
      throw new Error('not linked')
    }),
    link: vi.fn(async () => {}),
  },
}))
vi.mock('../../../../app/src/models/User.mjs', () => ({
  User: {
    findOne: vi.fn(() => ({ exec: vi.fn(async () => null) })),
    updateOne: vi.fn(() => ({ exec: vi.fn(async () => ({ modifiedCount: 1 })) })),
  },
}))
vi.mock('../../../auditLog.mjs', () => ({
  accountBeforeLogin: vi.fn(async () => {}),
  logLoginChanges: vi.fn(async () => {}),
  logLoginEntry: vi.fn(async () => {}),
}))
vi.mock('../../providers/invites.mjs', () => ({
  hasPendingInvite: vi.fn(async () => ({ invited: false, via: null })),
}))

import UserCreator from '../../../../app/src/Features/User/UserCreator.mjs'
import { hasPendingInvite } from '../../providers/invites.mjs'
import { default as OIDCAuthenticationManager } from '../../oidc/app/src/OIDCAuthenticationManager.mjs'
import { default as SAMLAuthenticationManager } from '../../saml/app/src/SAMLAuthenticationManager.mjs'

function provider(overrides = {}) {
  return {
    id: 'test-oidc',
    type: 'oidc',
    name: 'Test IdP',
    enabled: true,
    attrs: { userId: 'email', email: 'email', firstName: null, lastName: null, admin: null },
    behavior: {
      updateUserDetailsOnLogin: false,
      allowedEmailDomains: null,
      linkOnly: false,
      verifiedEmailRequired: false,
    },
    filter: { allow: [], deny: [], allowExistingUsers: true, allowInvited: true },
    oidc: { issuer: 'https://idp', clientId: 'c', clientSecret: 's' },
    ...overrides,
  }
}

describe('SSO JIT holding accounts (Goal F)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(UserCreator.promises.createNewUser).mockResolvedValue({
      _id: 'u-new',
      email: 'inv@example.de',
    })
    vi.mocked(hasPendingInvite).mockResolvedValue({ invited: false, via: null })
  })

  it('creates a HOLDING account when access comes from the invited-user exception (OIDC)', async () => {
    vi.mocked(hasPendingInvite).mockResolvedValue({ invited: true, via: 'project' })
    const p = provider({
      filter: {
        allow: [],
        deny: [{ field: 'email', op: 'equals', value: 'inv@example.de' }],
        allowExistingUsers: false,
        allowInvited: true,
      },
    })
    const result = await OIDCAuthenticationManager.promises.findOrCreateUser(
      { email: 'inv@example.de' },
      p,
      {}
    )
    expect(result.user?._id).toBe('u-new')
    const call = vi.mocked(UserCreator.promises.createNewUser).mock.calls[0][0]
    expect(call.holdingAccount).toBe(true)
  })

  it('creates a REGULAR account when the profile passes the filter (OIDC)', async () => {
    const p = provider({
      filter: {
        allow: [{ field: 'email', op: 'endsWith', value: '@example.de' }],
        deny: [],
        allowExistingUsers: true,
        allowInvited: true,
      },
    })
    await OIDCAuthenticationManager.promises.findOrCreateUser(
      { email: 'ok@example.de' },
      p,
      {}
    )
    const call = vi.mocked(UserCreator.promises.createNewUser).mock.calls[0][0]
    expect(call.holdingAccount).toBe(false)
  })

  it('denies an uninvited profile (OIDC) without creating anything', async () => {
    const p = provider({
      filter: {
        allow: [],
        deny: [{ field: 'email', op: 'equals', value: 'inv@example.de' }],
        allowExistingUsers: false,
        allowInvited: false,
      },
    })
    const result = await OIDCAuthenticationManager.promises.findOrCreateUser(
      { email: 'inv@example.de' },
      p,
      {}
    )
    expect(result.user).toBeNull()
    expect(result.accessDenied?.reason).toBe('filter-denied')
    expect(UserCreator.promises.createNewUser).not.toHaveBeenCalled()
  })

  it('creates a HOLDING account via the invited exception (SAML)', async () => {
    vi.mocked(hasPendingInvite).mockResolvedValue({ invited: true, via: 'team' })
    const p = {
      id: 'test-saml',
      type: 'saml',
      name: 'Test SAML',
      enabled: true,
      attrs: {
        userId: 'eduPersonPrincipalName',
        email: 'eduPersonPrincipalName',
        firstName: null,
        lastName: null,
        admin: null,
      },
      behavior: {
        updateUserDetailsOnLogin: false,
        allowedEmailDomains: null,
        linkOnly: false,
        verifiedEmailRequired: false,
      },
      filter: {
        allow: [],
        deny: [{ field: 'eduPersonPrincipalName', op: 'equals', value: 's@example.de' }],
        allowExistingUsers: false,
        allowInvited: true,
      },
      saml: {
        entryPoint: 'https://idp/sso',
        idpCert: ['-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'],
      },
    }
    const profile = { eduPersonPrincipalName: 's@example.de' }
    const result =
      await SAMLAuthenticationManager.promises.findOrCreateUser(profile, p, {})
    expect(result.user?._id).toBe('u-new')
    const call = vi.mocked(UserCreator.promises.createNewUser).mock.calls.at(-1)[0]
    expect(call.holdingAccount).toBe(true)
  })
})

describe('admin establish endpoint (clears holding account)', () => {
  it('clears holdingAccount for the email', async () => {
    const { default: SsoAdminController } = await import(
      '../../../sso-admin/app/src/SsoAdminController.mjs'
    )
    const { User } = await import('../../../../app/src/models/User.mjs')
    const saved = []
    vi.mocked(User.findOne).mockImplementation(() => ({
      exec: vi.fn(async () => ({
        _id: 'u-1',
        email: 'inv@example.de',
        holdingAccount: true,
        save: async function () {
          saved.push(this.holdingAccount)
          return this
        },
      })),
    }))
    let status = 0
    const res = {
      status(code) {
        status = code
        return this
      },
      json(payload) {
        this.payload = payload
        return payload
      },
    }
    await SsoAdminController.establishUser({ body: { email: 'inv@example.de' } }, res)
    expect(saved).toEqual([false])
  })

  it('404s for an unknown user', async () => {
    const { default: SsoAdminController } = await import(
      '../../../sso-admin/app/src/SsoAdminController.mjs'
    )
    const { User } = await import('../../../../app/src/models/User.mjs')
    vi.mocked(User.findOne).mockImplementation(() => ({
      exec: vi.fn(async () => null),
    }))
    let status = 0
    const res = {
      status(code) {
        status = code
        return this
      },
      json(payload) {
        this.payload = payload
        return payload
      },
    }
    await SsoAdminController.establishUser(
      { body: { email: 'nobody@nowhere.de' } },
      res
    )
    expect(status).toBe(404)
  })
})
