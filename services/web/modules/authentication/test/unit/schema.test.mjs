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
      ).toThrow('must be "oidc" or "saml"')
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
