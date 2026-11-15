import { expect, describe, it } from 'vitest'
import {
  normalizeProvider,
  applyPreset,
  listPresets,
  ATTRIBUTE_CATALOG,
} from '../../providers/index.mjs'

const PEM = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'

describe('provider schema', () => {
  describe('normalizeProvider', () => {
    it('normalizes a SAML provider', () => {
      const provider = normalizeProvider({
        id: 'uni',
        type: 'saml',
        name: 'Uni Bremen',
        saml: { entryPoint: 'https://idp/sso', idpCert: PEM },
        attrs: { userId: 'eduPersonPrincipalName', email: 'email' },
        filter: {
          allow: [{ field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' }],
        },
      })
      expect(provider.type).toBe('saml')
      expect(provider.enabled).toBe(true)
      expect(provider.source).toBe('file')
      expect(provider.attrs.userId).toBe('eduPersonPrincipalName')
      expect(provider.attrs.email).toBe('email')
      expect(provider.saml.entryPoint).toBe('https://idp/sso')
      expect(Array.isArray(provider.saml.idpCert)).toBe(true)
      expect(provider.filter.allow[0].op).toBe('iEndsWith')
      expect(provider.filter.allowExistingUsers).toBe(true)
    })

    it('accepts and validates iconUrl (login button icon)', () => {
      const withIcon = normalizeProvider({
        id: 'uni',
        type: 'saml',
        saml: { entryPoint: 'https://idp/sso', idpCert: PEM },
        iconUrl: 'https://example.org/icons/uni.png',
      })
      expect(withIcon.iconUrl).toBe('https://example.org/icons/uni.png')
      const abs = normalizeProvider({
        id: 'uni',
        type: 'saml',
        saml: { entryPoint: 'https://idp/sso', idpCert: PEM },
        iconUrl: '/img/icons/uni.png',
      })
      expect(abs.iconUrl).toBe('/img/icons/uni.png')
      const off = normalizeProvider({
        id: 'uni',
        type: 'saml',
        saml: { entryPoint: 'https://idp/sso', idpCert: PEM },
      })
      expect(off.iconUrl).toBeUndefined()
      expect(() =>
        normalizeProvider({
          id: 'uni',
          type: 'saml',
          saml: { entryPoint: 'https://idp/sso', idpCert: PEM },
          iconUrl: 'javascript:alert(1)',
        })
      ).toThrow(/http\(s\)\/\/ URL or an absolute path/)
      expect(() =>
        normalizeProvider({
          id: 'uni',
          type: 'saml',
          saml: { entryPoint: 'https://idp/sso', idpCert: PEM },
          iconUrl: 'data:image/png;base64,AAAA',
        })
      ).toThrow(/http\(s\)\/\/ URL or an absolute path/)
    })

    it('normalizes an OIDC provider (issuer + explicit urls)', () => {
      const provider = normalizeProvider({
        id: 'kc',
        type: 'oidc',
        oidc: {
          issuer: 'https://kc',
          authorizationUrl: 'https://kc/authorize',
          tokenUrl: 'https://kc/token',
          userInfoUrl: 'https://kc/userinfo',
          clientId: 'overleaf',
          clientSecret: 's',
        },
      })
      expect(provider.oidc.issuer).toBe('https://kc')
      expect(provider.oidc.authorizationUrl).toBe('https://kc/authorize')
      expect(provider.oidc.tokenUrl).toBe('https://kc/token')
      expect(provider.oidc.userInfoUrl).toBe('https://kc/userinfo')
      expect(provider.oidc.clientId).toBe('overleaf')
      expect(provider.attrs.userId).toBe('id') // per-protocol default
    })

    it('accepts camelCase URL aliases for OIDC', () => {
      const provider = normalizeProvider({
        id: 'kc',
        type: 'oidc',
        oidc: {
          issuer: 'https://kc',
          authorizationURL: 'https://kc/authorize',
          tokenURL: 'https://kc/token',
          userInfoURL: 'https://kc/userinfo',
          clientId: 'overleaf',
        },
      })
      expect(provider.oidc.authorizationUrl).toBe('https://kc/authorize')
      expect(provider.oidc.tokenUrl).toBe('https://kc/token')
      expect(provider.oidc.userInfoUrl).toBe('https://kc/userinfo')
    })

    it('normalizes a generic OAuth2 provider (GitHub-style)', () => {
      const provider = normalizeProvider({
        id: 'github',
        type: 'oauth2',
        oauth2: {
          authorizeUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userUrl: 'https://api.github.com/user',
          emailUrl: 'https://api.github.com/user/emails',
          clientId: 'Iv1',
          clientSecret: 's',
          scope: 'user:email',
        },
      })
      expect(provider.type).toBe('oauth2')
      expect(provider.oauth2.authorizeUrl).toBe('https://github.com/login/oauth/authorize')
      expect(provider.oauth2.userUrl).toBe('https://api.github.com/user')
      expect(provider.oauth2.emailUrl).toBe('https://api.github.com/user/emails')
      // verified-email default for OAuth2 sources
      expect(provider.behavior.verifiedEmailRequired).toBe(true)
      expect(provider.behavior.linkOnly).toBe(false)
    })

    it('supports link-only providers (ORCID-style, no auto-create)', () => {
      const provider = normalizeProvider({
        id: 'orcid',
        type: 'oidc',
        behavior: { linkOnly: true },
        oidc: {
          issuer: 'https://orcid.org',
          authorizationUrl: 'https://orcid.org/oauth/authorize',
          tokenUrl: 'https://orcid.org/oauth/token',
          userInfoUrl: 'https://api.orcid.org/v3.0/APP/record',
          clientId: 'APP',
        },
      })
      expect(provider.behavior.linkOnly).toBe(true)
      // OIDC keeps the legacy verified-email behaviour unless opted in
      expect(provider.behavior.verifiedEmailRequired).toBe(false)
    })

    it('rejects an OAuth2 provider without endpoints', () => {
      expect(() =>
        normalizeProvider({
          id: 'gh',
          type: 'oauth2',
          oauth2: { clientId: 'Iv1' },
        })
      ).toThrow('oauth2.authorizeUrl')
    })

    it('reads cert material from file path or inline PEM', () => {
      // inline PEM
      const inline = normalizeProvider({
        id: 'u',
        type: 'saml',
        saml: { entryPoint: 'e', idpCert: PEM },
      })
      expect(inline.saml.idpCert[0]).toContain('BEGIN')
    })

    it('rejects missing id', () => {
      expect(() => normalizeProvider({ type: 'saml' })).toThrow('id')
    })

    it('rejects invalid id characters', () => {
      expect(() =>
        normalizeProvider({ id: 'UPPER CASE', type: 'saml' })
      ).toThrow('must match')
    })

    it('rejects unknown type', () => {
      expect(() =>
        normalizeProvider({ id: 'x', type: 'ftp' })
      ).toThrow('must be "oidc", "oauth2" or "saml"')
    })

    it('rejects SAML without entryPoint', () => {
      expect(() =>
        normalizeProvider({ id: 'x', type: 'saml', saml: { idpCert: PEM } })
      ).toThrow('entryPoint')
    })

    it('rejects SAML without idpCert', () => {
      expect(() =>
        normalizeProvider({ id: 'x', type: 'saml', saml: { entryPoint: 'e' } })
      ).toThrow('idpCert')
    })

    it('rejects OIDC without issuer + explicit urls', () => {
      expect(() =>
        normalizeProvider({ id: 'x', type: 'oidc', oidc: { clientId: 'a' } })
      ).toThrow('issuer')
      expect(() =>
        normalizeProvider({
          id: 'x',
          type: 'oidc',
          oidc: {
            issuer: 'https://kc',
            authorizationUrl: 'https://kc/authorize',
            tokenUrl: 'https://kc/token',
            clientId: 'a',
          },
        })
      ).toThrow('userInfoUrl')
    })

    it('rejects an invalid filter rule', () => {
      expect(() =>
        normalizeProvider({
          id: 'x',
          type: 'saml',
          saml: { entryPoint: 'e', idpCert: PEM },
          filter: { deny: [{ field: 'a', op: 'nope' }] },
        })
      ).toThrow('unknown op')
    })

    it('normalizes admin field + values (string or object)', () => {
      const obj = normalizeProvider({
        id: 'x',
        type: 'saml',
        saml: { entryPoint: 'e', idpCert: PEM },
        attrs: { admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] } },
      })
      expect(obj.attrs.admin).toEqual({
        field: 'eduPersonAffiliation',
        values: ['faculty', 'staff'],
      })
      const str = normalizeProvider({
        id: 'x',
        type: 'saml',
        saml: { entryPoint: 'e', idpCert: PEM },
        attrs: { admin: 'eduPersonAffiliation' },
      })
      expect(str.attrs.admin.field).toBe('eduPersonAffiliation')
      // null admin ("no admin rule") is accepted
      const none = normalizeProvider({
        id: 'x',
        type: 'saml',
        saml: { entryPoint: 'e', idpCert: PEM },
        attrs: { admin: null },
      })
      expect(none.attrs.admin).toBeUndefined()
    })
  })

  describe('presets', () => {
    it('lists the edugain preset', () => {
      const ids = listPresets().map(p => p.id)
      expect(ids).toContain('edugain')
    })

    it('applies edugain defaults to a SAML provider', () => {
      const raw = {
        id: 'edu',
        type: 'saml',
        saml: { entryPoint: 'https://idp', idpCert: PEM },
      }
      const merged = applyPreset('edugain', 'saml', raw)
      expect(merged.attrs.userId).toBe('eduPersonPrincipalName')
      expect(merged.attrs.email).toBe('email')
      expect(merged.attrs.admin).toEqual({
        field: 'eduPersonAffiliation',
        values: ['faculty', 'staff'],
      })
    })

    it('lets provider values override the preset', () => {
      const raw = {
        id: 'edu',
        type: 'saml',
        saml: { entryPoint: 'https://idp', idpCert: PEM },
        attrs: { userId: 'uid' },
      }
      const merged = applyPreset('edugain', 'saml', raw)
      expect(merged.attrs.userId).toBe('uid')
      // unfilled attrs still come from the preset
      expect(merged.attrs.firstName).toBe('givenName')
    })

    it('keeps provider filter rules when applying a preset', () => {
      const raw = {
        id: 'edu',
        type: 'saml',
        saml: { entryPoint: 'https://idp', idpCert: PEM },
        filter: {
          allow: [{ field: 'zfnScopedAffiliation', op: 'equals', value: 'zfn.uni-bremen.de' }],
        },
      }
      const merged = applyPreset('edugain', 'saml', raw)
      expect(merged.filter.allow[0].field).toBe('zfnScopedAffiliation')
    })

    it('rejects an unknown preset', () => {
      expect(() => applyPreset('nope', 'saml', {})).toThrow('unknown preset')
    })

    it('accepts known-provider templates as presets (github)', () => {
      const raw = {
        id: 'test-form',
        type: 'oauth2',
        oauth2: { authorizeUrl: 'https://x', tokenUrl: 'https://x', userUrl: 'https://x' },
        attrs: { userId: 'login', email: 'email' },
        filter: { allow: [{ field: 'login', op: 'equals', value: 'alice' }], deny: [] },
      }
      const merged = applyPreset('github', 'oauth2', raw)
      // provider attrs win over preset attrs
      expect(merged.attrs.userId).toBe('login')
      // provider filter rules are kept
      expect(merged.filter.allow[0].value).toBe('alice')
    })

    it('exposes the attribute catalog', () => {
      const names = ATTRIBUTE_CATALOG.map(a => a.name)
      expect(names).toContain('eduPersonPrincipalName')
      expect(names).toContain('eduPersonAffiliation')
      expect(names).toContain('eduPersonScopedAffiliation')
      const affiliation = ATTRIBUTE_CATALOG.find(a => a.name === 'eduPersonAffiliation')
      expect(affiliation.values).toContain('faculty')
      expect(affiliation.values).toContain('student')
    })
  })
})
