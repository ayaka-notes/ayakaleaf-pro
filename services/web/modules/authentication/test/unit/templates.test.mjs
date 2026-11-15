import { expect, describe, it } from 'vitest'
import {
  providerTemplate,
  prettyTemplate,
  normalizeProvider,
  listKnownProviders,
} from '../../providers/index.mjs'

describe('provider templates', () => {
  it('produces valid SAML provider JSON', () => {
    const { provider } = providerTemplate('saml', 'uni', 'Uni Bremen')
    const normalized = normalizeProvider(provider)
    expect(normalized.type).toBe('saml')
    expect(normalized.saml.entryPoint).toBeTruthy()
    expect(normalized.attrs.userId).toBeTruthy()
  })

  it('produces valid OIDC provider JSON', () => {
    const { provider } = providerTemplate('oidc', 'kc', 'Keycloak')
    const normalized = normalizeProvider(provider)
    expect(normalized.type).toBe('oidc')
    expect(normalized.oidc.issuer).toBeTruthy()
  })

  it('produces a valid blank OAuth2 provider JSON', () => {
    const { provider } = providerTemplate('oauth2', 'gh', 'GitHub')
    const normalized = normalizeProvider(provider)
    expect(normalized.type).toBe('oauth2')
    expect(normalized.oauth2.authorizeUrl).toBeTruthy()
    expect(normalized.oauth2.tokenUrl).toBeTruthy()
    expect(normalized.oauth2.userUrl).toBeTruthy()
    // OAuth2 sources require a verified email by default
    expect(normalized.behavior.verifiedEmailRequired).toBe(true)
  })

  it('produces a valid EduGAIN SAML template', () => {
    const { provider } = providerTemplate('saml', 'edu', 'EduGAIN', 'edugain')
    expect(provider.preset).toBe('edugain')
    expect(provider.attrs.userId).toBe('eduPersonPrincipalName')
    expect(provider.filter.allow.length).toBeGreaterThan(0)
    // still valid JSON after normalization
    normalizeProvider(provider)
  })

  it('produces a valid EduGAIN OIDC template', () => {
    const { provider } = providerTemplate('oidc', 'edu', 'EduGAIN', 'edugain')
    normalizeProvider(provider)
  })

  it('prettyTemplate returns parseable JSON', () => {
    const json = prettyTemplate('saml', 'uni', 'Uni Bremen', 'edugain')
    const parsed = JSON.parse(json)
    expect(parsed.id).toBe('uni')
  })

  describe('known providers (Forgejo-style quick starts)', () => {
    it('lists the well-known sources', () => {
      const ids = listKnownProviders().map(p => p.id)
      for (const wanted of ['github', 'gitlab', 'gitea', 'google', 'orcid']) {
        expect(ids).toContain(wanted)
      }
    })

    it('github pre-fills OAuth2 endpoints and verified-email behaviour', () => {
      const { provider, hints } = providerTemplate('oauth2', 'github', 'GitHub', 'github')
      expect(provider.type).toBe('oauth2')
      expect(provider.oauth2.authorizeUrl).toBe('https://github.com/login/oauth/authorize')
      expect(provider.oauth2.tokenUrl).toBe('https://github.com/login/oauth/access_token')
      expect(provider.oauth2.userUrl).toBe('https://api.github.com/user')
      expect(provider.oauth2.emailUrl).toBe('https://api.github.com/user/emails')
      expect(provider.oauth2.scope).toBe('user:email')
      expect(provider.behavior.verifiedEmailRequired).toBe(true)
      expect(provider.attrs.userId).toBe('login')
      expect(hints.length).toBeGreaterThan(0)
      expect(hints.join('\n')).toContain('github.com/settings/developers')
      normalizeProvider(provider)
    })

    it('orcid is link-only (no auto-create) and OIDC-typed', () => {
      const { provider, hints } = providerTemplate('oidc', 'orcid', 'ORCID', 'orcid')
      expect(provider.type).toBe('oidc')
      expect(provider.behavior.linkOnly).toBe(true)
      expect(provider.oidc.authorizationUrl).toBe('https://orcid.org/oauth/authorize')
      expect(provider.attrs.userId).toBe('sub')
      expect(hints.join('\n')).toContain('no email')
      normalizeProvider(provider)
    })

    it('google is OIDC-typed with verified emails', () => {
      const { provider } = providerTemplate('oidc', 'google', 'Google', 'google')
      expect(provider.type).toBe('oidc')
      expect(provider.behavior.verifiedEmailRequired).toBe(true)
      expect(provider.oidc.issuer).toContain('accounts.google.com')
      normalizeProvider(provider)
    })
  })
})
